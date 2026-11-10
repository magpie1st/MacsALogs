#!/usr/bin/env python3
"""오디오북 페이지를 만든다. 기본은 **암호화** 페이지(docs/audiobook.html, 블로그에 올림).

입력 (둘 다 읽기 전용, 이 저장소 밖):
  - 본문: book-maker 의 output/audiobook/<책 id>/book.json  (문단·문장 분리가 끝난 텍스트)
  - 음원: tts-maker 의 output/gemini/audiobook/<책 id>/<챕터 id>.{json,mp3}  (문장 타임라인 + mp3)

암호화 (기본)
  - 책 본문·타임라인 전체를 AES-256-GCM 으로 잠가 페이지에 싣는다. 열쇠는 PBKDF2-SHA256(암호, salt, 60만 회).
    평문으로 보이는 것은 책 제목·저자뿐이다. 복호화는 브라우저(docs/js/audiobook.js, WebCrypto)가 한다
  - 암호: AUDIOBOOK_PASSWORD 또는 ~/.config/macsalogs/audiobook_password (12자 이상).
    설정은 `python3 scripts/audiobook_password.py`. 저장소에 두지 않는다
  - salt 는 scripts/audiobook_crypto.json (비밀 아님, 커밋). 같은 암호면 같은 열쇠라 이미 올린 음원을 다시 암호화하지 않는다
  - 음원도 같은 열쇠로 잠근다: <챕터>-<HMAC(열쇠, mp3 sha256) 앞 12자>.bin = iv(12바이트) + 암호문.
    암호를 바꾸면 이름이 바뀌어 다시 올리게 된다. 잠근 음원은 .audiobook-audio/<책>/ 에 모인다 (gitignore)
  - 쓰고 나서 페이지에 본문 문장이 평문으로 남지 않았는지 검사한다. 남았으면 파일을 지우고 실패한다

음원 주소 (잠근 .bin)
  - 엔진마다 저장소를 따로 쓰려면 config.json 의 engineAudio = {엔진: {audioBaseUrl, audioRepoDir}} (없으면 아래 책 기본)
  - docs/audio/audiobook/<책>/config.json 의 audioBaseUrl 이 https 이고 audioRepoDir 가 있으면, 잠근 .bin 을 그 로컬 폴더로 복사한다.
    지금 방식: 음원 전용 저장소 magpie1st/audiobook-audio 의 Pages (블로그와 같은 도메인 → CORS 문제 없음, Pages 용량도 따로)
  - audioBaseUrl 이 상대경로면 이 블로그 Pages 안 (docs/<경로>)
  - audioBaseUrl 이 https 이고 audioRepoDir 가 없으면 주소만 쓴다 — **CORS 를 허용하는 곳**이어야 한다.
    GitHub Pages 는 허용, GitHub Release 는 허용하지 않아(2026-11-01 확인) 브라우저가 받아 풀 수 없다
  - --local-audio 면 docs/audio/audiobook/<책>/ 로 복사하고 상대경로. 이 빌드는 docs/audiobook-local.html 로 간다 (gitignore)
  - 둘 다 없으면 본문만

타임라인의 textSha256 이 지금 본문과 다르면 그 챕터는 음원 없이 싣는다 — 강조가 밀린 페이지보다 낫다.

    uv run --with cryptography python scripts/build_audiobook.py -n
    uv run --with cryptography python scripts/build_audiobook.py                 # → docs/audiobook.html (암호화)
    python3 scripts/build_audiobook.py --plain --local-audio                     # → docs/audiobook-local.html (평문, 로컬 전용)
    uv run --with cryptography python scripts/build_audiobook.py --local-audio   # → docs/audiobook-local.html (암호화 미리보기)
    python3 scripts/serve_docs.py                                                # http://localhost:8788/audiobook.html
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import shutil
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
TEMPLATE = REPO / "scripts" / "templates" / "audiobook.html"
OUT_SEALED = DOCS / "audiobook.html"
OUT_PLAIN = DOCS / "audiobook-local.html"     # .gitignore
STAGE = REPO / ".audiobook-audio"             # 잠근 음원 모음 (.gitignore)
CRYPTO_FILE = REPO / "scripts" / "audiobook_crypto.json"
PASSWORD_FILE = Path(os.path.expanduser("~/.config/macsalogs/audiobook_password"))
ITERATIONS = 600_000
CODE_ROOT = REPO.parent
DEFAULT_BOOKS = CODE_ROOT / "book-maker" / "output" / "audiobook"
# 엔진별 음원 폴더. 페이지에는 챕터마다 있는 엔진을 모두 싣고, 기본 엔진은 config.json 의 defaultEngine 으로 정한다
# id 는 config.json 의 defaultEngine 값이자 잠근 음원 파일 이름 앞머리다. 바꾸면 이미 올린 .bin 이름이 바뀐다
ENGINES = {
    "kokoro-af_heart": CODE_ROOT / "tts-maker" / "output" / "kokoro" / "af_heart" / "audiobook",
    "drama3-ann": CODE_ROOT / "tts-maker" / "output" / "drama3" / "ann" / "audiobook",   # Drama3-Ann (Drama 3 + 참조 음성, 2026-11-06)
}
START, END = "<!-- AUDIOBOOK-DATA:START -->", "<!-- AUDIOBOOK-DATA:END -->"


def text_hash(chapter: dict) -> str:
    """tts-maker gemini/audiobook_gemini.py 의 text_hash 와 같은 계산이어야 한다."""
    rows = [[p["text"], p["sentences"]] for p in chapter["paragraphs"]]
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


# ── 암호 ──────────────────────────────────────────────────────────────────

class Sealer:
    def __init__(self, password: str):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # 암호화 빌드에서만 필요
        if not CRYPTO_FILE.exists():
            CRYPTO_FILE.write_text(json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
                                               "salt": b64(os.urandom(16))}, indent=1) + "\n")
        cfg = json.loads(CRYPTO_FILE.read_text())
        self.salt_b64, self.iter = cfg["salt"], cfg["iter"]
        self.key = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(self.salt_b64), self.iter, 32)
        self.aes = AESGCM(self.key)

    def seal_text(self, plain: str) -> dict:
        iv = os.urandom(12)
        return {"v": 1, "iter": self.iter, "salt": self.salt_b64, "iv": b64(iv),
                "ct": b64(self.aes.encrypt(iv, plain.encode(), None))}

    def asset_name(self, chapter_id: str, mp3_sha: str) -> str:
        tag = hmac.new(self.key, mp3_sha.encode(), hashlib.sha256).hexdigest()[:12]
        return f"{chapter_id}-{tag}.bin"

    def seal_file(self, src: Path, dest: Path) -> None:
        iv = os.urandom(12)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(iv + self.aes.encrypt(iv, src.read_bytes(), None))
        tmp.replace(dest)


def read_password() -> str:
    pw = os.environ.get("AUDIOBOOK_PASSWORD") or (PASSWORD_FILE.read_text().rstrip("\n") if PASSWORD_FILE.exists() else "")
    if len(pw) < 12:
        sys.exit(f"암호가 없거나 12자보다 짧습니다. 먼저 `python3 scripts/audiobook_password.py` 로 정하세요 ({PASSWORD_FILE})")
    return pw


# ── 음원 ──────────────────────────────────────────────────────────────────

def load_audio(book_id: str, chapter: dict, args, base_url: str | None, sealer: Sealer | None,
               engine: str, audio_dir: Path, repo_dir: Path | None = None) -> tuple[dict | None, str]:
    manifest_path = audio_dir / book_id / f"{chapter['id']}.json"
    mp3 = audio_dir / book_id / f"{chapter['id']}.mp3"
    if not manifest_path.exists():
        return None, "음원 없음"
    m = json.loads(manifest_path.read_text(encoding="utf-8"))
    if m.get("schema") != "audiobook-audio/1":
        return None, f"알 수 없는 타임라인 형식 {m.get('schema')}"
    if m.get("textSha256") != text_hash(chapter):
        return None, "타임라인이 지금 본문과 다름 (다시 생성 필요)"
    partial = bool(m.get("partial"))
    if not m["rows"] or len(m["rows"]) > chapter["sentenceCount"] \
            or (len(m["rows"]) != chapter["sentenceCount"] and not partial):
        return None, f"문장 수 불일치 {len(m['rows'])}/{chapter['sentenceCount']}"
    if [r[1] for r in m["rows"]] != list(range(len(m["rows"]))):
        return None, "타임라인 문장 번호가 앞에서부터 이어지지 않음"
    if not mp3.exists():
        return None, "타임라인은 있으나 mp3 없음"
    meta = m.get("engine", {})
    audio = {"durationSec": m["audio"]["durationSec"],
             "voice": " ".join(x for x in (meta.get("name", "").replace("gemini", "Gemini TTS"), meta.get("voice")) if x),
             "rows": [[r[2], r[3]] for r in m["rows"]]}   # 문장 번호 = 배열 순서. 부분 음원이면 앞부분만
    if partial:
        audio["partial"] = True

    audio["engine"] = engine
    if sealer:
        name = f"{engine}-" + sealer.asset_name(chapter["id"], hashlib.sha256(mp3.read_bytes()).hexdigest())
        staged = STAGE / book_id / name
        if not args.dry_run and not staged.exists():
            sealer.seal_file(mp3, staged)
        audio["enc"] = True
        where = staged
    else:
        name, where = f"{engine}-{mp3.name}", mp3

    if base_url and not args.local_audio:
        audio["file"] = f"{base_url.rstrip('/')}/{name}"
        if not sealer:
            return None, "공개 경로에는 잠근 음원만 둔다 (--plain 빌드에서는 싣지 않음)"
        if "://" in base_url:
            if repo_dir is None:   # 바깥 호스트에 올리는 것은 사람이 한다
                return audio, f"{base_url} (올릴 파일: {where})"
            dest_dir = repo_dir     # 음원 전용 저장소의 로컬 폴더 (그 저장소의 Pages 가 base_url)
        else:
            # 이 블로그의 Pages 안. 잠근 .bin 만 커밋한다
            dest_dir = DOCS / base_url.strip("/")
        if not args.dry_run:
            dest_dir.mkdir(parents=True, exist_ok=True)
            for old in dest_dir.glob(f"{engine}-{chapter['id']}-*.bin"):
                if old.name != name:
                    old.unlink()
            if not (dest_dir / name).exists():
                shutil.copy2(where, dest_dir / name)
        return audio, f"{dest_dir}/{name}"
    if args.local_audio:
        dest = DOCS / "audio" / "audiobook" / book_id / name
        if not args.dry_run and (not dest.exists() or dest.stat().st_size != where.stat().st_size):
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(where, dest)
        audio["file"] = f"audio/audiobook/{book_id}/{name}"
        audio["preview"] = True
        return audio, "로컬 미리보기"
    return None, "음원 주소 없음 (config.json 의 audioBaseUrl 또는 --local-audio)" + (f" — 잠근 파일 {where}" if sealer else "")


def compact_chapter(ch: dict) -> dict:
    return {
        "id": ch["id"], "number": ch["number"], "title": ch["title"],
        "chars": ch["chars"], "words": ch["words"], "sentenceCount": ch["sentenceCount"],
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
    ap.add_argument("--engines", default=",".join(ENGINES), help="실을 엔진 (쉼표로). 기본: 전부")
    ap.add_argument("--plain", action="store_true", help="암호화하지 않은 로컬 전용 페이지 → docs/audiobook-local.html")
    ap.add_argument("--local-audio", action="store_true", help="음원을 docs 로 복사해 로컬에서 듣는다 (올리지 않는 빌드)")
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
        cfg_path = DOCS / "audio" / "audiobook" / src["id"] / "config.json"
        cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
        # 엔진마다 음원 저장소를 따로 쓸 수 있다: config.json 의 engineAudio = { 엔진: { audioBaseUrl, audioRepoDir } }.
        # 없는 엔진은 책 기본(audioBaseUrl / audioRepoDir)을 쓴다
        def target(eng):
            e = cfg.get("engineAudio", {}).get(eng, {})
            rd = e.get("audioRepoDir", cfg.get("audioRepoDir"))
            # audioRepoDir: base_url 이 다른 저장소의 Pages 일 때 그 저장소의 로컬 폴더 (이 저장소 기준 상대경로 가능)
            return e.get("audioBaseUrl", cfg.get("audioBaseUrl")), ((REPO / rd).resolve() if rd else None)
        engines = [e.strip() for e in args.engines.split(",") if e.strip() in ENGINES]
        if sealer and not args.local_audio:
            for eng in engines:
                rd = target(eng)[1]
                if rd and next((d for d in [rd, *rd.parents] if (d / ".git").exists()), None) is None:
                    # 음원 저장소 없이 새 주소를 가리키는 페이지를 올리면 재생이 깨진다
                    print(f"중단: {eng} 의 음원 저장소가 준비되지 않았습니다 ({rd} 위에 .git 없음). "
                          f"config.json 의 audioRepoDir / engineAudio 를 확인하세요", file=sys.stderr)
                    return 1
        default_engine = cfg.get("defaultEngine", engines[0] if engines else "drama3-ann")
        chapters, voiced = [], 0
        print(f"{src['title']} ({src['id']})")
        for ch in src["chapters"]:
            c = compact_chapter(ch)
            notes = []
            for eng in engines:
                audio, note = load_audio(src["id"], ch, args, *target(eng)[:1], sealer, eng, ENGINES[eng], target(eng)[1])
                if audio:
                    c.setdefault("audios", {})[eng] = audio
                    part = f" 부분 {len(audio['rows'])}/{ch['sentenceCount']}" if audio.get("partial") else ""
                    notes.append(f"{eng} ♪{audio['durationSec'] / 60:.1f}분{part}")
                else:
                    notes.append(f"{eng} —")
            if c.get("audios"):
                voiced += 1
            chapters.append(c)
            print(f"  {ch['id']:10} 문장 {ch['sentenceCount']:4}  " + " · ".join(notes))
        books.append({"id": src["id"], "title": src["title"], "author": src.get("author", ""),
                      "front": src.get("front", {}), "defaultEngine": default_engine, "chapters": chapters})
        outline.append({"id": src["id"], "title": src["title"], "author": src.get("author", ""),
                        "chapterCount": len(chapters)})
        print(f"  → 챕터 {len(chapters)}개 중 음원 {voiced}개")

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
    # 블로그에 올리는 docs/audiobook.html 은 언제나 "암호화 + 미리보기 음원 없음" 이다. 그 밖의 빌드는 로컬 전용 파일로 간다
    out = OUT_PLAIN if (args.plain or args.local_audio) else OUT_SEALED
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
