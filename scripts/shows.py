#!/usr/bin/env python3
"""docs/tvshow.html 의 JSON 블록(작품 → 시즌 → 화)을 읽고 쓴다.

생성기가 둘이다. `build_tvshow.py` 는 TTS 로 만든 시리즈를, `build_langstudy.py` 는
lang-study 로 녹음한 작품을 담당한다. 둘은 서로 다른 머신에서 돌 수 있으므로
(TTS 쪽은 원본 Markdown 이 있는 머신에서만 돈다) **자기 작품만 갈아 끼우고 나머지는
읽어서 그대로 되쓴다.** 그래서 한쪽을 돌려도 다른 작품이 사라지지 않는다.

예전 형식(작품 하나, 시즌 개념 없음)은 읽는 즉시 작품 → 시즌 → 화로 옮긴다.
원본 Markdown 없이도 옮길 수 있도록 **HTML 에 이미 들어 있는 episodes 를 그대로** 쓴다.

공개 HTML 에 들어가는 문자열을 다루므로 검사 두 겹을 지난다.
`escape_inline_json` 이 script 문맥을 깨는 문자를 바꾸고, `assert_publishable` 이
개인 머신 경로와 남은 이스케이프를 마지막으로 막는다. 둘 다 통과해야 파일을 쓴다.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent
TARGET = REPO_ROOT / "docs" / "tvshow.html"
AUDIO_URL_PREFIX = "audio/tvshow"
RELEASE_CONFIG_NAME = "config.json"

START = "<!-- TVSHOW-DATA:START -->"
END = "<!-- TVSHOW-DATA:END -->"

SCHEMA = "tvshow-data/2"

#: 인라인 JSON 이 2.4MB 를 넘는다. 타임라인까지 들여쓰기로 펼치면 파일이 배로 커지므로
#: 세그먼트 행만 한 줄짜리 배열로 따로 직렬화해 끼워 넣는다.
SEGMENT_PLACEHOLDER = "@@TVSHOW_SEGMENTS_{id}@@"

_SLUG_RE = re.compile(r"[^a-z0-9]+")


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


def audio_href(name: str, base_url: str | None, prefix: str = AUDIO_URL_PREFIX) -> str:
    """manifest 의 파일 이름을 페이지가 쓸 주소로 바꾼다.

    base_url 이 있으면 Release 자산의 절대 https 주소, 없으면 기존 상대경로다.
    어느 쪽이든 파일 이름은 순수 basename 이어야 한다 — manifest 는 tts-maker 가 만들지만,
    여기서 한 번 더 막지 않으면 `../` 하나로 엉뚱한 파일을 가리키게 할 수 있다.
    """
    if not isinstance(name, str) or not _ASSET_NAME_RE.match(name) or ".." in name:
        raise ValueError(f"오디오 파일 이름으로 쓸 수 없습니다: {name!r}")
    if base_url:
        return f"{normalize_base_url(base_url)}/{name}"
    return f"{prefix}/{name}"


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


# ── 작품 → 시즌 → 화 ────────────────────────────────────────────────────────


def slugify(text: str) -> str:
    """작품 id. 주소 해시(#emily-in-paris-s05e01)에 들어가므로 ASCII 로만 만든다."""
    slug = _SLUG_RE.sub("-", (text or "").lower()).strip("-")
    if not slug:
        raise ValueError(f"작품 id 를 만들 수 없습니다: {text!r}")
    return slug


def iter_episodes(payload: dict):
    """어느 형식이든 회차를 모두 훑는다. (고유키, 회차) 를 돌려준다.

    예전 형식(payload["episodes"])도 받는다 — tts-maker 의 교차 테스트가 그 모양으로
    serialize 를 부른다.
    """
    for episode in payload.get("episodes") or []:
        yield f"v1-{episode.get('id')}", episode
    for show in payload.get("shows") or []:
        for season in show.get("seasons") or []:
            for episode in season.get("episodes") or []:
                # 작품마다 회차 id 가 겹칠 수 있으므로 작품·시즌을 붙여 고유하게 만든다
                yield f"{show.get('id')}-s{season.get('number')}-{episode.get('id')}", episode


def serialize(payload: dict) -> str:
    """세그먼트 행만 한 줄로 접어서 직렬화한다.

    json.dumps(indent=2) 는 숫자 하나마다 줄을 바꾼다. 타임라인 1,006행이면 7천 줄이
    더 붙어 파일이 쓸데없이 커진다. 자리표시자로 빼 두었다가 압축 직렬화로 되돌린다.

    마지막에 `escape_inline_json` 을 거쳐 인라인 script 블록을 깨뜨릴 문자를 없앤다.
    """
    folded: dict[str, str] = {}
    for key, episode in iter_episodes(payload):
        audio = episode.get("audio")
        if not audio or not isinstance(audio.get("segments"), list):
            continue
        token = SEGMENT_PLACEHOLDER.format(id=key)
        folded[token] = json.dumps(audio["segments"], ensure_ascii=False, separators=(",", ":"))
        audio["segments"] = token

    text = json.dumps(payload, ensure_ascii=False, indent=2)
    for token, compact in folded.items():
        text = text.replace(json.dumps(token), compact)
    return escape_inline_json(text)


def migrate(payload: dict) -> dict:
    """예전 형식(작품 하나)을 작품 → 시즌 → 화로 옮긴다. 이미 새 형식이면 그대로.

    회차 내용은 손대지 않고 그대로 옮긴다. 원본 Markdown 이 없는 머신에서도
    새 형식으로 바꿔 쓸 수 있어야 하기 때문이다.
    """
    if payload.get("shows") is not None:
        return payload
    episodes = payload.get("episodes") or []
    if not episodes:
        # 빈 블록. 없는 작품을 하나 만들어 두면 선택 목록에 'Untitled' 가 남는다
        return {"schema": SCHEMA, "generated": payload.get("generated"), "shows": []}
    title = payload.get("series") or "Untitled"
    show = {
        "id": slugify(title),
        "title": title,
        "titleKo": payload.get("seriesKo"),
        "lang": payload.get("lang") or "en",
        "kind": "tts",
        "hasKo": False,
        "seasons": [{
            "number": 1,
            "plannedEpisodes": payload.get("plannedEpisodes") or len(episodes),
            "episodes": episodes,
        }],
    }
    return {"schema": SCHEMA, "generated": payload.get("generated"), "shows": [show]}


def read_payload() -> dict:
    """HTML 의 JSON 블록을 읽어 새 형식으로 돌려준다. 블록이 비어 있으면 빈 payload."""
    html = TARGET.read_text(encoding="utf-8")
    if START not in html or END not in html:
        sys.exit(f"{TARGET} 에서 TVSHOW-DATA 마커를 찾지 못했습니다.")
    inner = html.partition(START)[2].partition(END)[0]
    body = re.sub(r"^\s*<script[^>]*>|</script>\s*$", "", inner.strip(), flags=re.S).strip()
    if not body:
        return {"schema": SCHEMA, "generated": None, "shows": []}
    try:
        return migrate(json.loads(body))
    except json.JSONDecodeError as exc:
        sys.exit(f"{TARGET} 의 JSON 블록을 읽을 수 없습니다: {exc}")


def upsert_show(payload: dict, show: dict) -> dict:
    """작품 하나를 갈아 끼운다(id 기준). 나머지 작품은 건드리지 않는다.

    순서는 처음 들어온 순서를 지킨다 — 작품 선택 목록의 순서가 빌드할 때마다 바뀌면
    쓰는 사람이 혼란스럽다.
    """
    if not show.get("id"):
        raise ValueError("작품에 id 가 없습니다.")
    payload.setdefault("shows", [])
    for i, existing in enumerate(payload["shows"]):
        if existing.get("id") == show["id"]:
            payload["shows"][i] = show
            return payload
    payload["shows"].append(show)
    return payload


def upsert_season(show: dict, number: int, episode: dict, planned: int | None = None) -> dict:
    """회차 하나를 작품의 시즌에 갈아 끼운다. 시즌·회차 모두 번호 순으로 정렬해 둔다."""
    show.setdefault("seasons", [])
    season = next((s for s in show["seasons"] if s.get("number") == number), None)
    if season is None:
        season = {"number": number, "episodes": []}
        show["seasons"].append(season)
    if planned:
        season["plannedEpisodes"] = planned
    season.setdefault("episodes", [])
    for i, existing in enumerate(season["episodes"]):
        if existing.get("id") == episode.get("id"):
            season["episodes"][i] = episode
            break
    else:
        season["episodes"].append(episode)
    season["episodes"].sort(key=lambda e: e.get("number") or 0)
    show["seasons"].sort(key=lambda s: s.get("number") or 0)
    return show


def write_payload(payload: dict) -> None:
    """JSON 블록만 교체한다. HTML 의 다른 부분은 건드리지 않는다."""
    html = TARGET.read_text(encoding="utf-8")
    if START not in html or END not in html:
        sys.exit(f"{TARGET} 에서 TVSHOW-DATA 마커를 찾지 못했습니다.")

    payload["schema"] = SCHEMA
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


# write_block: 예전 이름 (build_tvshow.py 가 쓰던 것)
def write_block(payload: dict) -> None:
    write_payload(payload)
