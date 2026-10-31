---
name: script-reader
description: lang-study 로 녹음한 Netflix·쿠팡플레이 **드라마 회차나 영화**를 MacsALogs 의 스크립트 리더(docs/tvshow.html)에 올린다. 요청받으면 음원 업로드와 푸시까지 끝까지 간다. 영어 대본에 한국어 자막이 붙고, 문장을 누르면 그 지점부터 실제 방송 음성이 재생된다. 사용자가 "스크립트 리더 만들어줘", "대본 페이지 만들어줘", "이 회차 사이트에 올려줘", "에밀리 5시즌 1화 올려줘", "녹음한 거 웹으로 보게 해줘"처럼 요청하거나, ~/Downloads/lang-study 의 내보낸 폴더를 웹 페이지로 바꾸려 할 때 사용한다. 회차 추가·음질 교체·시즌 추가·배포 확인에도 사용한다.
---

# lang-study 녹음 → 스크립트 리더 페이지

## 무엇을 만드는가

`docs/tvshow.html` 한 페이지에 **드라마와 영화**가 같이 있다. 드라마는 작품 → 시즌 → 화로
나뉘고, 영화는 회차가 하나뿐이라(`feature`) 시즌·회차 선택과 회차 이동이 숨는다.
작품 선택 목록은 `시리즈` / `영화` 묶음으로 나뉘고, 영화 주소는 `#<작품 id>` 하나다.

회차(또는 영화)마다

- 영어 대본 (장면 단위로 끊어 읽기 좋게)
- 영어 줄 아래 한국어 자막 (`K` 로 켜고 끔)
- 문장을 누르면 그 지점부터 실제 방송 음성 재생 (문장 하이라이트가 따라감)
- 본문 검색, 글자 크기, 재생 속도, 따라가기

작품은 두 종류가 한 페이지에 같이 있다.

| kind | 무엇 | 생성기 |
|------|------|--------|
| `tts` | 기계 합성 낭독 (book-maker 대본 + tts-maker 음성) | `scripts/build_tvshow.py` |
| `recording` | 실제 방송 녹음 (lang-study 확장) | `scripts/build_langstudy.py` |

**두 생성기는 자기 작품만 갈아 끼운다.** 한쪽을 돌려도 다른 작품은 그대로 남는다
(서로 다른 머신에서 돌기 때문이다 — TTS 쪽은 `book-maker` 원본이 있는 머신에서만 돈다).

## 입력 두 가지

lang-study 사이드 패널 → **에피소드** 탭에서 내려받는다. 둘 다 같은 폴더에 들어간다.

```
~/Downloads/lang-study/<작품> 시즌 5 1화/
  <...> 스크립트.json     ← '스크립트 JSON' 버튼. 문장·소수점 초·영어·한국어
  <...> 전체.mp3          ← '전체 MP3' 버튼. 파일 시간 = 영상 시간
```

**문장별 ZIP 안에도 같은 `script.json` 이 들어 있다** (v0.9.0 부터). 그래서 받아야 하는 것은
**전체 MP3 + (스크립트 JSON 또는 문장별 ZIP)** 이다. 스크립트 JSON 쪽이 수십 KB 라 가볍다.

둘 다 없으면 `sentences.csv` 로 떨어지는데, CSV 의 시간 열은 초 단위로 반올림된 값이라
문장 하이라이트가 최대 0.5초 밀리고 **시즌·회차도 없어 영화로 오인된다.** 그 경우 생성기가
경고를 띄우니 **그냥 넘기지 말고 사용자에게 다시 내보내라고 말한다.**

## 끝까지 한 번에 (요청받았을 때 기본)

사용자가 "스크립트 리더 만들어줘", "이 회차 올려줘" 처럼 요청하면 **여기까지 전부 간다** —
대본 반영 → 음원 Release 업로드 → 주소 교체 → Range 확인 → 커밋·푸시.
(2026-10-31 사용자 결정: 요청 자체가 공개 배포 승인이다. 중간에 다시 묻지 않는다.)

```bash
cd /Users/mac/Documents/mac-codes/MacsALogs
python3 scripts/build_langstudy.py -n "<폴더>"                       # 1) 계획 확인
python3 scripts/build_langstudy.py "<폴더>" --publish --push         # 2) 끝까지
```

**사람이 넣어야 하는 값은 없다.** 작품 id 는 제목에서 만든다. 제목이 어느 언어로 들어오는지에
따라 결과가 이렇게 갈린다.

| 들어온 제목 | 주소 | mp3 자산 이름 | 화면 제목 |
|---|---|---|---|
| `Breaking Bad` (넷플릭스 UI 가 영어) | `#breaking-bad` | `breaking-bad-s01e02.mp3` | Breaking Bad |
| `투 브로크 걸즈` + `--title-en "2 Broke Girls"` | `#2-broke-girls` | `2-broke-girls-s02e05.mp3` | 투 브로크 걸즈 |
| `투 브로크 걸즈` (영문 제목 모름) | `#투-브로크-걸즈` | `tu-beurokeu-geoljeu-s02e05.mp3` | 투 브로크 걸즈 |

**넷플릭스·쿠팡플레이는 영문 제목을 페이지에 두지 않는다.** 제목은 DOM 에서 읽고
(`[data-uia="video-title"]` / `.title`) 그 값은 UI 언어로 지역화돼 있다. 영문으로 쓰려면
**넷플릭스 UI 언어를 영어로 바꾸는 것이 가장 깔끔하다** — 자막은 언어 코드(`en`/`ko`)로
고르므로 한국어 자막은 그대로 나온다 (`content.js` 의 `PRIMARY`/`SECONDARY`).
쿠팡플레이는 한국 서비스라 UI 를 영어로 바꿀 수 없다 → `--title-en` 을 쓴다.

**UI 언어를 바꾸면 같은 작품이 다른 제목으로 들어온다** (`에밀리, 파리에 가다` → `Emily in
Paris`). 레지스트리의 `titleEn`·`aliases` 로 찾으므로 갈라지지 않는다. 로그에
`같은 작품으로 봅니다: ... = ...` 가 찍히면 제대로 합쳐진 것이다.

`show_ids.json` 에 기억된 값은 **바뀌지 않는다.** 영문으로 바꾸려면 `--remove-show` 로 지우고
`--title-en` 과 함께 다시 넣는다 (주소가 바뀌면 예전 항목이 남는다).
**영문 제목은 처음 넣을 때 주는 것이 낫다.**

## 내려받기만 하면 알아서 올라가게 (watcher)

```bash
cd /Users/mac/Documents/mac-codes/MacsALogs
python3 scripts/watch_langstudy.py -n --once   # 계획만
python3 scripts/watch_langstudy.py             # 계속 지켜본다 (Ctrl+C 로 중지)
```

`/Users/mac/Downloads/lang-study` 에 새 폴더가 생기면 폴더마다 이 순서로 한다.

1. 다 내려왔는지 본다 (크기가 `--stable` 초 동안 그대로여야 손댄다 — 71MB zip 이 함께 온다)
2. `*문장별*.zip` 을 폴더 안에 푼다 (zip 안의 `script.json`·`sentences.csv` 를 쓴다)
3. ffprobe 로 소리를 확인한다 (0바이트·잘린 mp3 는 건너뛴다)
4. 작품 id 를 정할 수 있는지 본다 — `show_ids.json` 에 있거나 제목이 영문이어야 한다
5. `build_langstudy.py --publish --push`

제목은 스크립트 JSON 에서 읽고, 없으면 폴더 이름(`<작품> 시즌 5 1화`)에서 떼어 쓴다.

| 옵션 | 용도 |
|------|------|
| `-n` | 아무것도 쓰지 않고 계획만 |
| `--once` | 지금 있는 것만 처리하고 끝낸다 |
| `--build-only` | 대본만 넣는다 (음원 업로드·푸시 안 함) |
| `--no-push` | 음원은 올리되 커밋·푸시는 안 한다 |
| `--force` | 이미 처리한 폴더도 다시 |
| `--stable 0` | 안정화 대기 없이 바로 (이미 다 내려온 폴더) |

**사람이 끼어들 지점이 없다.** 작품 id 는 제목에서 만들고, 시즌·회차는 스크립트 JSON 이나
폴더 이름에서 읽고, 영화는 시즌·회차가 없는 것으로 알아본다.

## 절차 (하나씩 볼 때)

### 1. 무엇이 들어갈지 먼저 확인한다 (`-n`)

```bash
cd /Users/mac/Documents/mac-codes/MacsALogs
python3 scripts/build_langstudy.py -n "~/Downloads/lang-study/에밀리, 파리에 가다 시즌 5 1화" \
    --show-id emily-in-paris
```

문장 수·장면 수·한국어 수·길이·녹음된 비율이 나온다. 사용자에게 보여 주고 다음으로 간다.

- `--show-id` 는 거의 쓸 일이 없다. 주소를 영문으로 바꾸고 싶을 때만 한 번 준다.
- 스크립트 JSON 에 시즌·회차가 없으면(CSV 로 떨어진 경우) `--season 5 --episode 1` 을 준다.
  **생략하면 1/1 로 떨어져 다른 회차를 덮어쓴다** — 생성기가 막지만 직접 확인하는 편이 낫다.
- **영화는 자동으로 알아본다.** 스크립트 JSON 에 시즌·회차가 둘 다 없으면 영화로 넣는다
  (Netflix 영화가 그렇게 온다). 틀렸으면 `--series --season N --episode M`,
  반대로 강제하려면 `--movie`.

### 2. Release 기준 URL 을 정한다

mp3 는 이 저장소에 두지 않는다. `docs/audio/shows/<작품 id>/config.json` 에 기준 URL 이
있으면 그걸 쓰고, 없으면 `--audio-base-url` 로 준다.

```json
{
  "schema": "shows-audio-release/1",
  "generated": "2026-10-31",
  "audioBaseUrl": "https://github.com/magpie1st/MacsALogs/releases/download/shows-audio-2026-10-31-v1"
}
```

**기준 URL 이 없으면 생성기는 오디오를 아예 싣지 않고 대본만 넣는다.** 의도된 동작이다 —
docs 에 없는 mp3 를 가리키는 상대경로를 박으면 배포된 뒤에야 재생 실패로 드러난다.

### 3. 실제로 반영한다

```bash
python3 scripts/build_langstudy.py "~/Downloads/lang-study/에밀리, 파리에 가다 시즌 5 1화" \
    --show-id emily-in-paris --title "에밀리, 파리에 가다" --season 5 --episode 1 --planned 10
```

두 곳이 바뀐다.

- `docs/audio/shows/<작품 id>/sNNeNN.json` — 문장 타임라인 (다시 빌드할 때 쓴다)
- `docs/tvshow.html` 의 JSON 블록 — 그 작품만

### 4. 음원을 Release 에 올린다 — `publish_shows.py`

```bash
python3 scripts/publish_shows.py --show-id emily-in-paris -n        # 계획만
python3 scripts/publish_shows.py --show-id emily-in-paris           # 올린다 (물어본다)
python3 scripts/publish_shows.py --show-id emily-in-paris --yes --push   # 한 번에
```

한 번에 이걸 다 한다.

1. manifest 로 올릴 회차를 정하고, 내려받은 폴더에서 원본 mp3 를 찾는다
   (manifest 의 `audio.sourceName`. 없으면 `시즌 N M화` 폴더 이름으로 짐작한다)
2. Release 태그가 없으면 만들고 자산을 올린다 (`--clobber` 로 교체)
3. `config.json` 의 `audioBaseUrl` 을 그 태그로 맞춘다
4. `docs/tvshow.html` 의 그 회차 주소를 Release 로 돌리고 `preview` 표시를 지운다
   (**세그먼트는 손대지 않는다** — HTML 에 있는 것이 정답이다)
5. 올린 자산에 Range 요청을 보내 **206 인지** 확인한다 (200 이면 문장 seek 이 안 된다)
6. `--push` 면 커밋·푸시까지

**이 저장소는 공개다.** 올린 음원은 누구나 내려받을 수 있는 주소에 놓인다.
터미널에서는 물어보고, 자동 실행(에이전트 등)에서는 `--yes` 가 없으면 **중단한다.**

> `--yes` 를 **사용자가 공개를 요청했을 때만** 붙인다. "올려 줘", "웹에 올려 줘" 처럼
> 명확히 말했을 때다. 애매하면 `-n` 으로 계획을 보여 주고 물어본다 — 한 번 올라간 음원은
> Release 에서 지워도 내려받아 간 것을 되돌릴 수 없다.

### 5. 확인한다

```bash
python3 scripts/test_shows.py          # 생성기 자체 검사 (의존성 없음)
```

그리고 로컬에서 띄워 본다. `fetch()` 없이 DOM 에서 JSON 을 읽는 구조라 `file://` 로도 뜨지만,
IndexedDB·Range 요청 때문에 http 로 보는 편이 맞다.

```bash
python3 scripts/serve_docs.py        # Range 206 지원. http://localhost:8788
# http://localhost:8788/tvshow.html#emily-in-paris/s05e01
```

**`python3 -m http.server` 를 쓰지 않는다.** Range 를 지원하지 않아 Chrome 이 오디오를
seek 불가로 판단하고(`audio.seekable` 이 `[0,0]`), 문장 클릭·문장 이동·±10초가 전부
먹지 않는다 — 코드 문제처럼 보이지만 서버 탓이다. 실제로 한 번 여기서 헤맸다.

소리까지 들어 보려면 `--local-audio` 로 빌드한다 (mp3 를 gitignore 된 docs 폴더로 복사).

## 자주 쓰는 옵션

| 옵션 | 용도 |
|------|------|
| `-n` | 쓰지 않고 무엇이 바뀔지만 본다. **항상 먼저 돌린다** |
| `--show-id` | 작품 id (주소 해시용 영문). 한글 제목이면 필수 |
| `--title` | 화면에 보일 작품 제목 (한글 그대로 둬도 된다) |
| `--title-en` | 제목 아래 보조로 보일 영문 제목 |
| `--season` / `--episode` | 시즌·회차 번호. 스크립트 JSON 에 있으면 생략 |
| `--planned N` | 그 시즌 전체 회차 수. 나머지는 선택 목록에 '준비 중'으로 남는다 |
| `--scene-gap 4.0` | 문장 사이가 이만큼 벌어지면 장면을 끊는다 (초) |
| `--audio-base-url` | Release 기준 URL. config.json 이 있으면 생략 |
| `--script` / `--audio` | 폴더에 파일이 여러 개일 때 직접 지정 |
| `--local-audio` | mp3 를 gitignore 된 docs 폴더로 복사해 로컬에서만 듣는다 (배포용 아님) |
| `--movie` / `--series` | 영화·시리즈를 강제한다 (기본은 자동 판별) |
| `--publish` | 넣은 뒤 음원을 Release 에 올린다 (`publish_shows.py --yes` 호출) |
| `--push` | `--publish` 와 함께: 커밋·푸시까지 |
| `--remove-show ID` | 작품을 페이지와 타임라인에서 지운다 (Release 자산은 남는다) |

`publish_shows.py` 쪽 옵션:

| 옵션 | 용도 |
|------|------|
| `-n` | 올리지 않고 계획만 |
| `--episode sNNeNN` | 그 회차만 (여러 번 줄 수 있다). 생략하면 작품 전부 |
| `--tag` | Release 태그. 생략하면 config.json 에서 읽고, 없으면 오늘 날짜로 |
| `--from <폴더>` | 내려받기 폴더 (기본 `~/Downloads/lang-study`) |
| `--yes` | 확인 없이 올린다. **사용자가 공개를 요청했을 때만** |
| `--push` | 성공하면 커밋·푸시까지 |

## 판단이 필요한 지점

- **시즌을 여러 화 올려 달라는 요청**: 회차마다 한 번씩 돌린다. 회차가 5개를 넘으면
  로그가 길어지므로 `script-reader-builder` 에이전트에 넘긴다.
- **장면이 너무 잘게 끊긴다 / 너무 길다**: `--scene-gap` 을 조절한다. 장면 묶기는 읽기
  편하라고 두는 것이고 **재생 위치와 무관하다** (문장의 start·end 가 결정한다). 틀려도
  소리는 어긋나지 않으니 과하게 다듬지 않는다.
- **같은 회차를 다시 올려 달라는 요청**: 같은 `--season`/`--episode` 로 다시 돌리면
  덮어쓴다. 음원 파일 이름도 같으므로 `gh release upload --clobber` 로 교체한다.
- **작품 제목을 바꿔 달라는 요청**: `--title` 로 다시 돌린다. `--show-id` 를 바꾸면
  **주소가 바뀌고 예전 작품 항목이 남는다** — 바꿀 거면 예전 항목을 지워야 한다고 알린다.
- **음질을 올려 달라는 요청**: lang-study 쪽 일이다. 설정 → 녹음 → 음질을 올리고
  **다시 녹음**해야 한다 (에피소드마다 음질이 고정된다). 이미 녹음한 회차는 바뀌지 않는다.

## 확인할 수 있는 것과 없는 것

생성기와 `test_shows.py` 로 확인되는 것:

- 문장 수 = 줄 수 = 세그먼트 수 (하나도 사라지지 않았다)
- 예전 작품이 그대로 남아 있다
- 공개 JSON 에 개인 머신 경로나 `</script>` 가 없다
- 음원 주소가 GitHub Release 모양이다

**확인할 수 없는 것 — 사용자가 직접 들어야 한다:**

- **소리와 자막이 실제로 맞는지.** 타임라인은 lang-study 가 녹음할 때 영상 시간에 맞춰
  기록한 값이다. 녹음 중 이음매가 있었다면 그 근처가 밀린다. lang-study 의 **검증** 버튼으로
  이음매·빈틈을 먼저 확인하는 쪽이 낫다.
- **Release 자산이 실제로 올라가 재생되는지.** 올리기 전에는 404 다.
- 헤드리스 브라우저로는 **오디오 재생을 검증할 수 없다** (미디어 로딩이 막혀 `<audio>` 가
  멈춘다). 레이아웃·선택 목록·문장 버튼 수까지만 확인하고, 재생은 사용자가 눌러 봐야 한다고
  보고한다.

## 배포

`publish_shows.py --push` 가 음원 업로드와 함께 해 준다. 대본만 올릴 때는 직접 한다.

```bash
cd /Users/mac/Documents/mac-codes/MacsALogs
git add -A && git commit -m "[YYYY-MM-DD] <작품> 시즌 N M화 스크립트 리더 추가"
git remote -v               # Pages 를 서빙하는 원격을 먼저 확인한다
git push origin main        # 이 맥은 origin. 리눅스 쪽은 github 였다 (.gitignore 의 .git_linux 참고)
```

**푸시는 사용자가 요청했을 때만 한다.** 이 저장소는 공개이고 커밋은 자동 푸시된다
(hermes `MacsALogs hourly auto-push monitor`) — 올리면 되돌리기 어렵다.

배포 후 확인:

```bash
BASE=https://magpie1st.github.io/MacsALogs
curl -s "$BASE/tvshow.html" | grep -c '"shows"'
curl -sI -r 0-99 "https://github.com/magpie1st/MacsALogs/releases/download/<태그>/<자산>.mp3" | head -1
```

Pages 빌드에 1~2분 걸린다. `gh api repos/magpie1st/MacsALogs/pages/builds/latest --jq .status`.

## 주의

- `docs/tvshow.html` 의 `TVSHOW-DATA` 마커 사이는 자동 생성 영역이다. **손으로 고치지 않는다.**
- `docs/audio/shows/` 에 **mp3 를 복사해 넣지 않는다.** Pages 사이트 상한이 1GB 인데 한 회차가
  16MB 다. 커밋하면 git 이력에 영구히 쌓여 되돌릴 수 없다.
- 내려받은 폴더(`~/Downloads/lang-study/`)는 읽기만 한다.

## 작업 후

의미 있는 변경이 있었으면 `WORKLOG.md` 에 항목을 추가하고, 동작이나 옵션이 바뀌었으면
`CLAUDE.md` 의 'TVShow 스크립트 페이지' 절을 갱신한다.
