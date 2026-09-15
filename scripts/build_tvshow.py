#!/usr/bin/env python3
"""book-maker 의 에피소드 Markdown 을 docs/tvshow.html 의 JSON 블록으로 변환한다.

사용법:
    python3 scripts/build_tvshow.py                      # 전체 스크립트 반영
    python3 scripts/build_tvshow.py --scenes 6           # 앞 6개 장면만 (발췌본)
    python3 scripts/build_tvshow.py --source <디렉터리>   # 다른 원본 디렉터리

원본(episode_*.md)은 읽기만 하고 절대 수정하지 않는다.
결과는 docs/tvshow.html 의 <!-- TVSHOW-DATA:START --> ~ END 사이만 교체한다.
에피소드를 추가하려면 원본 디렉터리에 episode_02.md … 를 두고 다시 실행하면 된다.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TARGET = REPO_ROOT / "docs" / "tvshow.html"
DEFAULT_SOURCE = Path("/home/magpie/Workspace/dev/macGitHub/book-maker/output")

START = "<!-- TVSHOW-DATA:START -->"
END = "<!-- TVSHOW-DATA:END -->"

SERIES_TITLE = "A Gentleman's Dignity"
SERIES_TITLE_KO = "신사의 품격"
PLANNED_EPISODES = 20

EPISODE_FILE_RE = re.compile(r"episode[_-]?(\d+)\.md$", re.IGNORECASE)


def strip_front_matter(lines: list[str]) -> tuple[dict, list[str]]:
    """맨 앞 YAML 프런트매터를 떼어낸다. `---` 는 장면 구분자로도 쓰이므로 첫 줄일 때만 처리한다."""
    meta: dict[str, str] = {}
    if not lines or lines[0].strip() != "---":
        return meta, lines
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            for raw in lines[1:i]:
                if ":" in raw:
                    key, _, value = raw.partition(":")
                    meta[key.strip()] = value.strip().strip('"')
            return meta, lines[i + 1 :]
    return meta, lines


def classify(text: str) -> dict:
    """한 줄을 내레이션 / 지문 / 대사로 분류한다."""
    if len(text) > 2 and text.startswith("*") and text.endswith("*"):
        return {"kind": "narration", "text": text[1:-1].strip()}
    if text.startswith("[") and text.endswith("]"):
        return {"kind": "note", "text": text[1:-1].strip()}
    return {"kind": "dialogue", "text": text}


def parse_episode(path: Path, max_scenes: int | None = None) -> dict:
    raw = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    meta, lines = strip_front_matter(raw.split("\n"))

    title = meta.get("title", "").strip()
    body: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            if not title:
                title = heading
            continue
        body.append(stripped)

    match = EPISODE_FILE_RE.search(path.name)
    number = int(match.group(1)) if match else 0

    scenes: list[dict] = []
    current: list[dict] = []
    for stripped in body:
        if stripped == "---":
            if current:
                scenes.append({"n": len(scenes) + 1, "lines": current})
                current = []
            continue
        if stripped:
            current.append(classify(stripped))
    if current:
        scenes.append({"n": len(scenes) + 1, "lines": current})

    total_scenes = len(scenes)
    truncated = max_scenes is not None and total_scenes > max_scenes
    if truncated:
        scenes = scenes[:max_scenes]

    all_lines = [ln for scene in scenes for ln in scene["lines"]]
    words = sum(len(ln["text"].split()) for ln in all_lines)

    if not title:
        title = f"Episode {number}"
    # 프런트매터 title 은 "시리즈 - Episode 1" 형태라 시리즈명을 떼어 짧게 쓴다
    short = title.split(" - ")[-1].strip() if " - " in title else title

    return {
        "number": number,
        "id": f"ep{number:02d}",
        "title": short,
        "fullTitle": title,
        # 개인 머신 경로가 공개 파일에 남지 않도록 디렉터리 한 단계까지만 기록한다
        "source": f"{path.parent.name}/{path.name}",
        "sceneCount": len(scenes),
        "totalScenes": total_scenes,
        "truncated": truncated,
        "lineCount": len(all_lines),
        "wordCount": words,
        "scenes": scenes,
    }


def collect(source: Path, max_scenes: int | None) -> list[dict]:
    files = [p for p in sorted(source.rglob("episode_*.md")) if EPISODE_FILE_RE.search(p.name)]
    if not files:
        sys.exit(f"에피소드 파일을 찾지 못했습니다: {source}")
    episodes = [parse_episode(p, max_scenes) for p in files]
    episodes.sort(key=lambda e: e["number"])
    return episodes


def build_payload(episodes: list[dict]) -> dict:
    return {
        "series": SERIES_TITLE,
        "seriesKo": SERIES_TITLE_KO,
        "lang": "en",
        "generated": _dt.date.today().isoformat(),
        "plannedEpisodes": PLANNED_EPISODES,
        "episodes": episodes,
    }


def write_block(payload: dict) -> None:
    html = TARGET.read_text(encoding="utf-8")
    if START not in html or END not in html:
        sys.exit(f"{TARGET} 에서 TVSHOW-DATA 마커를 찾지 못했습니다.")

    block = (
        START
        + '\n  <script type="application/json" id="tvshow-data">\n'
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n  </script>\n  "
        + END
    )
    head, _, rest = html.partition(START)
    _, _, tail = rest.partition(END)
    TARGET.write_text(head + block + tail, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="episode_*.md 가 있는 디렉터리")
    parser.add_argument(
        "--scenes",
        type=int,
        default=None,
        metavar="N",
        help="에피소드당 앞 N개 장면만 반영한다 (생략하면 전체)",
    )
    args = parser.parse_args()

    episodes = collect(args.source, args.scenes)
    write_block(build_payload(episodes))

    print(f"→ {TARGET.relative_to(REPO_ROOT)} 갱신")
    for ep in episodes:
        mark = f" (발췌: 전체 {ep['totalScenes']}장면 중)" if ep["truncated"] else ""
        print(
            f"  Episode {ep['number']:>2}: 장면 {ep['sceneCount']}개 · "
            f"대사 {ep['lineCount']}줄 · {ep['wordCount']} words{mark}"
        )


if __name__ == "__main__":
    main()
