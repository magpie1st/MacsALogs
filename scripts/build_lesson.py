#!/usr/bin/env python3
"""전화영어 수업 페이지 생성기 — voice-in-scribe 의 수업 피드백을 암호로 잠가 docs/ 에 싣는다.

원본은 voice-in-scribe 저장소의 ``output/<이름>_수업.html`` · ``_수업.json`` · 누적 색인이다(읽기 전용).
**언제나 암호화한다**(2026-11-06 사용자 결정). 튜터의 이름 · 목소리가 들어가므로 녹음까지 잠근다.

- ``docs/lesson.html``              잠근 목록(수업 카드 + 회차별 지표 표)
- ``docs/lesson/<id>.html``         잠근 수업 페이지(피드백 · 대본 · OPIc)
- ``docs/audio/lesson/<id>-<h>.bin`` 잠근 녹음 = iv 12바이트 + AES-GCM 암호문. 브라우저가 fetch 해서 풀어야 하므로
  CORS 가 되는 Pages 에 둔다(Release 는 안 된다 — 오디오북에서 2026-11-01 확인). 수업당 2MB 안팎
- ``<id>`` 는 암호를 키로 한 HMAC 이라 주소에 날짜 · 주제가 드러나지 않는다

암호: ``LESSON_PASSWORD`` → ``~/.config/macsalogs/lesson_password`` → ``mom_password`` (회의록과 같은 암호) 순.
녹음 열쇠의 salt 는 ``scripts/lesson_crypto.json`` (커밋한다. salt 는 비밀이 아니다).

    uv run --with cryptography python scripts/build_lesson.py -n       # 무엇을 실을지
    uv run --with cryptography python scripts/build_lesson.py          # docs/ 생성
    uv run --with cryptography python scripts/build_lesson.py --push   # + docs/lesson* 만 커밋 · 푸시

**docs/ 에 쓰면 곧 공개된다** — hermes 가 한 시간마다 자동 푸시한다. 그래서 쓰고 나면 평문이 새지 않았는지 검사한다.
"""

from __future__ import annotations

import argparse
import base64
import datetime as _dt
import hashlib
import hmac
import html
import json
import os
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).resolve().parent))
from publish_shows import push_main, run  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
VIS = Path("/home/magpie/Workspace/dev/macGitHub/voice-in-scribe")
CONF = Path.home() / ".config" / "macsalogs"
CRYPTO = REPO / "scripts" / "lesson_crypto.json"
CACHE = REPO / "scripts" / ".lesson_cache.json"  # 평문이 그대로면 다시 잠그지 않는다 (암호문이 매번 바뀌어 커밋이 생기므로). gitignore
AUDIO_DIR = DOCS / "audio" / "lesson"
ITER = 600_000
esc = html.escape


def password() -> str:
    pw = os.environ.get("LESSON_PASSWORD", "")
    for name in ("lesson_password", "mom_password"):
        if not pw and (CONF / name).exists():
            pw = (CONF / name).read_text().strip()
    if len(pw) < 12:
        sys.exit(f"암호가 없거나 12자보다 짧다: LESSON_PASSWORD 또는 {CONF}/lesson_password")
    return pw


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def seal(pw: str, plain: str) -> str:
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITER, 32)
    ct = AESGCM(key).encrypt(iv, plain.encode(), None)
    return json.dumps({"v": 1, "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)})


def audio_salt() -> str:
    if not CRYPTO.exists():
        CRYPTO.write_text(json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(os.urandom(16))},
                                     indent=1) + "\n")
    return json.loads(CRYPTO.read_text())["salt"]


def lesson_id(pw: str, stem: str) -> str:
    return "l" + hmac.new(pw.encode(), stem.encode(), "sha256").hexdigest()[:12]


def lessons(pw: str) -> list[dict]:
    idx_path = VIS / "output" / "_lesson" / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"lessons": []}
    by_stem = {x["stem"]: x for x in idx["lessons"]}
    out = []
    for page in sorted((VIS / "output").glob("*_전화영어*_수업.html")):
        stem = page.name.removesuffix("_수업.html")
        js = page.with_name(f"{stem}_수업.json")
        if not js.exists() or stem not in by_stem:
            print(f"  건너뜀 {stem}: _수업.json 또는 색인 항목이 없다 — lesson_page.py build 먼저")
            continue
        if page.stat().st_mtime < js.stat().st_mtime:
            print(f"  ⚠ {stem}: _수업.html 이 json 보다 오래됐다 — lesson_page.py build 를 다시 돌릴 것")
        tx = json.loads((VIS / "output" / f"{stem}.json").read_text(encoding="utf-8"))
        dz = json.loads((VIS / "output" / f"{stem}_화자.json").read_text(encoding="utf-8"))
        audio = Path(tx["audio_file"])
        out.append({"stem": stem, "id": lesson_id(pw, stem), "page": page, "meta": by_stem[stem],
                    "data": json.loads(js.read_text(encoding="utf-8")), "turns": dz["turns"],
                    "audio": audio if audio.exists() else None, "minutes": round(tx.get("duration_sec", 0) / 60)})
    return sorted(out, key=lambda x: x["stem"], reverse=True)


def opic_audio_urls() -> dict[str, str]:
    """opic.html 에 실린 이야기 제목 → 음원 주소(docs/ 기준). 수업 페이지 OPIc 탭의 낭독이 같은 파일을 쓴다."""
    page = DOCS / "opic.html"
    m = re.search(r'<script type="application/json" id="opic-data">(.*?)</script>', page.read_text(encoding="utf-8"), re.S) if page.exists() else None
    if not m:
        return {}
    return {s["title"]: s["audio"] for t in json.loads(m.group(1))["topics"] for s in t["stories"]}


def detail_plain(x: dict, bin_name: str | None, salt: str) -> str:
    """수업 HTML 의 녹음을 잠근 .bin 으로 바꾸고 목록으로 가는 링크를 넣는다."""
    h = x["page"].read_text(encoding="utf-8")
    h = re.sub(r'(<audio id="audio"[^>]*?) src="[^"]*"', r"\1", h, count=1)  # src 를 비워 두면 error 가 뜬다
    # OPIc 낭독: 로컬 mp3 경로를 블로그 음원 주소로. 음원이 opic.html 에 없으면 비워 두어 재생기가 그 답변을 건너뛴다
    urls = opic_audio_urls()
    h = re.sub(r'data-title="([^"]*)" data-src="[^"]*"',
               lambda m: f'data-title="{m.group(1)}" data-src="' + (f"../{urls[html.unescape(m.group(1))]}" if html.unescape(m.group(1)) in urls else "") + '"', h)
    back = ('<a href="../lesson.html" style="display:inline-block;margin-bottom:6px;font-size:.9em;'
            'color:inherit;opacity:.7;text-decoration:none">← 전화영어 목록</a>')
    h = h.replace('<header class="top"><div class="wrap">', f'<header class="top"><div class="wrap">\n  {back}', 1)
    if bin_name:
        h = h.replace("</body>", f'<script src="../js/lesson.js"></script>\n<script>LESSON.sealedAudio('
                                 f'"../audio/lesson/{bin_name}", "{salt}", {ITER});</script>\n</body>', 1)
    return h


def listing(ls: list[dict]) -> str:
    cards = []
    for x in ls:
        m, d = x["meta"]["metrics"], x["data"]
        cards.append(
            f'<a class="mom-card" href="lesson/{x["id"]}.html">'
            f'<p class="mom-card-meta">{esc(x["meta"]["date"])} {esc(x["meta"]["time"])} · {x["minutes"]}분 · '
            f'튜터 {esc(x["meta"].get("tutor") or "—")}</p>'
            f'<h2 class="mom-card-title">{esc(x["meta"]["topic"])}</h2>'
            f'<p class="mom-card-stats">고칠 문장 {len(d.get("fixes", []))} · OPIc {len(d.get("opic", []))}문항 · '
            f'내 발화 {round(m["mac_share"] * 100)}% · 분당 {m["wpm"]}낱말</p>'
            f'<p class="lesson-summary">{esc(d.get("summary", ""))}</p></a>')
    rows = "".join(
        f'<tr><td>{esc(x["meta"]["date"])}</td><td>{esc(x["meta"]["topic"])}</td>'
        f'<td>{round(x["meta"]["metrics"]["mac_share"] * 100)}%</td><td>{x["meta"]["metrics"]["wpm"]}</td>'
        f'<td>{x["meta"]["metrics"]["fillers_per_100"]}</td><td>{x["meta"]["metrics"]["repeats_per_100"]}</td>'
        f'<td>{len(x["data"].get("fixes", []))}</td></tr>' for x in sorted(ls, key=lambda x: x["stem"]))
    return (f'<div class="mom-list-head"><span class="mom-count">수업 {len(ls)}회</span></div>'
            f'<div class="mom-list">{"".join(cards)}</div>'
            '<h2 class="lesson-h2">회차별 말하기 지표</h2><div class="lesson-table-wrap"><table class="lesson-table">'
            '<thead><tr><th>날짜</th><th>주제</th><th>내 발화</th><th>분당 낱말</th><th>머뭇거림<br><small>100낱말당</small></th>'
            f'<th>되풀이<br><small>100낱말당</small></th><th>고칠 문장</th></tr></thead><tbody>{rows}</tbody></table></div>')


HEAD = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0f0f0f" media="(prefers-color-scheme: dark)" />
  <meta name="robots" content="noindex, nofollow" />
  <title>전화영어 — MacsALogs</title>
  <link rel="stylesheet" href="{css}" />
"""

LIST_PAGE = HEAD.format(css="css/style.css") + """  <style>
    .lesson-summary { font-size: .88rem; color: var(--text-muted); margin: .5rem 0 0; line-height: 1.6; }
    .lesson-h2 { font-size: 1.05rem; margin: 2rem 0 .75rem; }
    .lesson-table-wrap { overflow-x: auto; padding-bottom: 3rem; }
    .lesson-table { border-collapse: collapse; width: 100%; font-size: .85rem; }
    .lesson-table th, .lesson-table td { border-bottom: 1px solid var(--border); padding: .45rem .5rem; text-align: right; white-space: nowrap; }
    .lesson-table th:nth-child(-n+2), .lesson-table td:nth-child(-n+2) { text-align: left; }
    .lesson-table small { font-weight: 400; color: var(--text-muted); }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <div class="site-brand">
        <h1 class="site-title"><a href="index.html">MacsALogs</a></h1>
        <p class="site-tagline">AI 개발 · 생산성 · 취미 기록</p>
      </div>
      <nav class="site-nav">
        <a href="index.html">홈</a>
        <a href="english.html">영어</a>
        <a href="about.html">소개</a>
      </nav>
    </div>
  </header>
  <main class="container">
    <section class="mom-hero">
      <p class="tv-eyebrow">Phone English · OPIc AL</p>
      <h1>전화영어</h1>
      <p class="mom-hero-sub">전화영어 수업 복습 노트 — 내가 한 말의 교정, 튜터가 고쳐 말해 준 것, 말버릇, 그날 주제를 OPIc 문제로 넓힌 모범 답안을 대본 · 녹음과 함께 봅니다.</p>
    </section>
    <div id="lesson-lock"></div>
    <section id="lesson-body"></section>
    <p><button type="button" class="mom-logout" id="lesson-logout" hidden>잠그기</button></p>
  </main>
  <script type="application/json" id="lesson-data">{data}</script>
  <script src="js/lesson.js"></script>
  <script>LESSON.openList();</script>
</body>
</html>
"""

DETAIL_PAGE = HEAD.format(css="../css/style.css") + """</head>
<body>
  <main class="container mom-lock-page">
    <p><a href="../lesson.html">← 전화영어 목록</a></p>
    <div id="lesson-lock"></div>
  </main>
  <script type="application/json" id="lesson-data">{data}</script>
  <script src="../js/lesson.js"></script>
  <script>LESSON.openDetail();</script>
</body>
</html>
"""


def leaked(ls: list[dict]) -> list[str]:
    """올라갈 파일에 평문(대본 문장 · 요약)이 보이면 그 파일을 돌려준다."""
    probes = []
    for x in ls:
        probes += [t["text"] for t in x["turns"] if len(t["text"]) > 40][:5]
        probes.append(x["data"].get("summary", "")[:40])
    bad = []
    for p in [DOCS / "lesson.html", *(DOCS / "lesson").glob("*.html")]:
        text = p.read_text(encoding="utf-8")
        if any(s and (s in text or esc(s) in text) for s in probes):
            bad.append(str(p.relative_to(REPO)))
    return bad


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("-n", "--dry-run", action="store_true")
    ap.add_argument("--push", action="store_true", help="docs/lesson* 만 커밋하고 푸시한다")
    a = ap.parse_args()

    pw = password()
    ls = lessons(pw)
    print(f"수업 {len(ls)}회")
    for x in ls:
        print(f"  {x['id']}  {x['stem']}  녹음 {'있음' if x['audio'] else '없음'}")
    if a.dry_run:
        return

    salt = audio_salt()
    akey = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt), ITER, 32)
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    out = DOCS / "lesson"
    out.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    keep_pages, keep_bins, changed = set(), set(), 0

    for x in ls:
        bin_name = None
        if x["audio"]:
            raw = x["audio"].read_bytes()
            bin_name = f"{x['id']}-{hmac.new(pw.encode(), raw, 'sha256').hexdigest()[:8]}.bin"
            if not (AUDIO_DIR / bin_name).exists():
                iv = os.urandom(12)
                (AUDIO_DIR / bin_name).write_bytes(iv + AESGCM(akey).encrypt(iv, raw, None))
                changed += 1
            keep_bins.add(bin_name)
        plain = detail_plain(x, bin_name, salt)
        p = out / f"{x['id']}.html"
        h = hashlib.sha256(plain.encode()).hexdigest()
        if cache.get(p.name) != h or not p.exists():
            p.write_text(DETAIL_PAGE.replace("{data}", seal(pw, plain)), encoding="utf-8")
            cache[p.name] = h
            changed += 1
        keep_pages.add(p.name)

    for p in out.glob("*.html"):
        if p.name not in keep_pages:
            p.unlink()
            cache.pop(p.name, None)
            print(f"  지움 {p.name} (원본에 없는 수업)")
    for p in AUDIO_DIR.glob("*.bin"):
        if p.name not in keep_bins:
            p.unlink()
            print(f"  지움 {p.name} (바뀌었거나 없는 녹음)")

    plain_list = listing(ls)
    h = hashlib.sha256(plain_list.encode()).hexdigest()
    page = DOCS / "lesson.html"
    if cache.get("lesson.html") != h or not page.exists():
        page.write_text(LIST_PAGE.replace("{data}", seal(pw, plain_list)), encoding="utf-8")
        cache["lesson.html"] = h
        changed += 1
    CACHE.write_text(json.dumps(cache, indent=1) + "\n")

    bad = leaked(ls)
    if bad:
        for p in bad:
            (REPO / p).unlink()
        CACHE.unlink(missing_ok=True)
        sys.exit(f"평문이 보여 지웠다 — 생성기를 고칠 것: {bad}")
    print(f"갱신: docs/lesson.html, docs/lesson/, docs/audio/lesson/ ({len(ls)}회, 바뀐 파일 {changed}개, 암호화)")

    if a.push:
        paths = ["docs/lesson.html", "docs/lesson", "docs/audio/lesson", "docs/js/lesson.js", "scripts/lesson_crypto.json"]
        r = run(["git", "-C", str(REPO), "add", "-A", "--", *paths])
        if r.returncode != 0:
            sys.exit(f"git add 실패: {r.stderr.strip()}")
        if run(["git", "-C", str(REPO), "diff", "--cached", "--quiet", "--", *paths]).returncode == 0:
            print("바뀐 것이 없어 커밋하지 않는다")
            return
        msg = f"[{_dt.date.today().isoformat()}] 전화영어 수업 페이지 갱신 ({len(ls)}회, 자동)"
        r = run(["git", "-C", str(REPO), "commit", "-m", msg, "--", *paths])
        if r.returncode != 0:
            sys.exit(f"git commit 실패: {r.stdout.strip()}\n{r.stderr.strip()}")
        print(f"→ 커밋·푸시 ({push_main()}): {msg}")


if __name__ == "__main__":
    main()
