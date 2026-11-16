#!/usr/bin/env python3
"""일상대화 영어 대본 페이지 생성기 — voice-in-scribe 의 ``output/<이름>_일상.json`` 을 ``docs/comm.html`` 에 싣는다.

- 대본 원본: voice-in-scribe ``output/<이름>_일상.json`` (읽기 전용)
- 음원: tts-maker ``output/drama3/ann/comm/<id>.mp3`` + ``<id>.timeline.json`` (있으면). ``docs/audio/comm/<id>.mp3`` 로 복사한다
- ``docs/comm.html`` 의 ``COMM-DATA`` 블록에서 **그 회차만** 갈아 끼운다. 다른 회차는 그대로 둔다

**공개 페이지다**(2026-11-16 사용자 결정 "일단은 공개"). 원 녹음은 싣지 않고 TTS 음원만 싣는다.
docs/ 에 쓰면 hermes 가 한 시간 안에 푸시하므로, 쓰기 전에 금지어를 검사한다.
금지어는 저장소 밖 ``~/.config/macsalogs/comm_blocklist.txt`` (한 줄에 하나 — 가족 · 지인 실명, 학교, 계정 이름 등).
저장소에 두면 금지어 목록 자체가 공개된다.

    python3 scripts/build_comm.py -n 20261107_1700_일상대화     # 무엇을 실을지
    python3 scripts/build_comm.py 20261107_1700_일상대화
    python3 scripts/build_comm.py --remove 2026-11-07-dinner-table
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
PAGE = DOCS / "comm.html"
AUDIO = DOCS / "audio" / "comm"
VIS = Path("/home/magpie/Workspace/dev/macGitHub/voice-in-scribe/output")
TTS = Path("/home/magpie/Workspace/dev/macGitHub/tts-maker/output/drama3/ann/comm")
BLOCK = Path.home() / ".config" / "macsalogs" / "comm_blocklist.txt"
RE_BLOCK = re.compile(r'(<!-- COMM-DATA:START -->\s*<script type="application/json" id="comm-data">)(.*?)(</script>\s*<!-- COMM-DATA:END -->)', re.S)


def read_block() -> dict:
    m = RE_BLOCK.search(PAGE.read_text(encoding="utf-8"))
    if not m:
        sys.exit(f"{PAGE} 에 COMM-DATA 블록이 없다")
    return json.loads(m.group(2))


def write_block(data: dict) -> None:
    text = PAGE.read_text(encoding="utf-8")
    body = json.dumps(data, ensure_ascii=False, indent=1).replace("</", "<\\/")
    PAGE.write_text(RE_BLOCK.sub(lambda m: m.group(1) + "\n" + body + "\n" + m.group(3), text), encoding="utf-8")


def episode(name: str) -> tuple[dict, Path | None]:
    src = VIS / f"{name}_일상.json"
    if not src.exists():
        sys.exit(f"대본이 없다: {src}")
    d = json.loads(src.read_text(encoding="utf-8"))
    tl_path, mp3 = TTS / f"{d['id']}.timeline.json", TTS / f"{d['id']}.mp3"
    tl = json.loads(tl_path.read_text(encoding="utf-8")) if tl_path.exists() and mp3.exists() else None
    times = {(x["scene"], x["i"]): x for x in tl["turns"]} if tl else {}

    scenes = []
    for s in d["scenes"]:
        turns = []
        for i, t in enumerate(s["turns"]):
            row = {"sp": t["sp"], "en": t["en"], "ko": t["ko"]}
            if t.get("conf") == "low":
                row["low"] = True
            if (s["id"], i) in times:
                row["start"], row["end"] = times[(s["id"], i)]["start"], times[(s["id"], i)]["end"]
            elif tl:
                sys.exit(f"시각표에 없는 턴: {s['id']} #{i} — 대본을 고친 뒤 음원을 다시 만들어야 한다")
            turns.append(row)
        scenes.append({"id": s["id"], "title_ko": s["title_ko"], "title_en": s["title_en"], "turns": turns,
                       "expressions": s.get("expressions", [])})
    if tl and len(times) != sum(len(s["turns"]) for s in scenes):
        sys.exit("시각표의 턴 수가 대본과 다르다 — 음원을 다시 만들어야 한다")

    out = {k: d[k] for k in ("id", "date", "title_ko", "title_en", "summary", "note", "speakers") if k in d}
    out["scenes"] = scenes
    out["cautions"] = d.get("cautions", [])
    if tl:
        out.update({"audio": f"audio/comm/{d['id']}.mp3", "duration": tl["duration"], "engine": tl["engine"], "voice": tl["voice"]})
    return out, (mp3 if tl else None)


def blocked(obj: dict) -> list[str]:
    if not BLOCK.exists():
        return []
    words = [w.strip() for w in BLOCK.read_text(encoding="utf-8").splitlines() if w.strip() and not w.startswith("#")]
    text = json.dumps(obj, ensure_ascii=False)
    return [w for w in words if w in text]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="voice-in-scribe 산출물 이름")
    ap.add_argument("--remove", metavar="ID", help="이 회차를 페이지에서 뺀다 (음원도 지운다)")
    ap.add_argument("-n", "--dry-run", action="store_true")
    a = ap.parse_args()

    data = read_block()
    eps = {e["id"]: e for e in data.get("episodes", [])}
    if a.remove:
        if a.remove not in eps:
            sys.exit(f"없는 회차: {a.remove}")
        print(f"뺀다: {a.remove}")
        if not a.dry_run:
            del eps[a.remove]
            (AUDIO / f"{a.remove}.mp3").unlink(missing_ok=True)
    if not BLOCK.exists():
        print(f"경고: 금지어 목록이 없다 ({BLOCK}) — 실명 검사를 하지 않는다")
    for name in a.names:
        e, mp3 = episode(name)
        hits = blocked(e)
        if hits:
            sys.exit(f"{name}: 공개하면 안 되는 낱말이 들어 있다 — {hits}. 대본을 고친 뒤 다시 돌린다")
        n = sum(len(s["turns"]) for s in e["scenes"])
        print(f"{'갱신' if e['id'] in eps else '추가'}: {e['id']} · 장면 {len(e['scenes'])} · 턴 {n} · "
              + (f"음원 {e['duration'] / 60:.1f}분 ({mp3.stat().st_size / 1e6:.1f}MB)" if mp3 else "음원 없음 (대본만)"))
        if a.dry_run:
            continue
        if mp3:
            AUDIO.mkdir(parents=True, exist_ok=True)
            shutil.copy2(mp3, AUDIO / mp3.name)
        eps[e["id"]] = e
    if a.dry_run:
        print("[dry-run] 쓰지 않았다")
        return 0
    data["episodes"] = sorted(eps.values(), key=lambda e: (e["date"], e["id"]), reverse=True)
    write_block(data)
    print(f"{PAGE.relative_to(REPO)} · 회차 {len(data['episodes'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
