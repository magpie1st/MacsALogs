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
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent
TARGET = REPO_ROOT / "docs" / "tvshow.html"
AUDIO_DIR = REPO_ROOT / "docs" / "audio" / "tvshow"
AUDIO_URL_PREFIX = "audio/tvshow"
RELEASE_CONFIG_NAME = "config.json"
DEFAULT_SOURCE = Path("/home/magpie/Workspace/dev/macGitHub/book-maker/output")

START = "<!-- TVSHOW-DATA:START -->"
END = "<!-- TVSHOW-DATA:END -->"

#: 인라인 JSON 이 2.4MB 를 넘는다. 타임라인까지 들여쓰기로 펼치면 파일이 배로 커지므로
#: 세그먼트 행만 한 줄짜리 배열로 따로 직렬화해 끼워 넣는다.
SEGMENT_PLACEHOLDER = "@@TVSHOW_SEGMENTS_{id}@@"

SERIES_TITLE = "A Gentleman's Dignity"
SERIES_TITLE_KO = "신사의 품격"
PLANNED_EPISODES = 20

EPISODE_FILE_RE = re.compile(r"episode[_-]?(\d+)\.md$", re.IGNORECASE)


# ── 음원 주소 (공개 HTML 에 그대로 박히는 문자열) ────────────────────────────
#
# 규칙은 tts-maker 의 src/tts_maker/release.py 와 같다. 여기 한 벌 더 두는 이유는 이
# 저장소가 빌드 도구도 의존성도 없이 python3 하나로 돌아야 하기 때문이다. 둘이 어긋나면
# tts-maker 쪽 tests/test_build_tvshow_helpers.py 가 잡는다.
#
# 화이트리스트로 검사한다. 태그와 파일 이름에 필요한 문자는 영숫자와 `.`, `_`, `-`, `~` 뿐이고,
# 퍼센트 인코딩(`%`)은 `%2e%2e` 같은 우회로만 열어 주므로 통째로 막는다.

_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._~-]+$")
_ASSET_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

#: 음원은 언제나 GitHub Release 자산이므로 호스트와 경로 모양까지 고정한다. 임의의 https
#: 호스트를 받아 주면 config.json 한 줄로 공개 페이지가 남의 서버에서 음원을 불러온다.
RELEASE_HOST = "github.com"
RELEASE_PATH_MARKERS = ("releases", "download")
RELEASE_URL_SHAPE = f"https://{RELEASE_HOST}/<owner>/<repo>/releases/download/<tag>"
_FORBIDDEN_CHARS = frozenset("?#%\\<>\"'`{}|^ \t\r\n")

#: 공개 HTML 에 절대 들어가면 안 되는 흔적. 개인 머신 경로가 남으면 지울 방법이 없다.
#:
#: 역슬래시(UNC `\\`, `C:\`)는 여기에 넣지 않는다. 대본은 자막에서 왔고 `{\a6}` 같은 ASS
#: 서식 태그와 `\119` 같은 표기가 본문에 그대로 남아 있다. JSON 으로 직렬화하면 역슬래시가
#: 두 개로 늘어나 UNC 경로와 구분되지 않는다 — 실제로 전편 생성이 여기서 한 번 멈췄다.
#: Windows 경로는 이 워크플로에 등장하지 않으므로 검사에서 뺀다.
_LEAKY = ("/home/", "/Users/", "/root/", "file://")

#: 인라인 `<script type="application/json">` 안에서 HTML 파서는 JSON 을 모른다. 본문에
#: `</script>` 가 있으면 블록이 거기서 끝나고 뒤가 HTML 로 해석된다 — 대본은 자막에서 왔으므로
#: 언젠가 그런 줄이 들어올 수 있다. JSON 유니코드 이스케이프로 바꾸면 HTML 파서에는 보이지
#: 않으면서 JSON.parse 결과는 원문 그대로다. `&` 는 script 안에서 실체화되지 않지만 같이 막아
#: 둔다. U+2028/2029 는 JSON 에서는 합법이지만 JS 소스에서는 줄바꿈으로 읽힌다.
_JSON_ESCAPES = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
}
_JSON_ESCAPE_RE = re.compile("[<>&\u2028\u2029]")


def escape_inline_json(text: str) -> str:
    """직렬화된 JSON 에서 script 문맥을 깨는 문자를 JSON 이스케이프로 바꾼다.

    이 문자들은 JSON 문법에서는 쓰이지 않으므로 **반드시 문자열 값 안에만** 있다.
    그래서 통째로 치환해도 json.loads 결과는 원문과 같다.
    """
    return _JSON_ESCAPE_RE.sub(lambda m: _JSON_ESCAPES[m.group()], text)


def normalize_base_url(raw: str) -> str:
    """Release 자산의 기준 URL 을 검사하고 끝의 `/` 를 떼어 정규화한다.

    https 만 받는다. http 주소는 https 로 서빙되는 페이지에서 mixed content 로 차단되어
    "동작하지 않는 URL 을 조용히 심는" 결과가 된다.

    받는 모양은 `https://github.com/<owner>/<repo>/releases/download/<tag>` 하나뿐이다.
    owner/repo/tag 에만 자유 문자가 오고 호스트와 가운데 두 구간은 고정이다.
    """
    if not isinstance(raw, str):
        raise ValueError(f"URL 은 문자열이어야 합니다: {type(raw).__name__}")

    url = raw.strip()
    if not url:
        raise ValueError("URL 이 비어 있습니다.")
    if not url.isascii() or any(c in _FORBIDDEN_CHARS or ord(c) < 0x20 for c in url):
        raise ValueError(f"URL 에 쓸 수 없는 문자가 있습니다: {raw!r}")

    parts = urlsplit(url)
    if parts.scheme.lower() != "https":
        raise ValueError(f"https URL 만 허용합니다: {raw!r}")
    if parts.query or parts.fragment:
        raise ValueError(f"URL 에 쿼리나 프래그먼트를 붙일 수 없습니다: {raw!r}")

    host = parts.netloc.lower()
    if "@" in host:
        raise ValueError(f"URL 에 자격증명을 담을 수 없습니다: {raw!r}")
    if host != RELEASE_HOST:
        # 포트가 붙은 주소도 여기서 함께 걸린다 — Release 자산에는 포트가 없다
        raise ValueError(f"{RELEASE_HOST} 의 Release 주소만 허용합니다: {raw!r}")

    segments = parts.path.strip("/").split("/")
    if len(segments) != 5 or tuple(segments[2:4]) != RELEASE_PATH_MARKERS:
        raise ValueError(f"Release 주소가 {RELEASE_URL_SHAPE} 모양이 아닙니다: {raw!r}")
    for segment in (segments[0], segments[1], segments[4]):
        if not _SEGMENT_RE.match(segment) or segment in (".", ".."):
            raise ValueError(f"URL 경로에 쓸 수 없는 구간이 있습니다 ({segment!r}): {raw!r}")

    return f"https://{host}/" + "/".join(segments)


def audio_href(name: str, base_url: str | None) -> str:
    """manifest 의 파일 이름을 페이지가 쓸 주소로 바꾼다.

    base_url 이 있으면 Release 자산의 절대 https 주소, 없으면 기존 상대경로다.
    어느 쪽이든 파일 이름은 순수 basename 이어야 한다 — manifest 는 tts-maker 가 만들지만,
    여기서 한 번 더 막지 않으면 `../` 하나로 엉뚱한 파일을 가리키게 할 수 있다.
    """
    if not isinstance(name, str) or not _ASSET_NAME_RE.match(name) or ".." in name:
        raise ValueError(f"오디오 파일 이름으로 쓸 수 없습니다: {name!r}")
    if base_url:
        return f"{normalize_base_url(base_url)}/{name}"
    return f"{AUDIO_URL_PREFIX}/{name}"


def read_release_base_url(audio_dir: Path) -> str | None:
    """docs/audio/tvshow/config.json 이 있으면 기준 URL 을 읽는다. 없으면 None.

    깨진 설정은 **무시하지 않고 중단한다.** 조용히 넘기면 로컬 mp3 가 없는 상태로 상대경로가
    박혀서, 배포된 뒤에야 재생 실패로 드러난다.
    """
    path = audio_dir / RELEASE_CONFIG_NAME
    if not path.exists():
        return None
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"{path} 를 읽을 수 없습니다: {exc}")
    raw = (config or {}).get("audioBaseUrl")
    if not raw:
        sys.exit(f"{path} 에 audioBaseUrl 이 없습니다.")
    try:
        return normalize_base_url(raw)
    except ValueError as exc:
        sys.exit(f"{path} 의 audioBaseUrl 을 쓸 수 없습니다 — {exc}")


def assert_publishable(text: str) -> None:
    """공개 HTML 에 들어갈 문자열을 마지막으로 본다. 개인 머신 경로와 script 탈출을 막는다.

    `escape_inline_json` 이 이미 걸렀어야 하는 문자들을 한 번 더 확인한다. 직렬화 경로가
    바뀌어 이스케이프가 빠지면 `</script>` 하나로 JSON 블록이 끝나고 뒤가 HTML 이 된다.
    """
    for needle in (*_LEAKY, str(Path.home())):
        if needle and needle in text:
            sys.exit(f"공개 JSON 에 로컬 경로가 섞였습니다 ({needle!r}). 생성을 중단합니다.")
    for char in _JSON_ESCAPES:
        if char in text:
            sys.exit(
                f"공개 JSON 에 이스케이프되지 않은 {char!r} 가 남았습니다. "
                "인라인 script 블록을 깨뜨릴 수 있어 생성을 중단합니다."
            )


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


def build_payload(episodes: list[dict]) -> dict:
    return {
        "series": SERIES_TITLE,
        "seriesKo": SERIES_TITLE_KO,
        "lang": "en",
        "generated": _dt.date.today().isoformat(),
        "plannedEpisodes": PLANNED_EPISODES,
        "episodes": episodes,
    }


def serialize(payload: dict) -> str:
    """세그먼트 행만 한 줄로 접어서 직렬화한다.

    json.dumps(indent=2) 는 숫자 하나마다 줄을 바꾼다. 타임라인 1,006행이면 7천 줄이
    더 붙어 파일이 쓸데없이 커진다. 자리표시자로 빼 두었다가 압축 직렬화로 되돌린다.

    마지막에 `escape_inline_json` 을 거쳐 인라인 script 블록을 깨뜨릴 문자를 없앤다.
    """
    folded: dict[str, str] = {}
    for episode in payload["episodes"]:
        audio = episode.get("audio")
        if not audio:
            continue
        token = SEGMENT_PLACEHOLDER.format(id=episode["id"])
        folded[token] = json.dumps(audio["segments"], ensure_ascii=False, separators=(",", ":"))
        audio["segments"] = token

    text = json.dumps(payload, ensure_ascii=False, indent=2)
    for token, compact in folded.items():
        text = text.replace(json.dumps(token), compact)
    return escape_inline_json(text)


def write_block(payload: dict) -> None:
    html = TARGET.read_text(encoding="utf-8")
    if START not in html or END not in html:
        sys.exit(f"{TARGET} 에서 TVSHOW-DATA 마커를 찾지 못했습니다.")

    serialized = serialize(payload)
    assert_publishable(serialized)

    block = (
        START
        + '\n  <script type="application/json" id="tvshow-data">\n'
        + serialized
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

    write_block(build_payload(episodes))

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
