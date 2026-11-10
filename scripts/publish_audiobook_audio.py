#!/usr/bin/env python3
"""엔진 하나의 오디오북 음원을 잠가서 음원 저장소 폴더에 넣는다 (복사까지만. 커밋·푸시는 사람이).

페이지(build_audiobook.py)와 완전히 따로 돈다. 이 PC 에 있는 엔진 음원만 올리면 되고, 다른 엔진은 건드리지 않는다.

입력
  - 본문: book-maker 의 output/audiobook/<책 id>/book.json
  - 음원: 엔진 폴더 <ENGINES[엔진]>/<책 id>/<챕터 id>.{json,mp3}   (audiobook-audio/1: 문장 타임라인 + mp3)
출력 (음원 저장소 = 기본 ../audiobook-audio, GitHub Pages 로 서빙)
  <저장소>/<엔진>/<책 id>/<챕터>-<태그>.bin   잠근 mp3 (iv 12바이트 + AES-256-GCM)
  <저장소>/<엔진>/<책 id>/manifest.bin        잠근 목록 {chapters: {id: {file, sha, durationSec, voice, rows}}}
브라우저는 암호를 풀면 엔진마다 manifest.bin 을 받아 챕터에 붙인다. 책 본문이 바뀌어 sha 가 다르면 그 음원은 쓰지 않는다.

이미 올린 manifest 가 있으면 합친다: 이번에 처리한 챕터만 바꾸고, 이 PC 에 음원이 없는 챕터는 그대로 둔다.

    uv run --with cryptography python scripts/publish_audiobook_audio.py --engine drama3-ann -n
    uv run --with cryptography python scripts/publish_audiobook_audio.py --engine drama3-ann [--book my-oxford-year] [--chapters ch01 ch02]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from audiobook_common import CODE_ROOT, DEFAULT_BOOKS, REPO, Sealer, book_config, read_password, text_hash

SCHEMA = "audiobook-manifest/1"
# 엔진별 음원 폴더. id 는 음원 저장소의 폴더 이름이자 config.json engines[].id
ENGINES = {
    "drama3-ann": CODE_ROOT / "tts-maker" / "output" / "drama3" / "ann" / "audiobook",   # Drama3-Ann (Drama 3 + 참조 음성 B)
}


def check(book_id: str, chapter: dict, audio_dir: Path):
    """(entry, mp3 경로, 사유). 음원 파일이 없으면 entry=None 이고 사유가 '없음', 본문과 안 맞으면 '불일치'."""
    mp = audio_dir / book_id / f"{chapter['id']}.json"
    mp3 = audio_dir / book_id / f"{chapter['id']}.mp3"
    if not mp.exists():
        return None, None, "없음"
    m = json.loads(mp.read_text(encoding="utf-8"))
    if m.get("schema") != "audiobook-audio/1":
        return None, None, f"알 수 없는 형식 {m.get('schema')}"
    sha = text_hash(chapter)
    if m.get("textSha256") != sha:
        return None, None, "불일치: 타임라인이 지금 본문과 다름 (다시 생성 필요)"
    partial = bool(m.get("partial"))
    n = chapter["sentenceCount"]
    if not m["rows"] or len(m["rows"]) > n or (len(m["rows"]) != n and not partial):
        return None, None, f"불일치: 문장 수 {len(m['rows'])}/{n}"
    if [r[1] for r in m["rows"]] != list(range(len(m["rows"]))):
        return None, None, "불일치: 문장 번호가 앞에서부터 이어지지 않음"
    if not mp3.exists():
        return None, None, "불일치: 타임라인은 있으나 mp3 없음"
    meta = m.get("engine", {})
    entry = {"sha": sha, "durationSec": m["audio"]["durationSec"],
             "voice": " ".join(x for x in (meta.get("name", "").replace("gemini", "Gemini TTS"), meta.get("voice")) if x),
             "rows": [[r[2], r[3]] for r in m["rows"]]}
    if partial:
        entry["partial"] = True
    return entry, mp3, ""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--engine", required=True, choices=sorted(ENGINES))
    ap.add_argument("--book", help="책 id (기본: book.json 이 있는 책 전부)")
    ap.add_argument("--chapters", nargs="*", help="이 챕터만 (기본: 전부)")
    ap.add_argument("--books-dir", type=Path, default=DEFAULT_BOOKS)
    ap.add_argument("--repo", type=Path, default=None, help="음원 저장소 폴더 (기본: config.json audioRepoDir)")
    ap.add_argument("-n", "--dry-run", action="store_true")
    a = ap.parse_args(argv)

    sealer = Sealer(read_password())
    books = sorted(a.books_dir.glob("*/book.json"))
    if a.book:
        books = [b for b in books if b.parent.name == a.book]
    if not books:
        print("book.json 이 없습니다", file=sys.stderr)
        return 1
    problems = 0
    for bf in books:
        src = json.loads(bf.read_text(encoding="utf-8"))
        bid = src["id"]
        cfg = book_config(bid)
        repo = (a.repo or (REPO / cfg.get("audioRepoDir", "../audiobook-audio"))).resolve()
        if not (repo / ".git").exists():
            print(f"중단: 음원 저장소가 없습니다 ({repo} 위에 .git 없음)", file=sys.stderr)
            return 1
        dest = repo / a.engine / bid
        mpath = dest / "manifest.bin"
        chapters = {}
        if mpath.exists():
            chapters = json.loads(sealer.open_bytes(mpath.read_bytes()))["chapters"]   # 암호가 다르면 여기서 실패한다
        ids = {c["id"] for c in src["chapters"]}
        for gone in [k for k in chapters if k not in ids]:
            del chapters[gone]
        print(f"{src['title']} ({bid}) → {dest}")
        for ch in src["chapters"]:
            if a.chapters and ch["id"] not in a.chapters:
                continue
            entry, mp3, why = check(bid, ch, ENGINES[a.engine])
            if entry is None:
                if why == "없음":
                    print(f"  {ch['id']:9} 이 PC 에 음원 없음 — {'기존 것 유지' if ch['id'] in chapters else '건너뜀'}")
                else:
                    print(f"  {ch['id']:9} {why} — 올리지 않고 기존 것도 뺀다")
                    chapters.pop(ch["id"], None)
                    problems += 1
                continue
            name = sealer.asset_name(ch["id"], hashlib.sha256(mp3.read_bytes()).hexdigest())
            entry["file"] = name
            if not a.dry_run:
                if not (dest / name).exists():
                    sealer.seal_file(mp3, dest / name)
                for old in dest.glob(f"{ch['id']}-*.bin"):
                    if old.name != name:
                        old.unlink()
            chapters[ch["id"]] = entry
            part = " 일부" if entry.get("partial") else ""
            print(f"  {ch['id']:9} ♪{entry['durationSec'] / 60:5.1f}분 문장 {len(entry['rows']):3}{part}  {name}")
        manifest = {"schema": SCHEMA, "engine": a.engine, "book": bid, "chapters": chapters}
        if not a.dry_run:
            dest.mkdir(parents=True, exist_ok=True)
            mpath.write_bytes(sealer.seal_bytes(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode()))
            used = {c["file"] for c in chapters.values()} | {"manifest.bin"}
            for orphan in dest.glob("*.bin"):
                if orphan.name not in used:
                    orphan.unlink()
        print(f"  → 챕터 {len(chapters)}개{' (dry-run)' if a.dry_run else ''}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
