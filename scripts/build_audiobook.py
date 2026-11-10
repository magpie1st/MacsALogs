#!/usr/bin/env python3
"""오디오북 페이지를 만든다. 기본은 **암호화** 페이지(docs/audiobook.html, 블로그에 올림).

페이지에는 **본문과 엔진 목록만** 싣는다. 음원과 문장 타임라인은 음원 저장소에 따로 있고(publish_audiobook_audio.py),
브라우저가 암호를 푼 뒤 엔진마다 manifest.bin 을 받아 챕터에 붙인다. 그래서 이 빌드는 어느 PC 에서 돌려도 엔진 음원 유무와 무관하다.

입력 (읽기 전용, 이 저장소 밖):  본문 book-maker 의 output/audiobook/<책 id>/book.json (문단·문장 분리가 끝난 텍스트)
설정: docs/audio/audiobook/<책 id>/config.json
  audioBaseUrl   음원 저장소 Pages 주소 (예 https://magpie1st.github.io/audiobook-audio). 음원 = <주소>/<엔진>/<책 id>/…
  engines        [{id, name}]  플레이어에 보일 엔진 (순서대로). id 는 음원 저장소의 폴더 이름
  defaultEngine  처음 고르는 엔진
  audioRepoDir   음원 저장소의 로컬 폴더 (publish_audiobook_audio.py 가 쓴다)

암호화 (기본)
  - 책 본문 전체를 AES-256-GCM 으로 잠가 페이지에 싣는다. 열쇠는 PBKDF2-SHA256(암호, salt, 60만 회).
    평문으로 보이는 것은 책 제목·저자뿐이다. 복호화는 브라우저(docs/js/audiobook.js, WebCrypto)가 한다
  - 암호: AUDIOBOOK_PASSWORD 또는 ~/.config/macsalogs/audiobook_password (12자 이상). 설정은 `python3 scripts/audiobook_password.py`
  - 쓰고 나서 페이지에 본문 문장이 평문으로 남지 않았는지 검사한다. 남았으면 실패한다
  - --plain 은 암호 없이 본문만 평문으로 docs/audiobook-local.html 에 쓴다 (로컬 전용, gitignore, 음원 없음)

    uv run --with cryptography python scripts/build_audiobook.py -n
    uv run --with cryptography python scripts/build_audiobook.py      # → docs/audiobook.html (암호화)
    python3 scripts/build_audiobook.py --plain                        # → docs/audiobook-local.html
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from audiobook_common import DEFAULT_BOOKS, DOCS, REPO, Sealer, book_config, read_password, text_hash

TEMPLATE = REPO / "scripts" / "templates" / "audiobook.html"
OUT_SEALED = DOCS / "audiobook.html"
OUT_PLAIN = DOCS / "audiobook-local.html"     # .gitignore
START, END = "<!-- AUDIOBOOK-DATA:START -->", "<!-- AUDIOBOOK-DATA:END -->"


def compact_chapter(ch: dict) -> dict:
    return {
        "id": ch["id"], "number": ch["number"], "title": ch["title"],
        "chars": ch["chars"], "words": ch["words"], "sentenceCount": ch["sentenceCount"],
        # 음원 타임라인이 이 본문 기준인지 맞춰 보는 해시 (다르면 플레이어가 그 음원을 쓰지 않는다)
        "sha": text_hash(ch),
        # [kind, text, em spans, sentence spans] — 키 이름을 반복하지 않아 페이지가 가볍다
        "paragraphs": [[p["kind"], p["text"], p["em"], p["sentences"]] for p in ch["paragraphs"]],
    }


def leaked(page: str, books: list[dict]) -> str | None:
    """잠근 페이지에 본문이 평문으로 들어갔는지: 챕터마다 가장 긴 문장 하나를 찾아본다."""
    for b in books:
        for c in b["chapters"]:
            longest = max((p[1][a:e].strip() for p in c["paragraphs"] for a, e in p[3]), key=len, default="")
            if len(longest) > 40 and json.dumps(longest, ensure_ascii=False)[1:-1][:60] in page:
                return f"{c['id']}: {longest[:40]}…"
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--books-dir", type=Path, default=DEFAULT_BOOKS, help="<책 id>/book.json 들이 있는 폴더")
    ap.add_argument("--plain", action="store_true", help="암호화하지 않은 로컬 전용 페이지 → docs/audiobook-local.html (음원 없음)")
    ap.add_argument("-n", "--dry-run", action="store_true")
    args = ap.parse_args(argv)

    book_files = sorted(args.books_dir.glob("*/book.json"))
    if not book_files:
        print(f"book.json 이 없습니다: {args.books_dir}", file=sys.stderr)
        return 1
    sealer = None if args.plain else Sealer(read_password())

    books, outline = [], []
    for bf in book_files:
        src = json.loads(bf.read_text(encoding="utf-8"))
        if src.get("schema") != "audiobook-text/1":
            print(f"건너뜀 {bf}: 형식 {src.get('schema')}", file=sys.stderr)
            continue
        cfg = book_config(src["id"])
        engines = [{"id": e["id"], "name": e["name"]} for e in cfg.get("engines", [])]
        book = {"id": src["id"], "title": src["title"], "author": src.get("author", ""), "front": src.get("front", {}),
                "chapters": [compact_chapter(ch) for ch in src["chapters"]]}
        if engines and cfg.get("audioBaseUrl") and not args.plain:
            book["audioBase"] = cfg["audioBaseUrl"]
            book["engines"] = engines
            book["defaultEngine"] = cfg.get("defaultEngine", engines[0]["id"])
        books.append(book)
        outline.append({"id": src["id"], "title": src["title"], "author": src.get("author", ""),
                        "chapterCount": len(book["chapters"])})
        print(f"{src['title']} ({src['id']}) 챕터 {len(book['chapters'])}개 · 엔진 {[e['id'] for e in engines] if 'engines' in book else '없음'}")

    payload = {"schema": "audiobook-data/1", "generated": date.today().isoformat(), "books": books}
    plain = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if sealer:
        # 잠그기 전 화면에는 책 제목·저자만 보인다
        data = {"schema": "audiobook-data/1", "generated": payload["generated"], "outline": outline,
                "sealed": sealer.seal_text(plain)}
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    else:
        blob = plain
    blob = blob.replace("</", "<\\/")
    page = TEMPLATE.read_text(encoding="utf-8")
    a, b = page.index(START), page.index(END)
    page = (page[: a + len(START)] + '\n  <script type="application/json" id="audiobook-data">' + blob
            + "</script>\n  " + page[b:])
    out = OUT_PLAIN if args.plain else OUT_SEALED
    if sealer and (hit := leaked(page, books)):
        print(f"중단: 잠근 페이지에 본문 평문이 보입니다 ({hit})", file=sys.stderr)
        return 1
    if args.dry_run:
        print(f"(dry-run) {out} 를 {len(page.encode()) / 1024:.0f}KB 로 쓸 예정")
        return 0
    out.write_text(page, encoding="utf-8")
    print(f"→ {out} ({len(page.encode()) / 1024:.0f}KB, {'암호화' if sealer else '평문 · 로컬 전용'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
