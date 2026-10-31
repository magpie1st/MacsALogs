#!/usr/bin/env python3
"""녹음 작품의 음원을 GitHub Release 에 올리고, 페이지가 그 주소를 쓰게 한다.

    python3 scripts/publish_shows.py --show-id emily-in-paris -n          # 계획만
    python3 scripts/publish_shows.py --show-id emily-in-paris             # 올린다 (확인 받음)
    python3 scripts/publish_shows.py --show-id emily-in-paris --yes --push

하는 일 (순서대로):

  1. `docs/audio/shows/<작품>/*.json` manifest 를 읽어 올릴 회차를 정한다
  2. 내려받은 폴더에서 원본 mp3 를 찾는다 (manifest 의 `audio.sourceName`)
  3. Release 태그가 없으면 만들고, 자산을 올린다 (`gh release upload --clobber`)
  4. `config.json` 의 `audioBaseUrl` 을 그 태그로 맞춘다
  5. `docs/tvshow.html` 의 그 작품 회차마다 `audio` 블록을 manifest 로 다시 만든다
     (주소를 Release 로 돌리고, `--local-audio` 가 남긴 `preview` 표시를 지운다)
  6. 올린 자산에 Range 요청을 보내 **206 이 오는지** 확인한다 — 206 이 아니면 브라우저가
     문장 단위 seek 을 못 한다
  7. `--push` 면 커밋·푸시한다

**이 저장소는 공개다.** 올린 음원은 누구나 내려받을 수 있는 주소에 놓인다. 그래서 기본은
물어보고(터미널), 자동 실행에서는 `--yes` 를 명시해야 한다. mp3 자체는 저장소에 넣지 않는다
(Pages 사이트 상한 1GB) — Release 자산으로만 올린다.

원본(내려받은 폴더)은 읽기만 하고 수정하지 않는다.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from shows import normalize_base_url, read_payload, upsert_show, write_payload

REPO_ROOT = Path(__file__).resolve().parent.parent
SHOWS_DIR = REPO_ROOT / "docs" / "audio" / "shows"
DEFAULT_DOWNLOADS = Path("~/Downloads/lang-study").expanduser()
REPO = "magpie1st/MacsALogs"
RELEASE_BASE = f"https://github.com/{REPO}/releases/download"


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def require_gh() -> None:
    probe = run(["gh", "auth", "status"])
    if probe.returncode != 0:
        sys.exit("gh 로그인이 필요합니다: gh auth login\n" + (probe.stderr or probe.stdout).strip())


def load_manifests(show_id: str, only: list[str] | None) -> list[dict]:
    folder = SHOWS_DIR / show_id
    if not folder.is_dir():
        sys.exit(f"{folder} 가 없습니다. 먼저 build_langstudy.py 로 회차를 넣으세요.")
    out = []
    # config.json 만 빼고 전부 manifest 다 (시리즈는 sNNeNN.json, 영화는 feature.json)
    for path in sorted(p for p in folder.glob("*.json") if p.name != "config.json"):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if only and manifest.get("episodeId") not in only:
            continue
        manifest["_path"] = path
        out.append(manifest)
    if not out:
        sys.exit(f"{folder} 에서 올릴 회차를 찾지 못했습니다.")
    out.sort(key=lambda m: (m.get("season") or 0, m.get("episode") or 0))
    return out


def find_source(manifest: dict, downloads: Path, explicit: Path | None) -> Path | None:
    """올릴 원본 mp3. manifest 의 sourceName 으로 내려받은 폴더를 훑는다."""
    if explicit:
        return explicit if explicit.exists() else None
    name = (manifest.get("audio") or {}).get("sourceName")
    if name:
        hits = sorted(downloads.glob(f"**/{name}"))
        if hits:
            return hits[0]
    # sourceName 이 없는 예전 manifest: 시즌·회차로 폴더를 짐작한다
    season, episode = manifest.get("season"), manifest.get("episode")
    if season and episode:
        for folder in sorted(downloads.glob(f"*시즌 {season} {episode}화*")):
            mp3s = sorted(folder.glob("*.mp3"))
            if len(mp3s) == 1:
                return mp3s[0]
    return None


def audio_block(manifest: dict, base_url: str) -> dict:
    """manifest 로 페이지가 쓸 audio 블록을 다시 만든다.

    세그먼트 모양은 build_langstudy.py 와 같아야 한다 —
    [장면, 줄, 문장, 시작ms, 끝ms, 문자시작, 문자끝]. 장면·줄 번호는 manifest 에 없으므로
    HTML 에 이미 들어 있는 것을 그대로 쓰고 **주소만** 바꾼다 (아래 retarget 참고).
    """
    audio = manifest.get("audio") or {}
    duration = audio.get("durationSec") or 0
    recorded = audio.get("recordedSec") or 0
    return {
        "file": f"{normalize_base_url(base_url)}/{audio['asset']}",
        "durationSec": duration,
        "engine": "lang-study recording",
        "voice": None,
        "speed": 1.0,
        "generated": manifest.get("generated"),
        "coverage": round(recorded / duration, 3) if duration else 0,
    }


def retarget(payload: dict, show_id: str, manifests: list[dict], base_url: str) -> list[str]:
    """그 작품 회차의 audio 주소를 Release 로 돌린다. 세그먼트는 손대지 않는다.

    세그먼트는 HTML 에 이미 들어 있고 그게 정답이다 (build_langstudy.py 가 넣었다).
    여기서 다시 만들면 장면·줄 번호가 어긋날 위험만 생긴다.
    """
    show = next((s for s in payload.get("shows") or [] if s.get("id") == show_id), None)
    if show is None:
        sys.exit(f"docs/tvshow.html 에 '{show_id}' 작품이 없습니다. 먼저 build_langstudy.py 를 돌리세요.")
    by_id = {m["episodeId"]: m for m in manifests}
    touched = []
    for season in show.get("seasons") or []:
        for episode in season.get("episodes") or []:
            manifest = by_id.get(episode.get("id"))
            if not manifest:
                continue
            fresh = audio_block(manifest, base_url)
            old = episode.get("audio") or {}
            # 세그먼트와 문장 수는 그대로 들고 간다
            if old.get("segments") is not None:
                fresh["segments"] = old["segments"]
                fresh["segmentCount"] = old.get("segmentCount") or len(old["segments"])
            episode["audio"] = fresh
            touched.append(episode["id"])
    upsert_show(payload, show)
    return touched


def ensure_release(tag: str, dry: bool) -> None:
    if run(["gh", "release", "view", tag, "--repo", REPO]).returncode == 0:
        print(f"  Release {tag} 이미 있음")
        return
    if dry:
        print(f"  Release {tag} 를 새로 만듭니다 (-n 이라 실행 안 함)")
        return
    made = run(["gh", "release", "create", tag, "--repo", REPO, "--title", tag,
                "--notes", "lang-study 녹음 음원. 스크립트 리더(tvshow.html)가 문장 단위로 재생한다."])
    if made.returncode != 0:
        sys.exit(f"Release {tag} 생성 실패:\n{made.stderr.strip()}")
    print(f"  Release {tag} 생성")


def upload(tag: str, source: Path, asset: str, dry: bool) -> bool:
    size = source.stat().st_size / 1e6
    if dry:
        print(f"  올림(예정) {asset}  {size:.0f}MB  ← {source.name}")
        return True
    staged = Path("/tmp") / asset
    if staged.resolve() != source.resolve():
        staged.write_bytes(source.read_bytes())
    done = run(["gh", "release", "upload", tag, str(staged), "--repo", REPO, "--clobber"])
    if done.returncode != 0:
        print(f"  실패 {asset}: {done.stderr.strip()}")
        return False
    print(f"  올림 {asset}  {size:.0f}MB")
    return True


def verify_range(url: str) -> str:
    """Range 요청에 206 이 오는지 본다. 200 이면 브라우저가 문장 seek 을 못 한다."""
    request = urllib.request.Request(url, headers={"Range": "bytes=0-99"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            code = response.status
            length = response.headers.get("Content-Length")
            if code == 206 and length == "100":
                return "ok (206)"
            return f"이상: HTTP {code}, Content-Length {length}"
    except urllib.error.HTTPError as exc:
        return f"이상: HTTP {exc.code}"
    except OSError as exc:
        return f"확인 실패: {exc}"


def confirm(count: int, tag: str, total_mb: float) -> bool:
    print(
        f"\n  ⚠ {REPO} 는 **공개 저장소**입니다.\n"
        f"    음원 {count}개({total_mb:.0f}MB)를 Release '{tag}' 에 올리면\n"
        f"    {RELEASE_BASE}/{tag}/... 주소로 누구나 내려받을 수 있습니다."
    )
    if not sys.stdin.isatty():
        print("    자동 실행에서는 --yes 를 명시해야 합니다.")
        return False
    try:
        return input("    계속할까요? [y/N] ").strip().lower() in ("y", "yes")
    except (EOFError, KeyboardInterrupt):
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--show-id", required=True, help="작품 id (docs/audio/shows/<여기>)")
    parser.add_argument("--episode", action="append", metavar="sNNeNN",
                        help="이 회차만 (여러 번 줄 수 있다). 생략하면 그 작품 전부")
    parser.add_argument("--tag", help="Release 태그. 생략하면 config.json 에서 읽고, 없으면 오늘 날짜로 만든다")
    parser.add_argument("--from", dest="downloads", type=Path, default=DEFAULT_DOWNLOADS,
                        help=f"lang-study 내려받기 폴더 (기본 {DEFAULT_DOWNLOADS})")
    parser.add_argument("--audio", type=Path, help="원본 mp3 를 직접 지정 (회차 하나일 때만)")
    parser.add_argument("-n", "--dry-run", action="store_true", help="올리지 않고 계획만 보여 준다")
    parser.add_argument("--yes", action="store_true", help="확인 없이 올린다 (자동 실행용)")
    parser.add_argument("--push", action="store_true", help="성공하면 커밋·푸시까지 한다")
    args = parser.parse_args()

    downloads = args.downloads.expanduser()
    manifests = load_manifests(args.show_id, args.episode)

    config_path = SHOWS_DIR / args.show_id / "config.json"
    tag = args.tag
    if not tag and config_path.exists():
        raw = (json.loads(config_path.read_text(encoding="utf-8")) or {}).get("audioBaseUrl") or ""
        tag = raw.rstrip("/").rsplit("/", 1)[-1] or None
    if not tag:
        tag = f"shows-audio-{_dt.date.today().isoformat()}-v1"
    base_url = normalize_base_url(f"{RELEASE_BASE}/{tag}")

    print(f"작품      {args.show_id}")
    print(f"태그      {tag}")
    print(f"원본      {downloads}")
    print()

    plan = []
    missing = []
    for manifest in manifests:
        asset = (manifest.get("audio") or {}).get("asset")
        source = find_source(manifest, downloads, args.audio if len(manifests) == 1 else None)
        if not asset:
            missing.append((manifest["episodeId"], "manifest 에 audio.asset 이 없습니다"))
        elif not source:
            name = (manifest.get("audio") or {}).get("sourceName") or "(이름 모름)"
            missing.append((manifest["episodeId"], f"원본 mp3 를 찾지 못했습니다: {name}"))
        else:
            plan.append((manifest, source, asset))

    for episode_id, reason in missing:
        print(f"  건너뜀 {episode_id}: {reason}")
    if not plan:
        sys.exit("\n올릴 음원이 없습니다.")

    total_mb = sum(s.stat().st_size for _, s, _ in plan) / 1e6
    for manifest, source, asset in plan:
        minutes, seconds = divmod(int((manifest.get("audio") or {}).get("durationSec") or 0), 60)
        print(f"  {manifest['episodeId']}  {asset}  {source.stat().st_size / 1e6:.0f}MB  {minutes}:{seconds:02d}")
    print(f"\n  합계 {len(plan)}개 · {total_mb:.0f}MB")

    if args.dry_run:
        print("\n(-n 이라 아무것도 올리지 않았습니다)")
        return

    require_gh()
    if not args.yes and not confirm(len(plan), tag, total_mb):
        sys.exit("\n중단했습니다.")

    print()
    ensure_release(tag, dry=False)
    uploaded = [(m, a) for m, s, a in plan if upload(tag, s, a, dry=False)]
    if not uploaded:
        sys.exit("\n아무것도 올리지 못했습니다. 페이지는 건드리지 않았습니다.")

    # config.json 을 태그에 맞춘다 (다음 build_langstudy.py 가 이걸 읽는다)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps({
        "schema": "shows-audio-release/1",
        "generated": _dt.date.today().isoformat(),
        "audioBaseUrl": base_url,
        "note": "mp3는 이 저장소에 두지 않는다. Release 자산으로만 올린다 (Pages 사이트 상한 1GB).",
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    payload = read_payload()
    touched = retarget(payload, args.show_id, [m for m, _ in uploaded], base_url)
    payload["generated"] = _dt.date.today().isoformat()
    write_payload(payload)
    print(f"\n→ {config_path.relative_to(REPO_ROOT)}")
    print(f"→ docs/tvshow.html 의 {len(touched)}개 회차 주소를 Release 로 돌림")

    print("\nRange 확인 (206 이어야 문장 단위 seek 이 된다)")
    for manifest, asset in uploaded:
        print(f"  {asset}  {verify_range(f'{base_url}/{asset}')}")

    if args.push:
        print()
        add = run(["git", "-C", str(REPO_ROOT), "add", "-A"])
        if add.returncode != 0:
            sys.exit(f"git add 실패: {add.stderr.strip()}")
        episodes = ", ".join(m["episodeId"] for m, _ in uploaded)
        message = f"[{_dt.date.today().isoformat()}] {args.show_id} 음원 공개 ({episodes})"
        commit = run(["git", "-C", str(REPO_ROOT), "commit", "-m", message])
        if commit.returncode != 0 and "nothing to commit" not in commit.stdout:
            sys.exit(f"git commit 실패: {commit.stdout.strip()}\n{commit.stderr.strip()}")
        push = run(["git", "-C", str(REPO_ROOT), "push", "origin", "main"])
        if push.returncode != 0:
            sys.exit(f"git push 실패: {push.stderr.strip()}")
        print(f"→ 커밋·푸시 완료: {message}")
        print("   Pages 빌드에 1~2분 걸립니다:")
        print(f"   gh api repos/{REPO}/pages/builds/latest --jq .status")
    else:
        print("\n페이지에 반영하려면 커밋·푸시하세요 (--push 로 한 번에 할 수 있습니다):")
        print(f"  git add -A && git commit -m '[{_dt.date.today().isoformat()}] {args.show_id} 음원 공개'")
        print("  git push origin main")


if __name__ == "__main__":
    main()
