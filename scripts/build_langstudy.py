#!/usr/bin/env python3
"""lang-study 로 녹음한 회차를 docs/tvshow.html 의 스크립트 리더에 넣는다.

입력은 lang-study 사이드 패널의 **에피소드 탭**에서 내려받은 두 가지다.

    <내보낸 폴더>/
      ... 스크립트.json     ← '스크립트 JSON' 버튼 (문장·시간·한국어)
      ... 전체.mp3          ← '전체 MP3' 버튼 (파일 시간 = 영상 시간)

사용법:
    python3 scripts/build_langstudy.py -n "~/Downloads/lang-study/<작품> 시즌 5 1화" \\
        --show-id emily-in-paris
    python3 scripts/build_langstudy.py "~/Downloads/lang-study/<작품> 시즌 5 1화" \\
        --show-id emily-in-paris \\
        --audio-base-url https://github.com/magpie1st/MacsALogs/releases/download/shows-audio-2026-10-31-v1

하는 일은 둘이다.
  1. `docs/audio/shows/<작품 id>/sNNeNN.json` 에 문장 타임라인을 쓴다
  2. `docs/tvshow.html` 의 JSON 블록에서 **그 작품만** 갈아 끼운다 (다른 작품은 그대로)

**mp3 는 이 저장소에 두지 않는다.** GitHub Pages 사이트 상한이 1GB 인데 한 회차가 16MB다.
음원은 Release 자산으로 올리고 Pages 에는 타임라인 JSON 만 둔다. 이 스크립트는 올려야 할
`gh release` 명령을 출력할 뿐, 업로드도 커밋도 하지 않는다 (tts-maker 쪽과 같은 규칙).

원본(내려받은 폴더)은 읽기만 하고 수정하지 않는다.
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from shows import (
    MOVIE_EPISODE_ID,
    asset_slug_for,
    show_id_for,
    slugify_display,
    TYPE_MOVIE,
    TYPE_SERIES,
    audio_href,
    normalize_base_url,
    read_payload,
    read_release_base_url,
    slugify,
    upsert_season,
    upsert_show,
    write_payload,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SHOWS_DIR = REPO_ROOT / "docs" / "audio" / "shows"
AUDIO_URL_PREFIX = "audio/shows"

SCRIPT_SCHEMA = "lang-study-script/1"
RELEASE_CONFIG = "config.json"
REPO = "magpie1st/MacsALogs"
RELEASE_BASE = f"https://github.com/{REPO}/releases/download"
MANIFEST_SCHEMA = "tvshow-audio/2"

#: 문장 사이가 이만큼 벌어지면 장면이 바뀐 것으로 본다. 자막에는 장면 표시가 없어서
#: 읽기 블록을 나눌 근거가 시간 간격밖에 없다. 4초면 대화 사이 숨과 장면 전환이 갈린다.
DEFAULT_SCENE_GAP = 4.0

#: 한 장면이 이보다 길어지면 끊는다. 쉼 없이 이어지는 대화(법정·논쟁)에서 장면 하나가
#: 수백 줄이 되면 화면에서 찾아 읽기가 어렵다.
MAX_LINES_PER_SCENE = 40

_ASSET_STEM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

#: 작품 제목 → 주소에 쓸 영문 id. 한글 제목에서 id 를 기계적으로 만들 수는 없어서
#: (주소 해시는 ASCII 여야 한다) 작품마다 **한 번만** 사람이 정하고 여기에 적어 둔다.
#: 그 뒤 같은 작품의 다른 회차는 --show-id 없이 돌아간다.
#: docs/ 밖에 둔다 — 빌드 설정이고 공개할 것이 아니다.
REGISTRY = Path(__file__).resolve().parent / "show_ids.json"


def load_registry() -> dict:
    if not REGISTRY.exists():
        return {}
    try:
        return json.loads(REGISTRY.read_text(encoding="utf-8")) or {}
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"{REGISTRY} 를 읽을 수 없습니다: {exc}")


def find_entry(registry: dict, title: str) -> tuple[str | None, dict | None]:
    """제목으로 기억해 둔 항목을 찾는다. **같은 작품이 다른 제목으로 들어올 수 있다.**

    넷플릭스 UI 언어를 바꾸면 제목이 바뀐다 — '에밀리, 파리에 가다' 가 'Emily in Paris' 로
    들어온다. 글자만 비교하면 같은 작품이 둘로 갈라지므로(실제로 3화에서 그랬다), 기억해 둔
    영문 제목(titleEn)과 예전에 본 제목(aliases)까지 함께 본다.
    """
    if not title:
        return None, None
    if title in registry:
        return title, registry[title]
    low = title.strip().lower()
    for name, entry in registry.items():
        names = [entry.get("titleEn") or ""] + list(entry.get("aliases") or [])
        if any(n.strip().lower() == low for n in names if n):
            return name, entry
    return None, None


def remember_show(title: str, show_id: str, asset_slug: str, title_en: str | None) -> None:
    """작품 제목 → (주소 id, 자산 슬러그)를 적어 둔다.

    **한 번 적은 값은 바꾸지 않는다.** 만드는 규칙이 나중에 바뀌어도 이미 올린 작품의
    주소와 자산 이름은 그대로여야 한다 (주소가 바뀌면 북마크가 깨지고, 자산 이름이
    바뀌면 Release 에 옛 파일이 남는다).
    """
    if not title:
        return
    registry = load_registry()
    key, found = find_entry(registry, title)
    if key is None:
        # --show-id 로 이미 있는 작품을 가리킨 경우 → 그 작품의 별칭으로 붙인다.
        # 안 그러면 합쳐 놓고도 다음 회차에서 또 "처음 보는 제목" 이 된다.
        for name, e in registry.items():
            if e.get("id") == show_id:
                key, found = name, e
                break
    key = key or title
    entry = dict(found or {})
    before = dict(entry)
    entry.setdefault("id", show_id)
    entry.setdefault("assetSlug", asset_slug)
    if title_en:
        entry["titleEn"] = title_en
    # 다른 제목으로 들어온 같은 작품을 기억한다 (UI 언어를 또 바꿔도 갈라지지 않는다)
    if title != key:
        aliases = sorted(set(entry.get("aliases") or []) | {title})
        entry["aliases"] = aliases
    if entry == before:
        return
    registry[key] = entry
    REGISTRY.write_text(
        json.dumps(dict(sorted(registry.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    print(f"  작품 id 를 기억했습니다: {title!r} → {entry['id']} / 자산 {entry['assetSlug']} ({REGISTRY.name})")


def parse_clock(text: str) -> float:
    """"1:02:03" / "2:03" → 초. CSV 의 사람용 시간 열은 초 단위로 반올림돼 있다."""
    seconds = 0
    for part in text.strip().split(":"):
        seconds = seconds * 60 + int(part)
    return float(seconds)


def load_from_csv(path: Path) -> tuple[dict, bool]:
    """sentences.csv 에서 문장을 읽는다 (스크립트 JSON 이 없는 예전 내보내기용).

    v0.9.0 부터는 `start_sec`·`end_sec` 열에 소수점 초가 있다. 없으면 사람용 시간 열을
    쓸 수밖에 없는데 그건 초 단위로 반올림된 값이라 문장 강조가 최대 0.5초 밀린다.
    두 번째 값으로 "정밀한가"를 돌려주고, 부정확하면 부르는 쪽에서 경고한다.

    CSV 에는 **끝까지 녹음된 문장만** 들어 있다 (90% 이상). 녹음이 빈 문장은 대본에서
    통째로 빠지므로, 대본을 온전히 담으려면 스크립트 JSON 을 써야 한다.
    """
    rows = list(csv.DictReader(path.read_text(encoding="utf-8-sig").splitlines()))
    if not rows:
        sys.exit(f"{path.name} 에 문장이 없습니다.")
    precise = "start_sec" in rows[0] and "end_sec" in rows[0]
    sentences = []
    for index, row in enumerate(rows, start=1):
        try:
            if precise:
                start, end = float(row["start_sec"]), float(row["end_sec"])
            else:
                start, end = parse_clock(row["시작"]), parse_clock(row["끝"])
        except (KeyError, TypeError, ValueError) as exc:
            sys.exit(f"{path.name} {index}번째 줄의 시간을 읽을 수 없습니다: {exc}")
        sentences.append({
            "no": int(row.get("번호") or index),
            "start": start,
            "end": end,
            "en": (row.get("영어") or "").strip(),
            "ko": (row.get("한국어") or "").strip() or None,
            "recorded": 1,
        })
    last = max(s["end"] for s in sentences)
    return {
        "schema": SCRIPT_SCHEMA,
        "generated": _dt.date.today().isoformat(),
        "title": None, "season": None, "episodeNo": None, "episodeTitle": None,
        "durationSec": last, "recordedSec": last, "audio": {},
        "sentences": sentences,
    }, precise


def load_script(folder: Path, explicit: Path | None) -> tuple[dict, Path, bool]:
    """스크립트 JSON 을 찾아 읽는다. 없으면 sentences.csv 로 떨어진다.

    세 번째 값은 "시간이 정밀한가"다. 스크립트 JSON 은 항상 정밀하다.
    """
    if explicit:
        candidates = [explicit]
        if not explicit.exists():
            sys.exit(f"스크립트 JSON 을 찾지 못했습니다: {explicit}")
    else:
        # 최상위의 '<회차> 스크립트.json' 이 먼저고, 그다음이 문장별 ZIP 을 푼 폴더의
        # script.json 이다. **ZIP 안도 봐야 한다** — MP3 와 ZIP 만 받으면 그쪽에만 있다.
        candidates = [p for p in sorted(folder.glob("*.json")) if p.is_file()]
        candidates += [p for p in sorted(folder.glob("*/script.json")) if p.is_file()]

    for path in candidates:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            if explicit:
                sys.exit(f"{path} 를 읽을 수 없습니다: {exc}")
            continue
        if data.get("schema") != SCRIPT_SCHEMA:
            if explicit:
                sys.exit(
                    f"{path.name} 의 schema 가 {SCRIPT_SCHEMA} 가 아닙니다 ({data.get('schema')!r}).\n"
                    "  lang-study 를 v0.9.0 이상으로 올린 뒤 다시 내보내세요."
                )
            continue
        if not data.get("sentences"):
            sys.exit(f"{path.name} 에 문장이 없습니다.")
        return data, path, True

    # 예전 내보내기: 문장별 ZIP 을 푼 폴더에 sentences.csv 만 있다
    csvs = sorted(folder.glob("**/sentences.csv"))
    if len(csvs) == 1:
        data, precise = load_from_csv(csvs[0])
        return data, csvs[0], precise
    sys.exit(
        f"{folder} 에 스크립트 JSON 이 없습니다"
        + (f" (JSON {len(candidates)}개를 봤지만 schema 가 맞지 않습니다)" if candidates else "")
        + ".\n  lang-study 사이드 패널 → 에피소드 탭 → '스크립트 JSON' 또는 '문장별 ZIP' 을"
        " 내려받으세요."
    )


def find_audio(folder: Path, explicit: Path | None) -> Path | None:
    """전체 MP3 를 찾는다. 없어도 진행한다 (타임라인만 갱신하는 경우)."""
    if explicit:
        if not explicit.exists():
            sys.exit(f"오디오 파일을 찾지 못했습니다: {explicit}")
        return explicit
    found = sorted(p for p in folder.glob("*.mp3") if p.is_file())
    if not found:
        return None
    if len(found) > 1:
        names = "\n".join(f"    {p.name}" for p in found)
        sys.exit(f"{folder} 에 mp3 가 여러 개입니다. --audio 로 지정하세요:\n{names}")
    return found[0]


def probe_duration(path: Path) -> float | None:
    """mp3 의 실제 길이(초). ffprobe 가 없으면 None.

    CSV 로 읽으면 영상 길이를 알 수 없어 '마지막 자막 시각' 을 길이로 쓰게 되는데,
    자막이 끝난 뒤 크레딧이 몇 분 더 있어서 실제보다 짧게 잡힌다 (1화는 30:17 vs 34:03).
    길이가 틀리면 화면의 '녹음 N분' 과 녹음된 비율이 둘 다 어긋난다.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    try:
        return round(float(out.stdout.strip()), 2)
    except ValueError:
        return None


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def group_scenes(sentences: list[dict], gap: float) -> list[list[dict]]:
    """문장을 시간 간격으로 장면처럼 묶는다.

    자막에는 장면 표시가 없다. 묶는 기준은 읽기 편하라고 두는 것이고, 재생 위치는
    문장의 start·end 가 결정하므로 묶기가 틀려도 소리는 어긋나지 않는다.
    """
    scenes: list[list[dict]] = []
    current: list[dict] = []
    previous_end: float | None = None
    for sentence in sentences:
        too_long = len(current) >= MAX_LINES_PER_SCENE
        far = previous_end is not None and (sentence["start"] - previous_end) >= gap
        if current and (far or too_long):
            scenes.append(current)
            current = []
        current.append(sentence)
        previous_end = sentence["end"]
    if current:
        scenes.append(current)
    return scenes


def build_episode(script: dict, groups: list[list[dict]], audio_meta: dict | None,
                  movie: bool = False) -> dict:
    """회차(또는 영화) 하나를 만든다. scenes/lines/segments 모양은 TTS 쪽과 똑같이 맞춘다.

    리더(tvshow.js)의 본문 그리기와 문장 강조를 그대로 쓰기 위해서다. 다른 점은
    줄에 `ko`(한국어 자막)가 붙고, 녹음이 빈 문장에 `silent` 가 붙는 것뿐이다.

    영화는 시즌·회차가 없다. 회차 하나(`feature`)에 담되 제목을 작품 제목으로 둔다 —
    화면에서는 시즌·회차 선택이 숨고 제목만 보인다.
    """
    season = 1 if movie else (script.get("season") or 1)
    number = 1 if movie else (script.get("episodeNo") or 1)
    scenes = []
    segments = []
    for scene_index, group in enumerate(groups, start=1):
        lines = []
        for line_index, sentence in enumerate(group, start=1):
            line = {"kind": "dialogue", "text": sentence["en"]}
            if sentence.get("ko"):
                line["ko"] = sentence["ko"]
            # 녹음이 거의 없는 문장. 대본에는 넣고 소리 없음으로 표시한다
            if (sentence.get("recorded") or 0) < 0.5:
                line["silent"] = True
            lines.append(line)
            segments.append([
                scene_index,
                line_index,
                0,
                int(round(sentence["start"] * 1000)),
                int(round(sentence["end"] * 1000)),
                0,
                len(sentence["en"]),
            ])
        scenes.append({"n": scene_index, "lines": lines})

    if movie:
        title = script.get("title") or "영화"
        episode_id = MOVIE_EPISODE_ID
        full_title = title
    else:
        title = f"{number}화"
        if script.get("episodeTitle"):
            title = f"{number}화 {script['episodeTitle']}"
        episode_id = f"s{season:02d}e{number:02d}"
        full_title = " ".join(
            part for part in [script.get("title"), f"시즌 {season}", title] if part
        )

    episode = {
        "number": number,
        "id": episode_id,
        "title": title,
        "fullTitle": full_title,
        "sceneCount": len(scenes),
        "totalScenes": len(scenes),
        "truncated": False,
        "lineCount": sum(len(s["lines"]) for s in scenes),
        "wordCount": sum(len(s["en"].split()) for s in script["sentences"]),
        "scenes": scenes,
    }
    if audio_meta:
        episode["audio"] = {**audio_meta, "segmentCount": len(segments), "segments": segments}
    return episode


def build_audio_meta(script: dict, asset_name: str, base_url: str | None, audio_path: Path | None) -> dict:
    meta = {
        "file": audio_href(asset_name, base_url, AUDIO_URL_PREFIX),
        "durationSec": script.get("durationSec") or 0,
        "engine": "lang-study recording",
        "voice": None,
        "speed": 1.0,
        "generated": script.get("generated"),
        # 녹음된 비율. 1 미만이면 중간에 무음 구간이 있다
        "coverage": round((script.get("recordedSec") or 0) / (script.get("durationSec") or 1), 3),
    }
    if audio_path:
        meta["bytes"] = audio_path.stat().st_size
    return meta


def write_manifest(folder_id: str, episode_id: str, script: dict, episode: dict,
                   script_path: Path, asset_name: str, audio_path: Path | None = None,
                   show_id: str | None = None) -> Path:
    """문장 타임라인을 docs/audio/shows/<작품>/ 에 남긴다.

    HTML 블록만으로도 페이지는 돌지만, 나중에 다시 빌드하거나 어긋남을 확인할 때
    원본에 다시 손대지 않고 여기서 읽을 수 있어야 한다.
    """
    out_dir = SHOWS_DIR / folder_id
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{episode_id}.json"
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "generated": _dt.date.today().isoformat(),
        # show: 페이지 주소에 쓰는 id (한글 가능). folder: 이 폴더 이름 = 자산 슬러그 (ASCII)
        "show": show_id or folder_id,
        "folder": folder_id,
        "season": script.get("season") or 1,
        "episode": episode["number"],
        "episodeId": episode_id,
        "title": episode["title"],
        # 폴더 경로는 담지 않는다 — 공개 HTML 에 개인 머신 경로가 섞이면 지울 방법이 없다
        "source": {
            "name": script_path.name,
            "sha256": hashlib.sha256(script_path.read_bytes()).hexdigest(),
            "sentences": len(script["sentences"]),
        },
        "audio": {
            "asset": asset_name,
            # 올릴 원본 mp3 의 **파일 이름만** 둔다. publish_shows.py 가 내려받은 폴더에서
            # 이 이름으로 찾는다. 경로를 담으면 공개되는 manifest 에 개인 머신 경로가 섞인다.
            "sourceName": audio_path.name if audio_path else None,
            "durationSec": script.get("durationSec"),
            "recordedSec": script.get("recordedSec"),
            "rate": (script.get("audio") or {}).get("rate"),
            "channels": (script.get("audio") or {}).get("channels"),
        },
        "segments": [
            {
                "no": s["no"], "start": s["start"], "end": s["end"],
                "en": s["en"], "ko": s.get("ko"), "recorded": s.get("recorded"),
            }
            for s in script["sentences"]
        ],
    }
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def remove_show(show_id: str, dry: bool) -> None:
    """작품을 페이지와 타임라인에서 지운다.

    Release 자산(mp3)은 지우지 않는다 — 다른 작품이 같은 태그를 쓸 수 있고, 지우는 쪽이
    되돌릴 수 없는 쪽이라 사람이 판단하게 둔다 (`gh release delete-asset`).
    """
    payload = read_payload()
    before = len(payload.get("shows") or [])
    payload["shows"] = [s for s in (payload.get("shows") or []) if s.get("id") != show_id]
    found = len(payload["shows"]) < before
    folder = SHOWS_DIR / show_id

    print(f"작품      {show_id}")
    print(f"페이지    {'지웁니다' if found else '없습니다'}")
    print(f"타임라인  {folder.relative_to(REPO_ROOT) if folder.is_dir() else '(없음)'}")
    if dry:
        print("\n(-n 이라 아무것도 지우지 않았습니다)")
        return
    if not found and not folder.is_dir():
        sys.exit("지울 것이 없습니다.")

    if found:
        write_payload(payload)
    if folder.is_dir():
        shutil.rmtree(folder)
    print("\n지웠습니다. 음원 Release 자산은 남아 있습니다 (필요하면 gh release delete-asset).")


def english_title(script: dict, explicit: str | None) -> str | None:
    """영문 제목. 직접 준 값 → 기억해 둔 값 → 제목 자체가 영문이면 그것.

    넷플릭스·쿠팡플레이는 페이지에 **지역화된 제목만** 둔다 (제목을 DOM 에서 읽는다).
    UI 언어가 영어면 제목이 애초에 영문으로 들어오고, 한국어면 한글로 들어온다.
    그래서 영문 제목은 `--title-en` 으로 한 번 주거나 UI 언어를 영어로 바꿔야 얻어진다.
    """
    if explicit:
        return explicit.strip() or None
    title = (script.get("title") or "").strip()
    entry = find_entry(load_registry(), title)[1] or {}
    if entry.get("titleEn"):
        return entry["titleEn"]
    return title if title.isascii() and any(c.isalnum() for c in title) else None


def resolve_asset_slug(script: dict, show_id: str, title_en: str | None = None) -> str:
    """mp3 자산 이름에 쓸 ASCII 슬러그. 기억해 둔 값이 먼저다.

    주소 id 와 다른 값일 수 있다 — 영문 제목을 모르면 주소에는 한글 제목이 보이고
    파일 이름만 로마자가 된다. 영문 제목을 알면 둘 다 그것으로 맞춘다.

    예전에 적어 둔 항목에는 assetSlug 가 없다. 그때는 그 시절 자산 이름이 곧 id 였으므로
    id 를 쓴다 (이미 Release 에 올라간 파일 이름을 바꾸면 안 된다).
    """
    registry = load_registry()
    title = script.get("title") or ""
    entry = find_entry(registry, title)[1] or {}
    if not entry:
        # --show-id 로 이미 있는 작품에 합치는 경우. 제목으로는 못 찾지만 그 작품의 자산
        # 이름을 따라가야 한다 — 안 그러면 같은 작품의 회차가 두 폴더로 갈라진다.
        entry = next((e for e in registry.values() if e.get("id") == show_id), {})
    if entry.get("assetSlug"):
        return entry["assetSlug"]
    if entry.get("id") and entry["id"].isascii():
        return entry["id"]
    for candidate in (title_en, title):
        if not candidate:
            continue
        try:
            return asset_slug_for(candidate)
        except ValueError:
            continue
    return slugify(f"show-{script.get('videoId') or 'x'}")


def resolve_show_id(script: dict, explicit: str | None, title_en: str | None = None) -> str:
    """주소에 쓸 작품 id. 사람의 입력 없이도 끝까지 정해진다.

    순서: 직접 준 값 → 기억해 둔 값 → 제목에서 만들기(영문 그대로/한글은 로마자)
          → videoId.

    **기억해 둔 값이 가장 먼저다.** 만드는 규칙이 나중에 바뀌어도 이미 올린 작품의
    주소는 움직이지 않아야 한다 (주소가 바뀌면 북마크가 깨지고 예전 항목이 남는다).
    """
    if explicit:
        # 주소 id 는 한글을 써도 된다 (`#투-브로크-걸즈`). ASCII 전용 slugify 를 쓰면
        # 한글 id 로 합치려 할 때 거부당한다.
        try:
            return slugify_display(explicit)
        except ValueError:
            sys.exit(f"--show-id 를 주소에 쓸 수 없습니다: {explicit!r}")

    title = script.get("title") or ""
    registry = load_registry()
    known_key, known_entry = find_entry(registry, title)
    if known_entry and known_entry.get("id"):
        if known_key != title:
            print(f"  같은 작품으로 봅니다: {title!r} = {known_key!r} (id: {known_entry['id']})")
        return known_entry["id"]

    # 영문 제목을 알면 주소도 영문으로 만든다 (#emily-in-paris). 모르면 제목을 그대로 쓴다.
    for candidate in (english_title(script, title_en), title):
        if not candidate:
            continue
        try:
            base = show_id_for(candidate)
            break
        except ValueError:
            continue
    else:
        base = None
    if base is None:
        # 제목이 기호뿐이라 아무것도 못 만든 경우. videoId 는 넷플릭스가 준 유일한 값이다.
        video_id = str(script.get("videoId") or "").strip()
        if not video_id.isalnum():
            sys.exit(
                f"작품 제목 {title!r} 으로 id 를 만들 수 없습니다.\n"
                "  --show-id <영문-id> 로 한 번만 지정하세요."
            )
        return f"show-{video_id}"

    # 다른 제목이 이미 그 id 를 쓰고 있으면 뒤에 번호를 붙인다. 안 그러면 두 작품의
    # 회차가 한 작품에 섞여 들어가는데, 눈에 띄지 않아 더 나쁘다.
    taken = {e.get("id"): name for name, e in registry.items() if name != (known_key or title)}
    candidate = base
    suffix = 2
    while candidate in taken:
        print(f"  ! id {candidate!r} 는 이미 {taken[candidate]!r} 가 쓰고 있어 번호를 붙입니다")
        candidate = f"{base}-{suffix}"
        suffix += 1

    # 처음 보는 제목이다. **같은 작품인지 기계가 알 방법이 없다** — 넷플릭스는 작품 단위
    # id 를 주지 않고(videoId 는 회차마다 다르다) 제목은 UI 언어를 따른다. 그래서 조용히
    # 새 작품을 만들지 않고 이미 있는 작품을 보여 주며 합치는 방법을 알린다.
    if registry:
        print(f"  ! 처음 보는 제목입니다: {title!r} → 새 작품 {candidate!r} 로 넣습니다")
        print("    이미 있는 작품:")
        for name, e in sorted(registry.items()):
            marks = [e.get("titleEn")] + list(e.get("aliases") or [])
            also = " / ".join(sorted({m for m in marks if m and m != name}))
            print(f"      {e.get('id'):24} {name}" + (f"  (= {also})" if also else ""))
        print(f"    같은 작품이면 --show-id <위 id> 를 한 번 주면 합쳐집니다"
              " (제목은 별칭으로 기억됩니다).")
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", type=Path, nargs="?", help="lang-study 가 내려받은 회차 폴더")
    parser.add_argument("--remove-show", metavar="ID",
                        help="작품을 페이지에서 지운다 (타임라인 manifest 도 함께). 음원 Release 자산은 남는다")
    parser.add_argument("--script", type=Path, help="스크립트 JSON 경로 (폴더에 여러 개일 때)")
    parser.add_argument("--audio", type=Path, help="전체 MP3 경로 (폴더에 여러 개일 때)")
    parser.add_argument("--show-id", help="작품 id (주소 해시에 쓴다. 한글 제목이면 필수)")
    parser.add_argument("--title", help="화면에 보일 작품 제목 (생략하면 스크립트 JSON 의 제목)")
    parser.add_argument("--title-en", help="영문 제목 (제목 아래 보조로 보인다)")
    parser.add_argument("--movie", action="store_true",
                        help="영화로 넣는다 (시즌·회차 없음). 스크립트 JSON 에 시즌·회차가 없으면 자동 판별")
    parser.add_argument("--series", action="store_true",
                        help="자동 판별을 무시하고 시리즈로 넣는다 (--season·--episode 와 함께)")
    parser.add_argument("--season", type=int, help="시즌 번호 (CSV 로 읽을 때는 알 수 없어 필수)")
    parser.add_argument("--episode", type=int, help="회차 번호 (CSV 로 읽을 때는 알 수 없어 필수)")
    parser.add_argument("--planned", type=int, help="그 시즌의 전체 회차 수 (선택 목록에 '준비 중' 표시)")
    parser.add_argument("--scene-gap", type=float, default=DEFAULT_SCENE_GAP,
                        help=f"이만큼 벌어지면 장면을 끊는다 (초, 기본 {DEFAULT_SCENE_GAP})")
    parser.add_argument("--local-audio", action="store_true",
                        help="mp3 를 docs 로 복사해 로컬에서 들어 본다 (배포용이 아니다. docs/audio/shows 는 .gitignore)")
    parser.add_argument("--audio-base-url", metavar="URL",
                        help="Release 자산의 기준 https URL. 생략하면 docs/audio/shows/<작품>/config.json")
    parser.add_argument("--publish", action="store_true",
                        help="넣은 뒤 음원을 Release 에 올린다 (publish_shows.py --yes). 공개 저장소다")
    parser.add_argument("--push", action="store_true", help="--publish 와 함께: 커밋·푸시까지")
    parser.add_argument("-n", "--dry-run", action="store_true", help="쓰지 않고 무엇이 바뀔지만 보여 준다")
    args = parser.parse_args()
    if args.push and not args.publish:
        sys.exit("--push 는 --publish 와 함께 씁니다.")

    if args.remove_show:
        remove_show(args.remove_show, args.dry_run)
        return

    if not args.folder:
        sys.exit("회차 폴더를 주세요 (또는 --remove-show ID).")
    folder = args.folder.expanduser()
    if not folder.is_dir():
        sys.exit(f"폴더가 아닙니다: {folder}")

    script, script_path, precise = load_script(folder, args.script.expanduser() if args.script else None)
    audio_path = find_audio(folder, args.audio.expanduser() if args.audio else None)

    # CSV 로 읽었으면 시즌·회차가 비어 있다. 1/1 로 조용히 떨어지면 다른 회차를 덮어쓴다.
    if args.season:
        script["season"] = args.season
    if args.episode:
        script["episodeNo"] = args.episode
    if args.title:
        script["title"] = args.title
    # 영화 판별: 자막에 시즌·회차가 없으면 영화다 (Netflix 영화는 둘 다 비어 온다).
    # CSV 로 읽은 경우는 원래 비어 있으므로 판별에 쓸 수 없다 — 그때는 사람이 정한다.
    movie = args.movie
    if not movie and not args.series and precise and not script.get("season") and not script.get("episodeNo"):
        movie = True
        print("영화      스크립트 JSON 에 시즌·회차가 없어 영화로 넣습니다 (--series 로 바꿀 수 있습니다)")
    args.movie = movie

    if not args.movie and (not script.get("season") or not script.get("episodeNo")):
        sys.exit(
            "시즌·회차를 알 수 없습니다. --season 5 --episode 1 처럼 지정하세요.\n"
            "  영화라면 --movie 를 주세요 (시즌·회차 없이 넣습니다).\n"
            "  (스크립트 JSON 에는 들어 있지만 sentences.csv 에는 없습니다.)"
        )
    if not script.get("title") and not args.title:
        sys.exit("작품 제목을 알 수 없습니다. --title \"에밀리, 파리에 가다\" 처럼 지정하세요.")

    title_en = english_title(script, args.title_en)
    show_id = resolve_show_id(script, args.show_id, title_en)
    asset_slug = resolve_asset_slug(script, show_id, title_en)
    if args.movie:
        season, number = 1, 1
        episode_id = MOVIE_EPISODE_ID
    else:
        season = script["season"]
        number = script["episodeNo"]
        episode_id = f"s{season:02d}e{number:02d}"
    # 자산 이름만 ASCII 다 (GitHub Release 제약). 주소에는 한글 제목이 그대로 보인다.
    asset_name = f"{asset_slug}-{episode_id}.mp3"
    if not _ASSET_STEM_RE.match(asset_name):
        sys.exit(f"음원 파일 이름으로 쓸 수 없습니다: {asset_name!r}")

    if args.audio_base_url:
        try:
            base_url = normalize_base_url(args.audio_base_url)
        except ValueError as exc:
            sys.exit(f"--audio-base-url 을 쓸 수 없습니다 — {exc}")
    else:
        config_path = SHOWS_DIR / asset_slug / RELEASE_CONFIG
        # --publish 로 끝까지 갈 때는 처음 보는 작품이라도 기준 URL 을 먼저 정해 둔다.
        # 그러지 않으면 이 빌드에 세그먼트가 빠진 채 들어가고(오디오 없음), 뒤이은 업로드가
        # 주소만 바꿔 줘서 문장 버튼이 없는 회차가 남는다.
        if args.publish and not config_path.exists() and not args.dry_run:
            tag = f"shows-audio-{_dt.date.today().isoformat()}-v1"
            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(json.dumps({
                "schema": "shows-audio-release/1",
                "generated": _dt.date.today().isoformat(),
                "audioBaseUrl": f"{RELEASE_BASE}/{tag}",
                "note": "mp3는 이 저장소에 두지 않는다. Release 자산으로만 올린다 (Pages 사이트 상한 1GB).",
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"음원 태그  {tag} (새로 정했습니다 → {config_path.relative_to(REPO_ROOT)})")
        base_url = read_release_base_url(SHOWS_DIR / asset_slug)

    # 로컬 미리보기: mp3 를 docs 로 복사하고 상대경로를 쓴다. 공개용이 아니므로 payload 에
    # preview 표시를 남기고, 페이지가 그것을 화면에 띄운다 (실수로 배포해도 바로 보인다).
    local_copy = None
    if args.local_audio:
        if not audio_path:
            sys.exit("--local-audio 를 줬지만 폴더에 mp3 가 없습니다.")
        local_copy = SHOWS_DIR / show_id / asset_name
        base_url = None

    # 길이를 모르는 입력(CSV)이면 mp3 에서 실제 길이를 읽는다
    if audio_path and not precise:
        probed = probe_duration(audio_path)
        last = max((s["end"] for s in script["sentences"]), default=0)
        if probed and probed > (script.get("durationSec") or 0):
            script["durationSec"] = probed
            script["recordedSec"] = last
            print(f"길이      mp3 에서 읽음: {probed:.0f}초 (마지막 자막 {last:.0f}초)")
        elif not probed:
            print("길이      ffprobe 가 없어 마지막 자막 시각을 길이로 씁니다 (실제보다 짧을 수 있음)")

    groups = group_scenes(script["sentences"], args.scene_gap)
    # Release 주소가 없으면 오디오를 아예 싣지 않는다. 상대경로를 박으면 docs 에 없는 mp3 를
    # 가리키게 되어, 배포된 뒤에야 재생 실패로 드러난다 — 스크립트만 올리고 소리는 나중에 붙인다.
    if base_url or local_copy:
        audio_meta = build_audio_meta(script, asset_name, base_url, audio_path)
        if local_copy:
            audio_meta["file"] = f"{AUDIO_URL_PREFIX}/{show_id}/{asset_name}"
            audio_meta["preview"] = True
    else:
        audio_meta = None
    episode = build_episode(script, groups, audio_meta, movie=args.movie)

    sentences = script["sentences"]
    with_ko = sum(1 for s in sentences if s.get("ko"))
    silent = sum(1 for s in sentences if (s.get("recorded") or 0) < 0.5)
    duration = script.get("durationSec") or 0
    minutes, seconds = divmod(int(duration), 60)

    print(f"작품      {args.title or script.get('title')}  (id: {show_id})")
    print(f"{'영화      ' if args.movie else '회차      '}"
          + (f"{episode['title']} · {episode_id}" if args.movie else f"시즌 {season} {number}화 · {episode_id}"))
    print(f"문장      {len(sentences)}개 · 장면 {len(groups)}개 · 한국어 {with_ko}개 · 소리 없음 {silent}개")
    print(f"길이      {minutes}:{seconds:02d}")
    print(f"입력      {script_path.name}")
    if not precise:
        print(
            "\n  ! 시간이 초 단위로 반올림된 값입니다 (CSV 의 사람용 시간 열).\n"
            "    문장 강조·클릭 재생이 최대 0.5초 밀립니다. lang-study 에서\n"
            "    '스크립트 JSON' 을 내려받아 다시 실행하면 정확해집니다."
        )
    if audio_meta:
        print(f"음원      {audio_meta['file']}")
        print(f"          녹음된 비율 {audio_meta['coverage'] * 100:.0f}%")
        if audio_meta.get("preview"):
            print("          로컬 미리보기입니다. 이 상태로 커밋하면 배포된 페이지에서 소리가 나지 않습니다")
    else:
        print("음원      싣지 않음 — Release 기준 URL이 없습니다 (스크립트만 올립니다)")
        print("          docs 에 없는 mp3 를 가리키는 상대경로를 박으면 배포 뒤에 재생 실패로 드러납니다.")
        print("          Release 를 만든 뒤 --audio-base-url 로 다시 실행하면 소리가 붙습니다.")

    if args.dry_run:
        print("\n(-n 이라 아무것도 쓰지 않았습니다)")
        return

    if local_copy:
        local_copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(audio_path, local_copy)
        print(f"\n→ {local_copy.relative_to(REPO_ROOT)} ({local_copy.stat().st_size / 1e6:.0f}MB, 커밋되지 않음)")

    # 타임라인 폴더는 ASCII 로 둔다 (git·zip·경로가 단순해진다). 주소 id 는 manifest 안에 적는다.
    manifest_path = write_manifest(asset_slug, episode_id, script, episode, script_path,
                                   asset_name, audio_path, show_id)

    payload = read_payload()
    show = next((s for s in payload.get("shows") or [] if s.get("id") == show_id), None)
    now = TYPE_MOVIE if args.movie else TYPE_SERIES
    if show is None:
        show = {"id": show_id, "kind": "recording", "lang": "en", "type": now, "seasons": []}
    else:
        # 영화를 시리즈로(또는 반대로) 바꾸면 예전 회차가 섞인다. 바뀌면 비우고 다시 담는다.
        was = show.get("type") or TYPE_SERIES
        if was != now:
            print(f"  ! 작품 종류가 {was} → {now} 로 바뀝니다. 이전 회차 목록을 비웁니다.")
            show["seasons"] = []
    show["title"] = args.title or script.get("title") or show_id
    if args.title_en:
        show["titleKo"] = args.title_en
    show["kind"] = "recording"
    show["type"] = TYPE_MOVIE if args.movie else TYPE_SERIES
    show["hasKo"] = True
    show["generated"] = _dt.date.today().isoformat()
    upsert_season(show, season, episode, args.planned)
    upsert_show(payload, show)
    remember_show(script.get("title"), show_id, asset_slug, title_en)
    payload["generated"] = _dt.date.today().isoformat()
    write_payload(payload)

    print(f"\n→ {manifest_path.relative_to(REPO_ROOT)}")
    print(f"→ docs/tvshow.html 의 '{show['title']}' 작품 갱신")

    if args.publish:
        # E2E: 음원 업로드 → 주소 교체 → Range 확인 → (--push 면) 커밋·푸시.
        # publish_shows.py 를 따로 호출한다. 한 파일에 몰아넣으면 "대본만 넣기" 와
        # "공개하기" 가 섞여, 공개를 원하지 않을 때 실수로 올라갈 길이 생긴다.
        cmd = [sys.executable, str(Path(__file__).resolve().parent / "publish_shows.py"),
               "--show-id", asset_slug, "--episode", episode_id, "--yes"]
        if args.push:
            cmd.append("--push")
        if args.audio:
            cmd += ["--audio", str(audio_path)]
        print("\n" + "─" * 60)
        done = subprocess.run(cmd, cwd=str(REPO_ROOT))
        if done.returncode != 0:
            sys.exit(f"\n음원 공개가 실패했습니다 (대본은 이미 반영돼 있습니다). 종료 코드 {done.returncode}")
        return

    if local_copy:
        print(
            "\n로컬에서 들어 보세요:\n"
            "  cd docs && python3 -m http.server 8788 --bind 127.0.0.1\n"
            f"  http://localhost:8788/tvshow.html#{show_id}/{episode_id}\n"
            "\n배포할 때는 mp3 를 Release 로 올리고 --audio-base-url 로 다시 실행하세요."
        )
    elif audio_path:
        print("\n음원은 이 저장소에 두지 않습니다 (Pages 사이트 상한 1GB). Release 자산으로 올리세요:")
        tag = (base_url or "").rstrip("/").rsplit("/", 1)[-1] or "<태그>"
        print(f'  cp "{audio_path}" /tmp/{asset_name}'.replace(str(Path.home()), "~"))
        print(f"  gh release create {tag} --title {tag} --notes '' || true")
        print(f"  gh release upload {tag} /tmp/{asset_name} --clobber")
        if not base_url:
            print(
                "\n그다음 기준 URL 을 주고 다시 실행하면 소리가 붙습니다:\n"
                f"  python3 scripts/build_langstudy.py <폴더> --show-id {show_id} "
                f"--season {season} --episode {number} \\\n"
                "      --audio-base-url https://github.com/magpie1st/MacsALogs/releases/download/"
                f"{tag}\n"
                f"  (또는 docs/audio/shows/{show_id}/config.json 에 audioBaseUrl 을 두면 생략됩니다.)"
            )


if __name__ == "__main__":
    main()
