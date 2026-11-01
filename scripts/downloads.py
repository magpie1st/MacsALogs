#!/usr/bin/env python3
"""lang-study 확장이 파일을 내려놓는 폴더를 찾는다 (맥·리눅스).

확장은 `chrome.downloads.download({filename: 'lang-study/<작품> <회차>/...'})` 로
**상대 경로**를 넘긴다 — 실제 위치는 Chrome 의 다운로드 설정이 정한다. 그래서 경로를
박아 두면 사용자가 그 설정을 바꿨을 때 도구들이 **아무 말 없이 빈손으로 돌아온다.**
오류도 안 나므로 알아채기 어렵다. 그래서 설정을 읽어 따라간다.

  1. Chrome Preferences 의 `download.default_directory` (설정을 바꿨을 때만 있다)
  2. 없으면 OS 기본값 — 리눅스는 XDG `XDG_DOWNLOAD_DIR` (한국어 환경은 `~/다운로드`),
     맥은 언제나 `~/Downloads` (Finder 가 이름만 번역해 보여 준다)

이 모듈은 `watch_langstudy.py` 와 `publish_shows.py` 가 함께 쓴다. 둘이 다른 폴더를
보면 watcher 가 올린 회차의 음원을 publisher 가 못 찾는다.
"""

from __future__ import annotations

import json
from pathlib import Path

#: 확장이 쓰는 하위 폴더 이름 (sidepanel.js 의 `lang-study/<회차>/...`)
SUBDIR = "lang-study"

#: Chrome 프로필이 있는 곳. 맥과 리눅스를 모두 본다 (이 저장소는 리눅스에서 시작했다).
#: Chromium·베타 채널도 함께 본다 — 어느 것으로 확장을 띄웠는지 모르기 때문이다.
CHROME_ROOTS = (
    "~/Library/Application Support/Google/Chrome",          # macOS
    "~/Library/Application Support/Chromium",               # macOS Chromium
    "~/.config/google-chrome",                              # Linux
    "~/.config/google-chrome-beta",
    "~/.config/chromium",                                   # Linux Chromium
)


def chrome_download_dir() -> Path | None:
    """Chrome 이 설정한 다운로드 폴더. 설정을 바꾸지 않았으면 None (OS 기본값을 쓴다)."""
    for root in CHROME_ROOTS:
        base = Path(root).expanduser()
        if not base.is_dir():
            continue
        for pref in sorted(base.glob("*/Preferences")):
            try:
                data = json.loads(pref.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue  # 깨진 Preferences 때문에 멈추지 않는다
            got = ((data.get("download") or {}).get("default_directory") or "").strip()
            if got:
                return Path(got).expanduser()
    return None


def os_download_dir() -> Path:
    """OS 기본 다운로드 폴더. 리눅스 한국어 환경은 `~/다운로드` 일 수 있다."""
    xdg = Path("~/.config/user-dirs.dirs").expanduser()
    if xdg.is_file():
        try:
            for line in xdg.read_text(encoding="utf-8").splitlines():
                if not line.startswith("XDG_DOWNLOAD_DIR"):
                    continue
                value = line.split("=", 1)[1].strip().strip('"')
                got = Path(value.replace("$HOME", str(Path.home()))).expanduser()
                if got.is_dir():
                    return got
        except (OSError, IndexError):
            pass
    return Path("~/Downloads").expanduser()


def langstudy_dir() -> Path:
    """확장이 회차 폴더를 만드는 곳. 이것이 watcher 가 지켜볼 폴더다."""
    return (chrome_download_dir() or os_download_dir()) / SUBDIR


#: watcher 쪽 이름. 지켜보는 쪽에서는 "감시 폴더" 라고 읽는 편이 자연스럽다.
default_watch_dir = langstudy_dir


if __name__ == "__main__":
    print(f"Chrome 설정: {chrome_download_dir() or '(없음 — OS 기본값을 쓴다)'}")
    print(f"OS 기본   : {os_download_dir()}")
    got = langstudy_dir()
    print(f"감시 폴더 : {got} · 존재 {got.is_dir()}")
