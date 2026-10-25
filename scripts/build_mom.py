#!/usr/bin/env python3
"""MOM(회의록) 페이지 생성기 — voice-in-scribe 의 대본형 회의록을 암호화해 docs/ 에 싣는다.

원본은 voice-in-scribe 저장소의 ``output/<이름>_대본.json`` 과 ``_대본.html`` 이다(읽기 전용).
이 저장소는 공개 GitHub Pages 라서 **평문을 한 글자도 남기지 않는다.**

- ``docs/mom.html``        회의록 목록. 목록 JSON 을 암호화해 넣는다
- ``docs/mom/<id>.html``   회의별 대본 페이지. 대본 HTML 전체를 암호화해 넣는다
- ``<id>`` 는 암호를 키로 한 HMAC 이라 파일 이름 · Release 자산 이름에서 회의를 알 수 없다

암호는 ``MOM_PASSWORD`` 환경변수 또는 ``~/.config/macsalogs/mom_password`` 에서 읽는다.
암호를 바꾸면 id 도 바뀌므로 녹음 Release 를 다시 올려야 한다.

    python3 scripts/build_mom.py            # 생성 + 녹음 업로드 명령 출력
    python3 scripts/build_mom.py -n         # 무엇을 만들지 확인만

브라우저 쪽 복호화는 ``docs/js/mom.js`` 가 한다 (PBKDF2-SHA256 → AES-256-GCM, WebCrypto).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
VIS = Path("/home/magpie/Workspace/dev/macGitHub/voice-in-scribe")
PASSWORD_FILE = Path.home() / ".config" / "macsalogs" / "mom_password"
# 녹음은 저장소에 두지 않고 Release 자산으로 올린다 (TVShow 와 같은 이유 — Pages 1GB 상한, git 이력)
RELEASE_TAG = "mom-audio-v1"
AUDIO_BASE = f"https://github.com/magpie1st/MacsALogs/releases/download/{RELEASE_TAG}"
ITERATIONS = 600_000
STAGE = REPO / ".mom-audio"  # 업로드할 녹음을 id 이름으로 모으는 곳 (.gitignore)

START, END = "<!-- MOM-DATA:START -->", "<!-- MOM-DATA:END -->"


def password() -> str:
    pw = os.environ.get("MOM_PASSWORD") or (PASSWORD_FILE.read_text().strip() if PASSWORD_FILE.exists() else "")
    if len(pw) < 12:
        sys.exit(f"암호가 없거나 12자보다 짧다: MOM_PASSWORD 또는 {PASSWORD_FILE}")
    return pw


def seal(pw: str, plain: str) -> str:
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITERATIONS, 32)
    ct = AESGCM(key).encrypt(iv, plain.encode(), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return json.dumps({"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)})


def meeting_id(pw: str, stem: str) -> str:
    return "m" + hmac.new(pw.encode(), stem.encode(), "sha256").hexdigest()[:12]


def meetings(pw: str) -> list[dict]:
    out = []
    for js in sorted((VIS / "output").glob("*_대본.json"), reverse=True):
        stem = js.name.removesuffix("_대본.json")
        page = js.with_name(f"{stem}_대본.html")
        if not page.exists():
            print(f"  건너뜀 {stem}: _대본.html 이 없다 — dialogue.py build 먼저")
            continue
        if page.stat().st_mtime < js.stat().st_mtime:
            print(f"  ⚠ {stem}: _대본.html 이 json 보다 오래됐다 — dialogue.py build 를 다시 돌릴 것")
        d = json.loads(js.read_text(encoding="utf-8"))
        audio = VIS / d["audio"] if d.get("audio") else None
        mid = meeting_id(pw, stem)
        out.append({
            "id": mid, "stem": stem, "page": page, "audio": audio if audio and audio.exists() else None,
            "meta": {
                "id": mid,
                "title": d["title"], "date": d["date"], "place": d.get("place", ""),
                "speakers": [s["name"] for s in d["speakers"]],
                "turns": len(d["turns"]), "items": len(d.get("refs", {})),
                "minutes": round(max((t.get("end") or 0) for t in d["turns"]) / 60) if d["turns"] else 0,
            },
        })
    return out


def detail_html(m: dict) -> str:
    """대본 HTML 의 녹음 경로를 Release 주소로 바꾸고 목록으로 가는 링크를 넣는다."""
    h = m["page"].read_text(encoding="utf-8")
    src = re.search(r'<audio id="audio"[^>]*src="([^"]*)"', h)
    if src and src.group(1):
        h = h.replace(src.group(1), f"{AUDIO_BASE}/{m['id']}.m4a")
    back = ('<a href="../mom.html" style="display:inline-block;margin-bottom:6px;font-size:.9em;'
            'color:inherit;opacity:.7;text-decoration:none">← 회의록 목록</a>')
    h = h.replace('<header class="top"><div class="wrap">', f'<header class="top"><div class="wrap">\n  {back}', 1)
    return h


def put(path: Path, data: str) -> None:
    text = path.read_text(encoding="utf-8")
    a, b = text.index(START) + len(START), text.index(END)
    path.write_text(text[:a] + f'\n<script type="application/json" id="mom-data">{data}</script>\n' + text[b:],
                    encoding="utf-8")


DETAIL = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>MOM — MacsALogs</title>
  <link rel="stylesheet" href="../css/style.css" />
</head>
<body>
  <main class="container mom-lock-page">
    <p><a href="../mom.html">← 회의록 목록</a></p>
    <div id="mom-lock"></div>
  </main>
  <!-- MOM-DATA:START --><!-- MOM-DATA:END -->
  <script src="../js/mom.js"></script>
  <script>MOM.openDetail();</script>
</body>
</html>
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("-n", "--dry-run", action="store_true")
    a = ap.parse_args()

    pw = password()
    ms = meetings(pw)
    print(f"회의 {len(ms)}건")
    for m in ms:
        print(f"  {m['id']}  {m['stem']}  녹음 {'있음' if m['audio'] else '없음'}")
    if a.dry_run:
        return

    out = DOCS / "mom"
    out.mkdir(exist_ok=True)
    keep = set()
    for m in ms:
        p = out / f"{m['id']}.html"
        p.write_text(DETAIL, encoding="utf-8")
        put(p, seal(pw, detail_html(m)))
        keep.add(p.name)
    for p in out.glob("*.html"):
        if p.name not in keep:
            p.unlink()
            print(f"  지움 {p.name} (원본에 없는 회의)")
    put(DOCS / "mom.html", seal(pw, json.dumps([m["meta"] for m in ms], ensure_ascii=False)))
    print(f"갱신: docs/mom.html, docs/mom/ ({len(ms)}개)")

    # 녹음은 id 이름으로 모아 두고 업로드 명령만 출력한다. 업로드는 사람이 한다
    shutil.rmtree(STAGE, ignore_errors=True)
    STAGE.mkdir()
    files = []
    for m in ms:
        if m["audio"]:
            dst = STAGE / f"{m['id']}.m4a"
            os.link(m["audio"], dst) if m["audio"].stat().st_dev == STAGE.stat().st_dev else shutil.copy2(m["audio"], dst)
            files.append(str(dst.relative_to(REPO)))
    if files:
        print("\n녹음 업로드 (공개 Release — 누구나 내려받을 수 있다):")
        print(f"  gh release create {RELEASE_TAG} --repo magpie1st/MacsALogs --title 'MOM audio' --notes '' \\")
        print(f"      {' '.join(files)}")
        print(f"  # 이미 있으면: gh release upload {RELEASE_TAG} --repo magpie1st/MacsALogs --clobber {' '.join(files)}")


if __name__ == "__main__":
    main()
