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
publish = load("publish_shows")

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

# 한글 작품 id 가 자리표시자 치환을 깨뜨린 적이 있다 (본문은 ensure_ascii=False 로 쓰면서
# 자리표시자는 기본 ensure_ascii=True 로 찾아 한글이 \uXXXX 로 escape 됐다 → 조용히 실패).
hangul = {
    "shows": [{
        "id": "오징어-게임", "title": "오징어 게임", "type": "series",
        "seasons": [{"number": 2, "episodes": [
            {"number": 3, "id": "s02e03",
             "scenes": [{"n": 1, "lines": [{"text": "Shall we?", "ko": "할까요?"}]}],
             "audio": {"file": "x.mp3", "segments": [[1, 1, 0, 5500, 7200, 0, 9]]}}]}],
    }],
}
hangul_text = shows.serialize(json.loads(json.dumps(hangul)))
check_true("한글 id 에서도 자리표시자가 남지 않는다", "@@TVSHOW_SEGMENTS" not in hangul_text)
hangul_loaded = json.loads(hangul_text)
check("한글 id 에서도 세그먼트가 목록으로 복원된다",
      hangul_loaded["shows"][0]["seasons"][0]["episodes"][0]["audio"]["segments"],
      [[1, 1, 0, 5500, 7200, 0, 9]])
check("한글 작품 id 보존", hangul_loaded["shows"][0]["id"], "오징어-게임")

print("\nslugify / slugify_display: 주소는 한글, 자산 이름은 ASCII")
check("표시용은 한글을 둔다", shows.slugify_display("오징어 게임"), "오징어-게임")
check("표시용도 소문자 ASCII", shows.slugify_display("Emily In Paris"), "emily-in-paris")
check("경로·해시를 깨는 글자는 바뀐다", shows.slugify_display("a/b#c%d e"), "a-b-c-d-e")
check("자산 이름은 로마자", shows.asset_slug_for("오징어 게임"), "ojingeo-geim")
check("영문 제목은 그대로", shows.asset_slug_for("Emily in Paris"), "emily-in-paris")
check("자산 이름은 언제나 ASCII", shows.asset_slug_for("기생충").isascii(), True)
raises("빈 제목은 거부", lambda: shows.slugify_display("   "))

print("\nromanize: 음절을 그대로 옮긴다 (연음 규칙 없음 — 같은 제목이 늘 같은 값이어야 한다)")
check("오징어 게임", shows.romanize("오징어 게임"), "ojingeo geim")
check("받침은 표기법대로", shows.romanize("신사"), "sinsa")
check("한글이 아닌 글자는 그대로", shows.romanize("Mr. 김"), "Mr. gim")
check("빈 값", shows.romanize(""), "")

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

print("\nresolve_show_id: 사람의 입력 없이도 끝까지 정해진다")
saved = langstudy.REGISTRY.read_text(encoding="utf-8") if langstudy.REGISTRY.exists() else None
try:
    langstudy.REGISTRY.write_text("{}", encoding="utf-8")   # 빈 레지스트리에서 시작
    check("영문 id 를 주면 슬러그",
          langstudy.resolve_show_id({"title": "x"}, "Emily In Paris"), "emily-in-paris")
    check("영문 제목은 그대로",
          langstudy.resolve_show_id({"title": "Emily in Paris"}, None), "emily-in-paris")
    # 한글 제목도 더는 멈추지 않는다 — 주소에 한글을 쓸 수 있다
    check("한글 제목은 그대로 주소가 된다",
          langstudy.resolve_show_id({"title": "오징어 게임"}, None), "오징어-게임")
    check("자산 이름은 로마자",
          langstudy.resolve_asset_slug({"title": "오징어 게임"}, "오징어-게임"), "ojingeo-geim")
    # 제목이 기호뿐이면 videoId 로 떨어진다
    check("제목이 없으면 videoId",
          langstudy.resolve_show_id({"title": "!!!", "videoId": "81040344"}, None), "show-81040344")

    print("\n작품 id 레지스트리: 한 번 정하면 바뀌지 않는다")
    langstudy.remember_show("오징어 게임", "오징어-게임", "ojingeo-geim", "Squid Game")
    registry = langstudy.load_registry()
    check("주소 id 와 자산 슬러그를 함께 기억",
          [registry["오징어 게임"]["id"], registry["오징어 게임"]["assetSlug"]],
          ["오징어-게임", "ojingeo-geim"])
    check("titleEn 도 함께", registry["오징어 게임"]["titleEn"], "Squid Game")
    # 규칙이 바뀌어도 기억한 값이 이긴다 (주소가 움직이면 북마크가 깨진다)
    langstudy.remember_show("오징어 게임", "다른-id", "other-slug", None)
    check("기억한 값을 덮어쓰지 않는다", langstudy.load_registry()["오징어 게임"]["id"], "오징어-게임")
    check("기억한 뒤에는 그 값을 쓴다",
          langstudy.resolve_show_id({"title": "오징어 게임"}, None), "오징어-게임")
    check("직접 준 값이 기억보다 우선",
          langstudy.resolve_show_id({"title": "오징어 게임"}, "other-id"), "other-id")
    check("제목이 없으면 기억하지 않는다",
          langstudy.remember_show("", "x", "y", None), None)

    print("\n영문 제목을 알면 주소·파일 이름을 둘 다 영문으로")
    korean = {"title": "투 브로크 걸즈", "videoId": "cp-777"}
    check("영문 제목 없으면 한글 주소", langstudy.resolve_show_id(korean, None), "투-브로크-걸즈")
    check("영문 제목 없으면 로마자 자산",
          langstudy.resolve_asset_slug(korean, "투-브로크-걸즈"), "tu-beurokeu-geoljeu")
    en = langstudy.english_title(korean, "2 Broke Girls")
    check("영문 제목 받기", en, "2 Broke Girls")
    check("영문 제목이면 영문 주소", langstudy.resolve_show_id(korean, None, en), "2-broke-girls")
    check("영문 제목이면 영문 자산",
          langstudy.resolve_asset_slug(korean, "2-broke-girls", en), "2-broke-girls")
    # 제목 자체가 영문이면(넷플릭스 UI 가 영어) 따로 줄 필요가 없다
    check("영문 제목은 저절로", langstudy.english_title({"title": "Breaking Bad"}, None), "Breaking Bad")
    check("한글 제목은 영문으로 안 센다", langstudy.english_title({"title": "기생충"}, None), None)

    print("\nUI 언어를 바꿔 제목이 달라져도 같은 작품으로 본다")
    # 실제로 겪은 일: 넷플릭스 UI 를 영어로 바꾸자 '에밀리, 파리에 가다' 가 'Emily in Paris'
    # 로 들어와 emily-in-paris-2 라는 작품이 새로 생겼다 (1·2화와 3화가 갈라졌다).
    langstudy.REGISTRY.write_text(json.dumps({
        "에밀리, 파리에 가다": {"id": "emily-in-paris", "assetSlug": "emily-in-paris",
                           "titleEn": "Emily in Paris"},
    }, ensure_ascii=False), encoding="utf-8")
    check("영문 제목으로 들어와도 같은 작품",
          langstudy.resolve_show_id({"title": "Emily in Paris"}, None), "emily-in-paris")
    check("자산 슬러그도 같다",
          langstudy.resolve_asset_slug({"title": "Emily in Paris"}, "emily-in-paris"), "emily-in-paris")
    check("대소문자·공백은 무시", langstudy.resolve_show_id({"title": " emily in PARIS "}, None),
          "emily-in-paris")
    # 별칭으로 기억해 두면 titleEn 이 없어도 찾는다
    langstudy.remember_show("Emily in Paris", "emily-in-paris", "emily-in-paris", None)
    entry = langstudy.load_registry()["에밀리, 파리에 가다"]
    check("별칭으로 기억한다", entry.get("aliases"), ["Emily in Paris"])
    check("새 항목을 만들지 않는다", sorted(langstudy.load_registry()), ["에밀리, 파리에 가다"])
    key, found = langstudy.find_entry(langstudy.load_registry(), "Emily in Paris")
    check("find_entry 가 정본 제목을 돌려준다", key, "에밀리, 파리에 가다")
    check("정말 다른 작품은 못 찾는다",
          langstudy.find_entry(langstudy.load_registry(), "Breaking Bad"), (None, None))

    langstudy.REGISTRY.write_text("{}", encoding="utf-8")
    # 다른 제목이 같은 id 를 쓰면 번호를 붙인다 (두 작품의 회차가 섞이면 눈에 안 띈다)
    langstudy.remember_show("어떤 작품", "same-id", "same-id", None)
    check("id 충돌이면 번호를 붙인다",
          langstudy.resolve_show_id({"title": "Same Id"}, None), "same-id-2")
finally:
    if saved is None:
        langstudy.REGISTRY.unlink(missing_ok=True)
    else:
        langstudy.REGISTRY.write_text(saved, encoding="utf-8")

print("\n영화: 시즌·회차 없이 feature 회차 하나로 담는다")
movie_script = {"title": "테스트 영화", "durationSec": 5400.0, "recordedSec": 5200.0,
                "sentences": [sent(1, 12.0, 13.8, "Hello.", "안녕"),
                              sent(2, 60.0, 61.5, "Bye.", "잘 가")]}
groups = langstudy.group_scenes(movie_script["sentences"], 4.0)
movie_ep = langstudy.build_episode(movie_script, groups, None, movie=True)
check("회차 id", movie_ep["id"], shows.MOVIE_EPISODE_ID)
check("제목은 작품 제목", movie_ep["title"], "테스트 영화")
check("fullTitle 에 시즌이 안 붙는다", movie_ep["fullTitle"], "테스트 영화")
check("줄 수", movie_ep["lineCount"], 2)
# 시리즈로 만들면 같은 입력이 1화가 된다
series_ep = langstudy.build_episode({**movie_script, "season": 5, "episodeNo": 3}, groups, None)
check("시리즈는 sNNeNN", series_ep["id"], "s05e03")
check("시리즈 제목", series_ep["title"], "3화")

print("\nnormalize: type 이 없는 예전 작품은 시리즈로 본다")
normalized = shows.normalize({"shows": [{"id": "a"}, {"id": "b", "type": "movie"}]})
check("기본은 series", normalized["shows"][0]["type"], shows.TYPE_SERIES)
check("있는 값은 그대로", normalized["shows"][1]["type"], shows.TYPE_MOVIE)

# ── 음원 공개 (업로드하지 않는 부분만) ──────────────────────────────────────
print("\naudio_block / retarget: 주소를 Release 로 돌리고 세그먼트는 지킨다")

TAG = "shows-audio-2026-10-31-v1"
BASE2 = f"https://github.com/magpie1st/MacsALogs/releases/download/{TAG}"
MANIFEST = {
    "episodeId": "s05e01", "season": 5, "episode": 1, "generated": "2026-10-31",
    "audio": {"asset": "emily-in-paris-s05e01.mp3", "sourceName": "원본.mp3",
              "durationSec": 2043.82, "recordedSec": 1817.0},
}

block = publish.audio_block(MANIFEST, BASE2)
check("Release 주소", block["file"], f"{BASE2}/emily-in-paris-s05e01.mp3")
check("길이", block["durationSec"], 2043.82)
check("녹음된 비율", block["coverage"], round(1817.0 / 2043.82, 3))
check("preview 표시 없음", block.get("preview"), None)

# --local-audio 로 만든 상태를 흉내 낸다 (상대경로 + preview)
SEGS = [[1, 1, 0, 25320, 28110, 0, 17], [1, 2, 0, 28400, 30020, 0, 9]]
payload2 = {"shows": [{"id": "emily-in-paris", "seasons": [{"number": 5, "episodes": [
    {"number": 1, "id": "s05e01", "audio": {
        "file": "audio/shows/emily-in-paris/emily-in-paris-s05e01.mp3",
        "preview": True, "segments": SEGS, "segmentCount": 2}},
]}]}]}
touched = publish.retarget(payload2, "emily-in-paris", [MANIFEST], BASE2)
after = payload2["shows"][0]["seasons"][0]["episodes"][0]["audio"]
check("바꾼 회차", touched, ["s05e01"])
check("주소가 Release 로", after["file"], f"{BASE2}/emily-in-paris-s05e01.mp3")
check("preview 표시가 지워진다", after.get("preview"), None)
check("세그먼트는 그대로", after["segments"], SEGS)
check("문장 수도 그대로", after["segmentCount"], 2)

# manifest 가 없는 회차는 건드리지 않는다
payload3 = {"shows": [{"id": "emily-in-paris", "seasons": [{"number": 5, "episodes": [
    {"number": 2, "id": "s05e02", "audio": {"file": "그대로.mp3"}}]}]}]}
check("manifest 없는 회차는 그대로", publish.retarget(payload3, "emily-in-paris", [MANIFEST], BASE2), [])
check("주소 유지", payload3["shows"][0]["seasons"][0]["episodes"][0]["audio"]["file"], "그대로.mp3")
raises("없는 작품은 중단", lambda: publish.retarget({"shows": []}, "없는작품", [MANIFEST], BASE2))

print("\nfind_source: manifest 의 sourceName 으로 원본을 찾는다")
import tempfile
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    folder = root / "에밀리, 파리에 가다 시즌 5 1화"
    folder.mkdir()
    (folder / "원본.mp3").write_bytes(b"x")
    check("sourceName 으로 찾음", publish.find_source(MANIFEST, root, None), folder / "원본.mp3")
    # sourceName 이 없는 예전 manifest → 시즌·회차로 폴더를 짐작한다
    legacy = {"season": 5, "episode": 1, "audio": {"asset": "a.mp3"}}
    check("시즌·회차로 짐작", publish.find_source(legacy, root, None), folder / "원본.mp3")
    check("없으면 None", publish.find_source({"season": 9, "episode": 9, "audio": {}}, root, None), None)

print()
if failures:
    print(f"실패 {len(failures)}건: " + ", ".join(failures))
    sys.exit(1)
print("모두 통과")
