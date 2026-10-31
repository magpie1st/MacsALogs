#!/usr/bin/env python3
"""shows.py · build_langstudy.py 자체 검사.

    python3 scripts/test_shows.py

이 저장소는 빌드 도구도 의존성도 없이 python3 하나로 돌아야 하므로 pytest 를 쓰지 않는다.
확인하는 것은 **공개 HTML 에 그대로 박히는 것들**이다.

  - 예전 형식(작품 하나)을 작품 → 시즌 → 화로 옮길 때 회차가 하나도 사라지지 않는가
  - 생성기 하나를 돌려도 다른 작품이 남아 있는가 (둘이 다른 머신에서 돈다)
  - 세그먼트를 접어 직렬화해도 json.loads 결과가 원문과 같은가
  - script 문맥을 깨는 문자와 개인 머신 경로가 막히는가
  - 문장 묶기·시간 변환이 자막 시간을 흐트러뜨리지 않는가
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(SCRIPTS))
shows = load("shows")
langstudy = load("build_langstudy")

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}\n       got  {got!r}\n       want {want!r}")
        failures.append(label)


def check_true(label: str, value) -> None:
    check(label, bool(value), True)


def raises(label: str, fn) -> None:
    try:
        fn()
    except (SystemExit, ValueError):
        print(f"  ok   {label}")
        return
    print(f"  FAIL {label} — 막히지 않았습니다")
    failures.append(label)


# ── 예전 형식 옮기기 ────────────────────────────────────────────────────────
print("migrate: 예전 형식(작품 하나) → 작품 → 시즌 → 화")

V1 = {
    "series": "A Gentleman's Dignity",
    "seriesKo": "신사의 품격",
    "lang": "en",
    "generated": "2026-09-15",
    "plannedEpisodes": 20,
    "episodes": [
        {"number": 1, "id": "ep01", "title": "Episode 1", "scenes": [{"n": 1, "lines": []}],
         "audio": {"file": "x.mp3", "segments": [[1, 1, 0, 0, 100, 0, 3]]}},
        {"number": 2, "id": "ep02", "title": "Episode 2", "scenes": []},
    ],
}

migrated = shows.migrate(json.loads(json.dumps(V1)))
check("작품 1개", len(migrated["shows"]), 1)
show = migrated["shows"][0]
check("id 는 ASCII 슬러그", show["id"], "a-gentleman-s-dignity")
check("제목 보존", show["title"], "A Gentleman's Dignity")
check("보조 제목 보존", show["titleKo"], "신사의 품격")
check("kind", show["kind"], "tts")
check("시즌 1개", len(show["seasons"]), 1)
check("회차 2개가 그대로", [e["id"] for e in show["seasons"][0]["episodes"]], ["ep01", "ep02"])
check("plannedEpisodes 보존", show["seasons"][0]["plannedEpisodes"], 20)
check("오디오 보존", show["seasons"][0]["episodes"][0]["audio"]["segments"], [[1, 1, 0, 0, 100, 0, 3]])
check("이미 새 형식이면 그대로", shows.migrate(migrated) is migrated, True)
check("빈 블록도 터지지 않는다", shows.migrate({})["shows"], [])

# ── 생성기 둘이 서로를 지우지 않는다 ────────────────────────────────────────
print("\nupsert_show: 한 생성기를 돌려도 다른 작품이 남는다")

payload = shows.migrate(json.loads(json.dumps(V1)))
shows.upsert_show(payload, {"id": "emily-in-paris", "title": "에밀리", "kind": "recording", "seasons": []})
check("작품 2개", [s["id"] for s in payload["shows"]], ["a-gentleman-s-dignity", "emily-in-paris"])

# TTS 쪽 생성기가 자기 작품만 갈아 끼우는 상황
shows.upsert_show(payload, {"id": "a-gentleman-s-dignity", "title": "갱신됨", "kind": "tts", "seasons": []})
check("갈아 끼워도 순서 유지", [s["id"] for s in payload["shows"]], ["a-gentleman-s-dignity", "emily-in-paris"])
check("내용은 새것", payload["shows"][0]["title"], "갱신됨")
check("다른 작품 그대로", payload["shows"][1]["title"], "에밀리")
raises("id 없는 작품은 거부", lambda: shows.upsert_show(payload, {"title": "x"}))

# ── 시즌·회차 끼우기 ────────────────────────────────────────────────────────
print("\nupsert_season: 시즌·회차는 번호 순으로 정렬된다")

show = {"id": "emily-in-paris", "seasons": []}
shows.upsert_season(show, 5, {"number": 2, "id": "s05e02"})
shows.upsert_season(show, 5, {"number": 1, "id": "s05e01"}, planned=10)
shows.upsert_season(show, 4, {"number": 1, "id": "s04e01"})
check("시즌 정렬", [s["number"] for s in show["seasons"]], [4, 5])
check("회차 정렬", [e["id"] for e in show["seasons"][1]["episodes"]], ["s05e01", "s05e02"])
check("planned 반영", show["seasons"][1]["plannedEpisodes"], 10)
shows.upsert_season(show, 5, {"number": 1, "id": "s05e01", "title": "다시"})
check("같은 회차는 덮어쓴다", len(show["seasons"][1]["episodes"]), 2)
check("덮어쓴 내용", show["seasons"][1]["episodes"][0]["title"], "다시")

# ── 직렬화: 접어도 원문과 같아야 한다 ───────────────────────────────────────
print("\nserialize: 세그먼트를 접어도 json.loads 결과가 같다")

EVIL = '</script><script>alert(1)</script> & <b>    '
deep = {
    "schema": shows.SCHEMA,
    "shows": [{
        "id": "a", "title": EVIL,
        "seasons": [{"number": 1, "episodes": [
            {"number": 1, "id": "e1", "scenes": [{"n": 1, "lines": [{"text": EVIL, "ko": EVIL}]}],
             "audio": {"file": "x.mp3", "segments": [[1, 1, 0, 0, 100, 0, 5], [1, 1, 1, 100, 200, 5, 9]]}},
        ]}],
    }],
}
text = shows.serialize(json.loads(json.dumps(deep)))
check_true("script 닫기 없음", "</script" not in text.lower())
check_true("꺾쇠·앰퍼샌드 없음", "<" not in text and ">" not in text and "&" not in text)
check_true("U+2028/2029 없음", " " not in text and " " not in text)
loaded = json.loads(text)
ep = loaded["shows"][0]["seasons"][0]["episodes"][0]
check("본문 원문 복원", ep["scenes"][0]["lines"][0]["text"], EVIL)
check("한국어 원문 복원", ep["scenes"][0]["lines"][0]["ko"], EVIL)
check("세그먼트 복원", ep["audio"]["segments"], [[1, 1, 0, 0, 100, 0, 5], [1, 1, 1, 100, 200, 5, 9]])
check_true("세그먼트는 한 줄로 접힌다", '"segments": [[1,1,0,0,100,0,5],[1,1,1,100,200,5,9]]' in text)

# 작품이 둘일 때 회차 id 가 겹쳐도 각자 접힌다
twin = {
    "shows": [
        {"id": "a", "seasons": [{"number": 1, "episodes": [
            {"id": "e1", "audio": {"segments": [[1, 1, 0, 0, 1, 0, 1]]}}]}]},
        {"id": "b", "seasons": [{"number": 1, "episodes": [
            {"id": "e1", "audio": {"segments": [[2, 2, 0, 0, 2, 0, 2]]}}]}]},
    ]
}
twin_loaded = json.loads(shows.serialize(json.loads(json.dumps(twin))))
check("회차 id 가 겹쳐도 섞이지 않는다",
      [twin_loaded["shows"][0]["seasons"][0]["episodes"][0]["audio"]["segments"],
       twin_loaded["shows"][1]["seasons"][0]["episodes"][0]["audio"]["segments"]],
      [[[1, 1, 0, 0, 1, 0, 1]], [[2, 2, 0, 0, 2, 0, 2]]])

print("\nassert_publishable: 개인 머신 경로와 script 탈출을 막는다")
raises("</script> 거부", lambda: shows.assert_publishable('{"t": "</script>"}'))
raises("/Users/ 경로 거부", lambda: shows.assert_publishable('{"t": "/Users/mac/Downloads/x.mp3"}'))
raises("/home/ 경로 거부", lambda: shows.assert_publishable('{"t": "/home/magpie/x"}'))
shows.assert_publishable('{"t": "\\u003cb\\u003e"}')
print("  ok   이스케이프된 것은 통과")

print("\naudio_href: Release 주소만 받는다")
BASE = "https://github.com/magpie1st/MacsALogs/releases/download/shows-audio-2026-10-31-v1"
check("Release 절대주소", shows.audio_href("a-s05e01.mp3", BASE), BASE + "/a-s05e01.mp3")
check("기준 URL 없으면 상대경로", shows.audio_href("x.mp3", None, "audio/shows"), "audio/shows/x.mp3")
raises("상위 경로 거부", lambda: shows.audio_href("../x.mp3", BASE))
raises("http 거부", lambda: shows.audio_href("x.mp3", BASE.replace("https", "http")))
raises("다른 호스트 거부", lambda: shows.audio_href("x.mp3", BASE.replace("github.com", "evil.com")))

# ── lang-study 입력 다루기 ──────────────────────────────────────────────────
print("\nparse_clock / group_scenes: 자막 시간을 흐트러뜨리지 않는다")
check("m:ss", langstudy.parse_clock("0:25"), 25.0)
check("mm:ss", langstudy.parse_clock("12:34"), 754.0)
check("h:mm:ss", langstudy.parse_clock("1:02:03"), 3723.0)

def sent(no, start, end, en="x", ko=None, recorded=1):
    return {"no": no, "start": start, "end": end, "en": en, "ko": ko, "recorded": recorded}

# 3초 간격은 한 장면, 5초는 끊긴다 (기본 4초)
groups = langstudy.group_scenes(
    [sent(1, 0, 2), sent(2, 5, 6), sent(3, 20, 21)], langstudy.DEFAULT_SCENE_GAP)
check("간격으로 장면을 끊는다", [[s["no"] for s in g] for g in groups], [[1, 2], [3]])
check("빈 입력", langstudy.group_scenes([], 4.0), [])
long_run = [sent(i, i * 0.5, i * 0.5 + 0.4) for i in range(1, 95)]
sizes = [len(g) for g in langstudy.group_scenes(long_run, 4.0)]
check_true("쉼 없이 이어져도 장면을 끊는다", max(sizes) <= langstudy.MAX_LINES_PER_SCENE)
check("문장이 하나도 사라지지 않는다", sum(sizes), 94)

print("\nbuild_episode: 줄·세그먼트가 문장 수와 맞는다")
script = {
    "title": "에밀리, 파리에 가다", "season": 5, "episodeNo": 1, "episodeTitle": None,
    "durationSec": 1817.0, "recordedSec": 1817.0,
    "sentences": [
        sent(1, 25.32, 28.11, "Come back to bed.", "다시 침대로 와요"),
        sent(2, 28.4, 30.02, "I'm late.", "지각이에요"),
        sent(3, 99.0, 99.5, "Silent one.", None, recorded=0.0),
    ],
}
episode = langstudy.build_episode(script, langstudy.group_scenes(script["sentences"], 4.0),
                                 {"file": "x.mp3", "durationSec": 1817.0})
check("회차 id", episode["id"], "s05e01")
check("회차 제목", episode["title"], "1화")
check("줄 수 = 문장 수", episode["lineCount"], 3)
check("세그먼트 수 = 문장 수", episode["audio"]["segmentCount"], 3)
check("장면 2개 (99초에서 끊김)", episode["sceneCount"], 2)
first = episode["scenes"][0]["lines"][0]
check("한국어 보존", first["ko"], "다시 침대로 와요")
check("소수점 초 → ms", episode["audio"]["segments"][0][3:5], [25320, 28110])
check("녹음 없는 문장은 silent", episode["scenes"][1]["lines"][0].get("silent"), True)
check("녹음된 문장엔 silent 없음", first.get("silent"), None)
check("세그먼트의 장면·줄 번호", [s[:2] for s in episode["audio"]["segments"]], [[1, 1], [1, 2], [2, 1]])
check("fullTitle", episode["fullTitle"], "에밀리, 파리에 가다 시즌 5 1화")

print("\nprobe_duration: mp3 길이 읽기 (ffprobe 없거나 깨진 파일이면 None)")
import tempfile
with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as fh:
    fh.write(b"not an mp3")
    junk = Path(fh.name)
check("깨진 파일은 None", langstudy.probe_duration(junk), None)
check("없는 파일도 None (터지지 않는다)", langstudy.probe_duration(Path("/tmp/없는파일.mp3")), None)
junk.unlink()

print("\nresolve_show_id: 한글 제목은 영문 id 를 요구한다")
check("영문 id 를 주면 슬러그", langstudy.resolve_show_id({"title": "x"}, "Emily In Paris"), "emily-in-paris")
check("영문 제목이면 자동", langstudy.resolve_show_id({"title": "Emily in Paris"}, None), "emily-in-paris")
raises("한글 제목만 있으면 중단", lambda: langstudy.resolve_show_id({"title": "에밀리, 파리에 가다"}, None))

print()
if failures:
    print(f"실패 {len(failures)}건: " + ", ".join(failures))
    sys.exit(1)
print("모두 통과")
