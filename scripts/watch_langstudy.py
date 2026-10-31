#!/usr/bin/env python3
"""`/Users/mac/Downloads/lang-study` 를 지켜보다가 새 회차가 들어오면 스크립트 리더에 올린다.

    python3 scripts/watch_langstudy.py -n            # 무엇을 하려는지만 보여 준다
    python3 scripts/watch_langstudy.py --once        # 지금 있는 것만 처리하고 끝낸다
    python3 scripts/watch_langstudy.py               # 계속 지켜본다 (Ctrl+C 로 중지)

폴더 하나를 보면 이 순서로 한다.

  1. **다 내려왔는지** 본다 — 파일 크기·개수가 STABLE_SEC 동안 그대로여야 손댄다.
     내려받는 중에 건드리면 잘린 mp3 로 빌드가 돌아간다.
  2. **zip 을 푼다** — `*문장별*.zip` 안에 `script.json`·`sentences.csv` 가 있다.
     이미 풀린 폴더가 있으면 건너뛴다. 원본 zip 은 지우지 않는다.
  3. **소리를 확인한다** — mp3 가 있고, ffprobe 로 읽은 길이가 1초 이상이어야 한다.
     (0바이트·잘린 파일을 올리면 되돌리기 번거롭다)
  4. **작품 id 를 정할 수 있는지 본다** — `show_ids.json` 에 있거나 제목이 영문이어야 한다.
     한글 제목이 처음 보이면 **건너뛰고 알린다.** id 는 사람이 한 번 정해야 하는 값이다.
  5. `build_langstudy.py` 를 돌린다 (기본은 `--publish --push` 까지).

처리한 폴더는 `.watch_state.json` 에 기록해 다시 하지 않는다. 다시 하려면 그 항목을 지운다
(또는 `--force`).

**기본이 공개 배포다.** 이 저장소는 공개이고 음원이 Release 에 올라간다. 시작할 때 무엇을
할지 띄우니 확인하고 쓴다. 대본만 넣으려면 `--build-only`.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import subprocess
import sys
import time
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parent
WATCH_DIR = Path("/Users/mac/Downloads/lang-study")
STATE = SCRIPTS / ".watch_state.json"

#: 파일 크기·개수가 이만큼 그대로면 다 내려온 것으로 본다. 16MB mp3 와 71MB zip 이
#: 함께 내려오므로 짧게 잡으면 받는 중에 손대게 된다.
STABLE_SEC = 20
POLL_SEC = 15

#: 이보다 짧은 mp3 는 잘린 것으로 본다
MIN_AUDIO_SEC = 1.0


def log(message: str) -> None:
    print(f"[{_dt.datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def load_state() -> dict:
    if not STATE.exists():
        return {}
    try:
        return json.loads(STATE.read_text(encoding="utf-8")) or {}
    except (OSError, json.JSONDecodeError):
        log(f"! {STATE.name} 를 읽을 수 없어 빈 상태로 시작합니다")
        return {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def fingerprint(folder: Path) -> tuple:
    """폴더 안 파일의 (경로, 크기) 모음. 내려받는 중이면 값이 계속 바뀐다."""
    return tuple(sorted(
        (str(p.relative_to(folder)), p.stat().st_size)
        for p in folder.rglob("*") if p.is_file()
    ))


def digest(mark: tuple) -> str:
    """지문을 짧은 문자열로. 상태 파일에 적어 **내용이 바뀌면 다시 처리**한다.

    폴더 이름만 보면, 이미 올린 회차에 스크립트 JSON 을 뒤늦게 내려받아도 건너뛴다
    (CSV 로 만든 회차의 문장 싱크를 고치는 바로 그 경우다).
    """
    return hashlib.sha256(repr(mark).encode("utf-8")).hexdigest()[:16]


def unzip_sentences(folder: Path, dry: bool) -> Path | None:
    """`*문장별*.zip` 을 폴더 안에 푼다. 이미 풀려 있으면 그 폴더를 돌려준다."""
    zips = sorted(folder.glob("*.zip"))
    if not zips:
        return None
    archive = zips[0]
    target = folder / archive.stem
    if target.is_dir() and any(target.iterdir()):
        return target
    if dry:
        log(f"  zip 을 풉니다(예정): {archive.name} → {target.name}/")
        return target
    try:
        with zipfile.ZipFile(archive) as zf:
            # zip 안의 경로가 폴더 밖으로 나가지 않는지 본다 (zip slip)
            for name in zf.namelist():
                resolved = (target / name).resolve()
                if not str(resolved).startswith(str(target.resolve())):
                    log(f"  ! zip 안에 폴더 밖을 가리키는 경로가 있어 건너뜁니다: {name}")
                    return None
            zf.extractall(target)
    except (OSError, zipfile.BadZipFile) as exc:
        log(f"  ! zip 을 풀지 못했습니다 ({archive.name}): {exc}")
        return None
    log(f"  zip 을 풀었습니다: {archive.name} → {target.name}/")
    return target


def audio_of(folder: Path) -> tuple[Path | None, str]:
    """mp3 하나와 그 상태. 소리를 확인할 수 없으면 이유를 돌려준다."""
    mp3s = sorted(p for p in folder.glob("*.mp3") if p.is_file())
    if not mp3s:
        return None, "mp3 가 없습니다 (전체 MP3 를 내려받으세요)"
    if len(mp3s) > 1:
        return None, f"mp3 가 여러 개입니다 ({len(mp3s)}개)"
    mp3 = mp3s[0]
    if mp3.stat().st_size == 0:
        return None, "mp3 가 0바이트입니다"
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
        capture_output=True, text=True)
    if probe.returncode != 0:
        return mp3, "ffprobe 로 길이를 읽지 못했습니다 (그대로 진행합니다)"
    try:
        seconds = float(probe.stdout.strip())
    except ValueError:
        return mp3, "길이를 숫자로 읽지 못했습니다 (그대로 진행합니다)"
    if seconds < MIN_AUDIO_SEC:
        return None, f"mp3 가 너무 짧습니다 ({seconds:.1f}초) — 잘린 파일로 보입니다"
    minutes, rest = divmod(int(seconds), 60)
    return mp3, f"소리 {minutes}:{rest:02d}"


def read_script(folder: Path) -> dict | None:
    """스크립트 JSON 을 읽는다 (zip 안에 든 script.json 도 본다)."""
    for path in sorted(folder.glob("*.json")) + sorted(folder.glob("**/script.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("schema") == "lang-study-script/1":
            return data
    return None


def show_id_of(title: str) -> str | None:
    """빌더와 **같은 규칙**으로 작품 id 를 미리 보여 준다 (로그용).

    실제로 정하는 것은 빌더다 (`resolve_show_id`). 여기서 따로 계산하면 둘이 어긋나
    로그와 결과가 달라진다 — 그래서 빌더가 쓰는 모듈을 그대로 불러 쓴다.
    """
    sys.path.insert(0, str(SCRIPTS))
    try:
        import build_langstudy  # noqa: PLC0415  (경로를 넣은 뒤에 불러야 한다)
        return build_langstudy.resolve_show_id({"title": title}, None)
    except SystemExit:
        return None
    except Exception:  # noqa: BLE001  (로그용이라 실패해도 진행한다)
        return None


def build(folder: Path, script: dict | None, args, title: str) -> bool:
    # --show-id 는 넘기지 않는다. 빌더가 기억해 둔 값을 먼저 쓰고, 없으면 제목에서 만든다
    # (한글은 로마자). 여기서 지정하면 사람이 나중에 고쳐 둔 id 를 덮어쓴다.
    cmd = [sys.executable, str(SCRIPTS / "build_langstudy.py"), str(folder), "--title", title]
    if not args.build_only:
        cmd += ["--publish"]
        if not args.no_push:
            cmd += ["--push"]
    if args.dry_run:
        cmd += ["-n"]
    # 스크립트 JSON 이 없으면(예전 내보내기) 시즌·회차를 알 수 없다 — 폴더 이름에서 읽는다
    if script is None or (not script.get("season") and not script.get("episodeNo")):
        season, episode = season_episode_from_name(folder.name)
        if season and episode:
            cmd += ["--season", str(season), "--episode", str(episode)]
    log("  " + " ".join(cmd[1:]))
    done = subprocess.run(cmd, cwd=str(REPO_ROOT))
    return done.returncode == 0


#: 내려받은 폴더 이름은 lang-study 가 만든다 (sidepanel.js 의 episodeLabel 참고).
#: 제목이 한글이면 "<작품> 시즌 5 1화", 영문이면 "<작품> S05E01" 이다. 둘 다 읽는다.
_SXXEXX_RE = re.compile(r"\bS(\d+)\s*[:xE]?\s*E?(\d+)\b", re.IGNORECASE)
_SEASON_RE = re.compile(r"시즌\s*(\d+)")
_EPISODE_RE = re.compile(r"(\d+)\s*화")
_SUFFIX_RE = re.compile(r"\s*시즌\s*\d+.*$|\s*\d+\s*화.*$|\s*\bS\d+\s*[:xE]?\s*E?\d+\b.*$", re.IGNORECASE)


def season_episode_from_name(name: str) -> tuple[int | None, int | None]:
    """"<작품> 시즌 5 1화" 에서 (5, 1). 못 읽으면 (None, None).

    짐작이므로 스크립트 JSON 에 값이 있으면 그쪽을 쓴다.
    """
    both = _SXXEXX_RE.search(name)
    if both:
        return int(both.group(1)), int(both.group(2))
    season = _SEASON_RE.search(name)
    episode = _EPISODE_RE.search(name)
    return (int(season.group(1)) if season else None,
            int(episode.group(1)) if episode else None)


def title_from_name(name: str) -> str:
    """"에밀리, 파리에 가다 시즌 5 1화" → "에밀리, 파리에 가다".

    스크립트 JSON 이 없을 때(예전 내보내기)만 쓴다. 제목이 작품 id 조회의 열쇠라
    이것마저 없으면 폴더를 건너뛰게 된다.
    """
    return _SUFFIX_RE.sub("", name).strip() or name


def process(folder: Path, state: dict, args) -> None:
    key = folder.name
    log(f"▶ {key}")

    target = unzip_sentences(folder, args.dry_run)
    search_dirs = [folder] + ([target] if target else [])

    mp3, note = audio_of(folder)
    log(f"  {note}")
    if mp3 is None:
        log("  건너뜁니다")
        return

    script = None
    for where in search_dirs:
        script = read_script(where)
        if script:
            break
    if script is None:
        log("  ! 스크립트 JSON 이 없습니다 — sentences.csv 로 떨어집니다 (문장 싱크가 0.5초 밀립니다)")

    title = (script or {}).get("title")
    if not title:
        title = title_from_name(folder.name)
        log(f"  제목을 폴더 이름에서 읽었습니다: {title!r} (스크립트 JSON 이 없어서)")
    show_id = show_id_of(title)
    kind = "영화" if (script and not script.get("season") and not script.get("episodeNo")) else "회차"
    log(f"  작품 {title} (id: {show_id or '빌더가 정함'}) · {kind}")

    if build(folder, script, args, title):
        if not args.dry_run:
            state[key] = {
                "at": _dt.datetime.now().isoformat(timespec="seconds"),
                "show": show_id,
                "digest": digest(fingerprint(folder)),
            }
            save_state(state)
        log("  완료")
    else:
        log("  ! 실패 — 상태에 기록하지 않습니다 (다음 순회에 다시 시도합니다)")


def ready_folders(watch_dir: Path, state: dict, args, seen: dict) -> list[Path]:
    """손댈 수 있는 폴더. 아직 처리하지 않았고, 크기가 STABLE_SEC 동안 그대로인 것.

    `seen` 은 순회 사이에 유지되는 {폴더: (지문, 처음 본 시각)} 이다. 16MB mp3 와 71MB zip
    이 함께 내려오므로 한 번 보고 판단하면 받는 중에 손대게 된다.
    """
    out = []
    now = time.monotonic()
    for folder in sorted(p for p in watch_dir.iterdir() if p.is_dir()):
        try:
            current = fingerprint(folder)
        except OSError:
            continue  # 받는 중에 파일이 사라질 수 있다
        if not current:
            continue
        done = state.get(folder.name)
        # 폴더 이름이 같아도 안에 파일이 늘었으면(스크립트 JSON 추가 등) 다시 처리한다
        if not args.force and isinstance(done, dict) and done.get("digest") == digest(current):
            continue
        previous = seen.get(folder.name)
        if previous is None or previous[0] != current:
            seen[folder.name] = (current, now)
            if args.stable > 0:
                log(f"  {folder.name}: 크기가 바뀌었습니다 ({args.stable}초 그대로면 처리합니다)")
                continue
            # --stable 0: 기다리지 않는다 (이미 다 내려온 폴더를 바로 처리할 때)
        elif now - previous[1] < args.stable:
            continue
        out.append(folder)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", type=Path, default=WATCH_DIR, help=f"지켜볼 폴더 (기본 {WATCH_DIR})")
    parser.add_argument("--once", action="store_true", help="지금 있는 것만 처리하고 끝낸다")
    parser.add_argument("--build-only", action="store_true", help="대본만 넣는다 (음원 업로드·푸시 안 함)")
    parser.add_argument("--no-push", action="store_true", help="음원은 올리되 커밋·푸시는 하지 않는다")
    parser.add_argument("--force", action="store_true", help="이미 처리한 폴더도 다시 한다")
    parser.add_argument("--poll", type=int, default=POLL_SEC, help=f"몇 초마다 볼지 (기본 {POLL_SEC})")
    parser.add_argument("--stable", type=int, default=STABLE_SEC,
                        help=f"크기가 이만큼 그대로면 다 내려온 것으로 본다 (기본 {STABLE_SEC}초)")
    parser.add_argument("-n", "--dry-run", action="store_true", help="아무것도 쓰지 않고 계획만 보여 준다")
    args = parser.parse_args()

    watch_dir = args.dir.expanduser()
    if not watch_dir.is_dir():
        sys.exit(f"지켜볼 폴더가 없습니다: {watch_dir}")

    mode = ("대본만 넣습니다" if args.build_only else
            "음원을 Release 에 올립니다 (푸시 안 함)" if args.no_push else
            "음원을 Release 에 올리고 커밋·푸시합니다")
    print(f"지켜봅니다  {watch_dir}")
    print(f"할 일      {mode}" + ("  [-n: 실제로는 아무것도 안 함]" if args.dry_run else ""))
    if not args.build_only and not args.dry_run:
        print("           ⚠ magpie1st/MacsALogs 는 공개 저장소입니다. 올린 음원은 누구나 내려받습니다.")
    print(f"상태       {STATE.name} ({len(load_state())}개 처리됨)")
    print(f"{'한 번만 훑습니다' if args.once else f'{args.poll}초마다 봅니다. Ctrl+C 로 중지.'}\n")

    seen: dict = {}
    try:
        while True:
            state = load_state()
            folders = ready_folders(watch_dir, state, args, seen)
            for folder in folders:
                process(folder, state, args)
                seen.pop(folder.name, None)
            if args.once:
                # 처음 본 폴더는 안정화를 기다리느라 한 번 밀린다. --once 는 한 번 더 본다.
                if not folders and seen and args.stable > 0:
                    log(f"안정화를 {args.stable}초 기다립니다")
                    time.sleep(args.stable)
                    for folder in ready_folders(watch_dir, state, args, seen):
                        process(folder, state, args)
                        folders.append(folder)
                if not folders:
                    log("처리할 새 폴더가 없습니다")
                return
            time.sleep(args.poll)
    except KeyboardInterrupt:
        print("\n중지")


if __name__ == "__main__":
    main()
