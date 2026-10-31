#!/usr/bin/env python3
"""book-maker 의 에피소드 Markdown 을 docs/tvshow.html 의 JSON 블록으로 변환한다.

사용법:
    python3 scripts/build_tvshow.py                      # 전체 스크립트 반영
    python3 scripts/build_tvshow.py --scenes 6           # 앞 6개 장면만 (발췌본)
    python3 scripts/build_tvshow.py --source <디렉터리>   # 다른 원본 디렉터리

원본(episode_*.md)은 읽기만 하고 절대 수정하지 않는다.
결과는 docs/tvshow.html 의 <!-- TVSHOW-DATA:START --> ~ END 사이만 교체한다.
에피소드를 추가하려면 원본 디렉터리에 episode_02.md … 를 두고 다시 실행하면 된다.

docs/audio/tvshow/episode-NN.json (tts-maker 가 만든 문장 타임라인) 이 있으면 그 회차에
오디오 메타데이터를 얹는다. manifest 가 원본 대본과 한 글자라도 어긋나면 **중단한다** —
문장 강조가 통째로 밀린 페이지를 올리는 것보다 안 올리는 편이 낫다.

음원이 docs/ 에 없고 GitHub Release 자산으로 올라가 있는 경우
(docs/audio/tvshow/config.json 에 audioBaseUrl 이 있는 경우) 오디오 `file` 은 그 기준
URL 을 붙인 절대 https 주소가 되고, 로컬 mp3 는 요구하지 않는다. 20편을 128kbps 로 담으면
Pages 사이트 상한(1GB)을 넘기 때문이다. manifest 검증은 두 방식에서 똑같이 엄격하다.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import sys
from pathlib import Path

# JSON 블록 읽기·쓰기와 공개 문자열 검사는 shows.py 한곳에 둔다. 생성기가 둘이고(이 파일과
# build_langstudy.py) 서로 다른 머신에서 돌기 때문에, 블록을 통째로 덮어쓰지 않고 자기 작품만
# 갈아 끼워야 한다. 아래 이름들은 tts-maker 의 교차 테스트가 이 모듈에서 찾으므로 다시 내보낸다.
from shows import (  # noqa: F401  (재내보내기)
    AUDIO_URL_PREFIX,
    END,
    RELEASE_CONFIG_NAME,
    SEGMENT_PLACEHOLDER,
    START,
    TARGET,
    assert_publishable,
    audio_href,
    escape_inline_json,
    normalize_base_url,
    read_payload,
    read_release_base_url,
    serialize,
    slugify,
    upsert_show,
    write_payload,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = REPO_ROOT / "docs" / "audio" / "tvshow"
DEFAULT_SOURCE = Path("/home/magpie/Workspace/dev/macGitHub/book-maker/output")

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


def parse_episode(path: Path, max_scenes: int | None = None) -> tuple[dict, str]:
    """에피소드 하나를 (payload 용 dict, 원본 sha256) 으로 읽는다.

    sha256 은 manifest 가 같은 대본을 보고 만들어졌는지 확인하는 데만 쓰고 공개 JSON 에는 넣지 않는다.
    """
    raw_bytes = path.read_bytes()
    raw = raw_bytes.decode("utf-8").replace("\r\n", "\n")
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

    episode = {
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
    return episode, hashlib.sha256(raw_bytes).hexdigest()


def collect(source: Path, max_scenes: int | None) -> list[tuple[dict, str]]:
    files = [p for p in sorted(source.rglob("episode_*.md")) if EPISODE_FILE_RE.search(p.name)]
    if not files:
        sys.exit(f"에피소드 파일을 찾지 못했습니다: {source}")
    parsed = [parse_episode(p, max_scenes) for p in files]
    parsed.sort(key=lambda pair: pair[0]["number"])
    return parsed


# ── 오디오 타임라인 병합 ─────────────────────────────────────────────────────

def verify_manifest(manifest: dict, episode: dict, source_sha: str) -> None:
    """manifest 의 문장들이 지금 읽은 대본을 그대로 덮는지 확인한다. 어긋나면 중단한다."""
    where = f"Episode {episode['number']}"

    if manifest.get("source", {}).get("sha256") != source_sha:
        sys.exit(
            f"{where}: 오디오 manifest 가 다른 대본으로 만들어졌습니다.\n"
            f"  tts-maker 에서 `tts-maker-tvshow --episode {episode['number']} -f` 로 다시 만드세요."
        )

    rows = manifest.get("segments") or []
    if not rows:
        sys.exit(f"{where}: manifest 에 세그먼트가 없습니다.")
    if manifest.get("audio", {}).get("segmentCount") != len(rows):
        sys.exit(f"{where}: manifest 의 segmentCount 와 실제 세그먼트 수가 다릅니다.")

    # (장면, 줄) 별로 모아 원문을 빈틈없이 덮는지 본다
    grouped: dict[tuple[int, int], list[dict]] = {}
    order: list[tuple[int, int]] = []
    for row in rows:
        key = (row["scene"], row["line"])
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(row)

    expected = [
        (scene["n"], index)
        for scene in episode["scenes"]
        for index, line in enumerate(scene["lines"], start=1)
        if line["text"].strip()
    ]
    if order != expected:
        sys.exit(
            f"{where}: manifest 의 줄 구성이 대본과 다릅니다 "
            f"(manifest {len(order)}줄 vs 대본 {len(expected)}줄)."
        )

    previous_end = -1.0
    for row in rows:
        if not (row["end"] > row["start"]) or row["start"] < previous_end - 1e-6:
            sys.exit(f"{where}: 타임라인이 단조 증가하지 않습니다 ({row['id']}).")
        previous_end = row["end"]

    for scene in episode["scenes"]:
        for index, line in enumerate(scene["lines"], start=1):
            rows_for_line = grouped.get((scene["n"], index))
            if not rows_for_line:
                continue
            cursor = 0
            for row in rows_for_line:
                piece = line["text"][row["charStart"]:row["charEnd"]]
                if row["charStart"] != cursor or piece.strip() != row["text"]:
                    sys.exit(
                        f"{where}: 장면 {scene['n']} 줄 {index} 의 본문이 manifest 와 다릅니다.\n"
                        f"  대본: {piece.strip()[:50]!r}\n  manifest: {row['text'][:50]!r}"
                    )
                cursor = row["charEnd"]
            if cursor != len(line["text"]):
                sys.exit(f"{where}: 장면 {scene['n']} 줄 {index} 의 끝이 덮이지 않았습니다.")


def load_audio(episode: dict, source_sha: str, base_url: str | None = None) -> dict | None:
    """회차에 딸린 오디오 타임라인을 읽어 인라인에 넣을 형태로 줄인다.

    본문 텍스트는 이미 scenes 안에 있으므로 다시 싣지 않는다. 대신 (장면, 줄, 문장,
    시작ms, 끝ms, 문자시작, 문자끝) 일곱 숫자만 넘겨 브라우저가 줄을 잘라 쓰게 한다.

    base_url 이 있으면 음원은 Release 자산에 있으므로 로컬 mp3 를 요구하지 않는다.
    """
    manifest_path = AUDIO_DIR / f"episode-{episode['number']:02d}.json"
    if not manifest_path.exists():
        return None

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    audio_name = manifest.get("audio", {}).get("file") or f"episode-{episode['number']:02d}.mp3"
    try:
        href = audio_href(audio_name, base_url)
    except ValueError as exc:
        sys.exit(f"Episode {episode['number']}: 오디오 주소를 만들 수 없습니다 — {exc}")
    if not base_url and not (AUDIO_DIR / audio_name).exists():
        sys.exit(f"Episode {episode['number']}: manifest 는 있는데 음원 {audio_name} 이 없습니다.")

    if episode["truncated"]:
        print(
            f"  ! Episode {episode['number']}: 발췌 모드라 오디오를 싣지 않았습니다 "
            f"(오디오는 전체 {manifest['source']['scenes']}장면 기준입니다)."
        )
        return None

    verify_manifest(manifest, episode, source_sha)

    engine = manifest.get("engine", {})
    return {
        "file": href,
        "durationSec": manifest["audio"]["durationSec"],
        "segmentCount": manifest["audio"]["segmentCount"],
        "voice": engine.get("voice"),
        "speed": engine.get("speed"),
        "engine": engine.get("model"),
        "generated": manifest.get("generated"),
        "segments": [
            [
                row["scene"], row["line"], row["sentence"],
                int(round(row["start"] * 1000)), int(round(row["end"] * 1000)),
                row["charStart"], row["charEnd"],
            ]
            for row in manifest["segments"]
        ],
    }


def build_show(episodes: list[dict]) -> dict:
    """이 시리즈를 작품 항목 하나로 만든다. 시즌 구분이 없는 시리즈라 시즌 1 하나에 담는다."""
    return {
        "id": slugify(SERIES_TITLE),
        "title": SERIES_TITLE,
        "titleKo": SERIES_TITLE_KO,
        "lang": "en",
        "type": "series",
        "kind": "tts",
        "hasKo": False,
        "generated": _dt.date.today().isoformat(),
        "seasons": [{
            "number": 1,
            "plannedEpisodes": PLANNED_EPISODES,
            "episodes": episodes,
        }],
    }


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
    parser.add_argument(
        "--no-audio",
        action="store_true",
        help="docs/audio/tvshow 의 타임라인을 무시하고 스크립트만 반영한다",
    )
    parser.add_argument(
        "--audio-base-url",
        metavar="URL",
        help=f"Release 자산의 기준 https URL. 생략하면 docs/audio/tvshow/{RELEASE_CONFIG_NAME} 를 읽는다",
    )
    args = parser.parse_args()

    if args.audio_base_url:
        try:
            base_url = normalize_base_url(args.audio_base_url)
        except ValueError as exc:
            sys.exit(f"--audio-base-url 을 쓸 수 없습니다 — {exc}")
    else:
        base_url = read_release_base_url(AUDIO_DIR)

    parsed = collect(args.source, args.scenes)

    episodes: list[dict] = []
    for episode, source_sha in parsed:
        audio = None if args.no_audio else load_audio(episode, source_sha, base_url)
        if audio:
            episode["audio"] = audio
        episodes.append(episode)

    # 블록을 통째로 덮어쓰지 않는다. 같은 블록에 lang-study 로 녹음한 작품도 들어 있다.
    payload = read_payload()
    payload["generated"] = _dt.date.today().isoformat()
    upsert_show(payload, build_show(episodes))
    write_payload(payload)

    print(f"→ {TARGET.relative_to(REPO_ROOT)} 갱신")
    if base_url:
        print(f"  음원 출처: {base_url} (docs 에는 타임라인 JSON 만 둡니다)")
    for ep in episodes:
        mark = f" (발췌: 전체 {ep['totalScenes']}장면 중)" if ep["truncated"] else ""
        audio = ep.get("audio")
        sound = ""
        if audio:
            minutes, seconds = divmod(int(audio["durationSec"]), 60)
            sound = f" · 오디오 {minutes}:{seconds:02d} ({audio['segmentCount']}문장, {audio['voice']})"
        print(
            f"  Episode {ep['number']:>2}: 장면 {ep['sceneCount']}개 · "
            f"대사 {ep['lineCount']}줄 · {ep['wordCount']} words{mark}{sound}"
        )


if __name__ == "__main__":
    main()
