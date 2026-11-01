#!/usr/bin/env python3
"""오디오북 페이지(docs/audiobook.html)를 만든다.

입력 (둘 다 읽기 전용, 이 저장소 밖):
  - 본문: book-maker 의 output/audiobook/<책 id>/book.json  (문단·문장 분리가 끝난 텍스트)
  - 음원: tts-maker 의 output/gemini/audiobook/<책 id>/<챕터 id>.{json,mp3}  (문장 타임라인 + mp3)

타임라인의 textSha256 이 지금 본문과 다르면 그 챕터는 음원 없이 싣는다 — 강조가 밀린 페이지보다 낫다.

음원 주소:
  - docs/audio/audiobook/<책 id>/config.json 에 audioBaseUrl 이 있으면 <base>/<책 id>-<챕터 id>.mp3 (Release 자산)
  - --local-audio 면 mp3 를 docs/audio/audiobook/<책 id>/ 로 복사하고 상대경로 (gitignore, 미리보기)
  - 둘 다 아니면 본문만 싣는다

    python3 scripts/build_audiobook.py -n
    python3 scripts/build_audiobook.py --local-audio
    python3 scripts/serve_docs.py   # → http://localhost:8788/audiobook.html

생성물(docs/audiobook.html, docs/audio/audiobook/)은 .gitignore 에 있다. 책 본문 전문이 들어가므로
공개 저장소에 올리지 않는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
TEMPLATE = REPO / "scripts" / "templates" / "audiobook.html"
OUT = DOCS / "audiobook.html"
CODE_ROOT = REPO.parent
DEFAULT_BOOKS = CODE_ROOT / "book-maker" / "output" / "audiobook"
DEFAULT_AUDIO = CODE_ROOT / "tts-maker" / "output" / "gemini" / "audiobook"
START, END = "<!-- AUDIOBOOK-DATA:START -->", "<!-- AUDIOBOOK-DATA:END -->"


def text_hash(chapter: dict) -> str:
    """tts-maker gemini/audiobook_gemini.py 의 text_hash 와 같은 계산이어야 한다."""
    rows = [[p["text"], p["sentences"]] for p in chapter["paragraphs"]]
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def load_audio(book_id: str, chapter: dict, audio_dir: Path, base_url: str | None, local: bool,
               dry: bool) -> tuple[dict | None, str]:
    manifest_path = audio_dir / book_id / f"{chapter['id']}.json"
    mp3 = audio_dir / book_id / f"{chapter['id']}.mp3"
    if not manifest_path.exists():
        return None, "음원 없음"
    m = json.loads(manifest_path.read_text(encoding="utf-8"))
    if m.get("schema") != "audiobook-audio/1":
        return None, f"알 수 없는 타임라인 형식 {m.get('schema')}"
    if m.get("textSha256") != text_hash(chapter):
        return None, "타임라인이 지금 본문과 다름 (다시 생성 필요)"
    if len(m["rows"]) != chapter["sentenceCount"]:
        return None, f"문장 수 불일치 {len(m['rows'])}/{chapter['sentenceCount']}"
    audio = {"durationSec": m["audio"]["durationSec"], "voice": " ".join(x for x in (m["engine"].get("name", "").replace("gemini", "Gemini TTS"), m["engine"].get("voice")) if x),
             "rows": [[r[2], r[3]] for r in m["rows"]]}   # 문장 번호 = 배열 순서
    if base_url:
        audio["file"] = f"{base_url.rstrip('/')}/{book_id}-{chapter['id']}.mp3"
        return audio, "Release"
    if local:
        if not mp3.exists():
            return None, "타임라인은 있으나 mp3 없음"
        dest = DOCS / "audio" / "audiobook" / book_id / mp3.name
        if not dry:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or dest.stat().st_size != mp3.stat().st_size:
                shutil.copy2(mp3, dest)
        audio["file"] = f"audio/audiobook/{book_id}/{mp3.name}"
        audio["preview"] = True
        return audio, "로컬 미리보기"
    return None, "음원 주소 없음 (config.json 또는 --local-audio)"


def compact_chapter(ch: dict) -> dict:
    return {
        "id": ch["id"], "number": ch["number"], "title": ch["title"],
        "chars": ch["chars"], "words": ch["words"], "sentenceCount": ch["sentenceCount"],
        # [kind, text, em spans, sentence spans] — 키 이름을 반복하지 않아 페이지가 가볍다
        "paragraphs": [[p["kind"], p["text"], p["em"], p["sentences"]] for p in ch["paragraphs"]],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--books-dir", type=Path, default=DEFAULT_BOOKS, help="<책 id>/book.json 들이 있는 폴더")
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO, help="tts-maker 오디오북 출력 폴더")
    ap.add_argument("--local-audio", action="store_true", help="mp3 를 docs 로 복사해 로컬에서 듣는다")
    ap.add_argument("-n", "--dry-run", action="store_true")
    args = ap.parse_args(argv)

    book_files = sorted(args.books_dir.glob("*/book.json"))
    if not book_files:
        print(f"book.json 이 없습니다: {args.books_dir}", file=sys.stderr)
        return 1

    books = []
    for bf in book_files:
        src = json.loads(bf.read_text(encoding="utf-8"))
        if src.get("schema") != "audiobook-text/1":
            print(f"건너뜀 {bf}: 형식 {src.get('schema')}", file=sys.stderr)
            continue
        cfg_path = DOCS / "audio" / "audiobook" / src["id"] / "config.json"
        base_url = json.loads(cfg_path.read_text()).get("audioBaseUrl") if cfg_path.exists() else None
        chapters = []
        voiced = 0
        print(f"{src['title']} ({src['id']})")
        for ch in src["chapters"]:
            audio, note = load_audio(src["id"], ch, args.audio_dir, base_url, args.local_audio, args.dry_run)
            c = compact_chapter(ch)
            if audio:
                c["audio"] = audio
                voiced += 1
            chapters.append(c)
            print(f"  {ch['id']:10} 문장 {ch['sentenceCount']:4}  "
                  + (f"♪ {audio['durationSec'] / 60:5.1f}분 ({note})" if audio else f"— {note}"))
        books.append({"id": src["id"], "title": src["title"], "author": src.get("author", ""),
                      "front": src.get("front", {}), "chapters": chapters})
        print(f"  → 챕터 {len(chapters)}개 중 음원 {voiced}개")

    payload = {"schema": "audiobook-data/1", "generated": date.today().isoformat(), "books": books}
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = TEMPLATE.read_text(encoding="utf-8")
    a, b = page.index(START), page.index(END)
    page = (page[: a + len(START)] + '\n  <script type="application/json" id="audiobook-data">' + blob
            + "</script>\n  " + page[b:])
    if args.dry_run:
        print(f"(dry-run) {OUT} 를 {len(page.encode()) / 1024:.0f}KB 로 쓸 예정")
        return 0
    OUT.write_text(page, encoding="utf-8")
    print(f"→ {OUT} ({len(page.encode()) / 1024:.0f}KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
