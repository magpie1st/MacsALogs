# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

MacsALogs는 AI 개발·생산성·취미를 기록하는 개인 블로그입니다.  
빌드 도구 없이 순수 HTML/CSS/JS로 작성되며 GitHub Pages(`docs/` 폴더)로 서빙됩니다.

## 핵심 파일 위치

- `docs/posts/posts.json` — 포스트 목록 (최신순, 메타데이터만)
- `docs/posts/*.html` — 개별 포스트 HTML
- `docs/css/style.css` — 전체 스타일 (CSS 변수로 테마 관리)
- `docs/js/app.js` — 메인 페이지 포스트 목록 로딩
- `WORKLOG.md` — 내부 작업 일지 (블로그 노출 없음)
- `docs/opic.html` — OPIc 음원 페이지 (포스트 아님. 내비게이션에도 없고 URL로만 접근)

## 새 포스트 추가 절차

1. `docs/posts/YYYY-MM-DD-slug.html` 생성 — 기존 포스트 HTML 구조 복사 후 내용 교체
2. `docs/posts/posts.json` 배열 **최상단**에 메타데이터 항목 삽입
3. `docs/index.html`의 `<script id="posts-data" type="application/json">` 배열 **최상단**에도 동일 항목 삽입
4. 세 파일의 `slug` 값이 일치해야 함

> `index.html`에 인라인 데이터가 있는 이유: GitHub Pages(Samsung GHE)에서 `fetch()`가 차단될 수 있어
> `fetch()` 없이 DOM에서 직접 JSON을 읽도록 설계되었음.

## OPIc 음원 페이지

`docs/opic.html`의 `<!-- OPIC-DATA:START -->` ~ `END` 사이 JSON은 **자동 생성 영역이다.
손으로 고치지 말 것.** 음원 추가·갱신은 `tts-maker` 저장소에서 실행한다.

```bash
cd /home/magpie/Workspace/dev/macGitHub/tts-maker
uv run tts-maker <스크립트.md>                    # mp3 생성
uv run python scripts/publish_blog.py             # 음원 복사 + opic.html 갱신
```

그 뒤 이 저장소에서 커밋·푸시하면 반영된다.

## TVShow 스크립트 페이지

`docs/tvshow.html`도 포스트가 아닌 독립형 페이지다(내비게이션에 없고 URL로만 접근).
`<!-- TVSHOW-DATA:START -->` ~ `END` 사이 JSON은 **자동 생성 영역이다. 손으로 고치지 말 것.**

한 페이지에 **드라마와 영화**가 같이 있다. 드라마는 작품 → 시즌 → 화로 나뉘고, 영화는
회차가 하나뿐이라(`feature`) 시즌·회차 선택과 회차 이동이 숨는다 (`show.type`이 `series`/`movie`).
작품 선택 목록은 `시리즈`/`영화` 묶음으로 나뉘고, 영화 주소는 `#<작품 id>` 하나다.

음원 출처로도 작품이 두 종류 섞여 있다.

| kind | 무엇 | 원본 | 생성기 |
|------|------|------|--------|
| `tts` | 기계 합성 낭독 | `book-maker/output/<NN>/episode_<NN>.md` | `scripts/build_tvshow.py` |
| `recording` | 실제 방송 녹음 (영어+한국어 자막) | `~/Downloads/lang-study/<회차>/` | `scripts/build_langstudy.py` |

**두 생성기는 블록을 통째로 덮어쓰지 않고 자기 작품만 갈아 끼운다.** 서로 다른 머신에서
돌기 때문이다 — TTS 쪽은 `book-maker` 원본이 있는 머신에서만 돈다. 공통 로직(블록 읽기·쓰기,
예전 형식 옮기기, 공개 문자열 검사)은 `scripts/shows.py` 한곳에 있고,
`python3 scripts/test_shows.py`로 검사한다(의존성 없음).

예전 형식(작품 하나, 시즌 개념 없음)은 읽는 즉시 새 형식으로 옮긴다. 원본 Markdown 없이도
옮길 수 있도록 **HTML에 이미 들어 있는 episodes를 그대로** 쓴다.

### TTS 시리즈 (book-maker + tts-maker)

원본은 `book-maker` 저장소의 `output/<NN>/episode_<NN>.md`이며, 이 저장소의 생성기가 읽어서
JSON 블록의 그 작품만 교체한다(원본은 읽기 전용).

```bash
python3 scripts/build_tvshow.py            # 원본 전체 반영
python3 scripts/build_tvshow.py --scenes 6 # 앞 6개 장면만 (발췌본)
python3 scripts/build_tvshow.py --no-audio # 오디오 타임라인 무시하고 스크립트만
```

에피소드 추가는 `book-maker/output/`에 `episode_02.md` … 를 만든 뒤 위 명령을 다시 실행하면 된다.
JSON에 없는 회차는 선택 목록에 `준비 중`으로 표시된다.

### lang-study 녹음 작품 (실제 방송 음성 + 한국어 자막)

lang-study 크롬 확장이 Netflix·쿠팡플레이를 보면서 녹음한 회차를 올린다. 입력은 사이드 패널
**에피소드** 탭에서 내려받은 두 파일이고, 같은 폴더에 있다.

```
~/Downloads/lang-study/<작품> 시즌 5 1화/
  <...> 스크립트.json     ← '스크립트 JSON' 버튼 (문장·소수점 초·영어·한국어)
  <...> 전체.mp3          ← '전체 MP3' 버튼 (파일 시간 = 영상 시간)
```

```bash
python3 scripts/build_langstudy.py -n "~/Downloads/lang-study/<폴더>" --show-id emily-in-paris
python3 scripts/build_langstudy.py "~/Downloads/lang-study/<폴더>" \
    --show-id emily-in-paris --title "에밀리, 파리에 가다" --season 5 --episode 1 --planned 10
```

- `--show-id`는 주소 해시(`#emily-in-paris/s05e01`)에 들어가므로 **영문**이어야 한다.
  한글 제목만 있으면 생성기가 중단하며 요구한다.
- **스크립트 JSON이 있어야 한다.** 없으면 `sentences.csv`로 떨어지는데, CSV의 시간 열은
  초 단위로 반올림된 값이라 문장 하이라이트가 최대 0.5초 밀린다. 생성기가 경고를 띄운다.
- `docs/audio/shows/<작품 id>/config.json`의 `audioBaseUrl`이 없으면 **오디오를 아예 싣지 않고
  대본만 넣는다.** docs에 없는 mp3를 가리키는 상대경로를 박으면 배포 뒤에야 재생 실패로
  드러나기 때문이다.
- **영화는 자동 판별한다.** 스크립트 JSON에 시즌·회차가 둘 다 없으면 영화로 넣는다
  (Netflix 영화가 그렇게 온다). `--movie`/`--series`로 강제할 수 있다.
- **작품 id는 사람의 입력 없이 정해진다.** 우선순위는 영문 제목 → 제목 그대로.
  - 제목이 영문이면(넷플릭스 UI가 영어이거나 `--title-en`을 주면) 주소·파일 이름이 모두 영문
    (`#breaking-bad`, `breaking-bad-s01e02.mp3`)
  - 한글 제목만 있으면 주소에 **한글을 그대로** 쓰고(`#투-브로크-걸즈`) mp3 자산 이름만
    로마자로 만든다(`tu-beurokeu-geoljeu-s02e05.mp3`) — Release 자산 이름은 ASCII여야 한다
  - **넷플릭스·쿠팡플레이는 영문 제목을 페이지에 두지 않는다.** 제목은 DOM에서 읽고 UI 언어로
    지역화돼 있다. 넷플릭스는 UI 언어를 영어로 바꾸면 해결된다(자막은 언어 코드로 고르므로
    한국어 자막은 그대로). 쿠팡플레이는 UI가 한국어뿐이라 `--title-en`을 쓴다
  - 셋 다 `scripts/show_ids.json`에 기억하고 **한 번 적은 값은 바꾸지 않는다** (주소가 움직이면
    북마크가 깨진다). 바꾸려면 `--remove-show` 후 다시 넣는다
  - 타임라인 폴더(`docs/audio/shows/<여기>`)는 자산 슬러그를 쓴다 — 경로는 ASCII로 둔다
  - 다른 제목이 같은 id를 쓰려 하면 번호를 붙인다 (두 작품의 회차가 섞이면 눈에 안 띈다)
- `--publish --push`를 붙이면 대본 반영 → 음원 업로드 → 주소 교체 → Range 확인 → 커밋·푸시까지
  한 번에 간다 (`publish_shows.py`를 호출한다).
- `--remove-show ID`로 작품을 페이지·타임라인에서 지운다 (Release 자산은 남는다).
- 상세 절차와 판단 기준은 `.claude/skills/script-reader/SKILL.md`에 있다. 시즌을 통째로
  올릴 때는 `script-reader-builder` 에이전트를 쓴다.

`docs/audio/shows/`에도 **mp3를 두지 않는다.** TTS 쪽과 같은 이유다 (아래 참조).
로컬에서 소리까지 들어 보려면 `--local-audio` 로 빌드한다 — mp3를 `docs/audio/shows/`로
복사하고 상대경로를 쓰며, 그 경로는 `.gitignore`에 있어 커밋되지 않는다. 그 빌드에는
`preview: true`가 붙고 페이지에 "로컬 미리보기 음원입니다" 경고가 뜬다.

### 내려받기 감시 (`watch_langstudy.py`)

`/Users/mac/Downloads/lang-study` 를 지켜보다가 새 회차 폴더가 들어오면 알아서 올린다.

```bash
python3 scripts/watch_langstudy.py -n --once   # 무엇을 하려는지만
python3 scripts/watch_langstudy.py             # 계속 지켜본다 (Ctrl+C)
```

폴더마다 ① 다 내려왔는지(크기가 20초간 그대로) ② `문장별.zip` 풀기 ③ ffprobe 로 소리 확인
④ 작품 id 확인 ⑤ `build_langstudy.py --publish --push` 순이다.
처리한 폴더는 `scripts/.watch_state.json`(gitignore)에 적어 다시 하지 않는다.

**기본이 공개 배포다.** 대본만 넣으려면 `--build-only`, 푸시만 막으려면 `--no-push`.
처음 보는 한글 제목 작품은 **건너뛰고 알린다** — 영문 id 는 사람이 한 번 정해야 한다.

### 음원 공개 (`publish_shows.py`)

```bash
python3 scripts/publish_shows.py --show-id emily-in-paris -n          # 계획만
python3 scripts/publish_shows.py --show-id emily-in-paris --yes --push  # 올리고 푸시
```

Release 태그 생성 → 자산 업로드(`--clobber`) → `config.json` 갱신 →
`tvshow.html` 의 주소를 Release 로 돌림(`preview` 제거, **세그먼트는 손대지 않음**) →
Range 206 확인 → `--push` 면 커밋·푸시.

**이 저장소는 공개다.** 터미널에서는 물어보고, 자동 실행에서는 `--yes` 가 없으면 중단한다.
한 번 올라간 음원은 Release 에서 지워도 내려받아 간 것을 되돌릴 수 없다.

### 로컬 미리보기 서버

**`python3 -m http.server`를 쓰지 말 것.** Range 요청에 206 대신 200을 돌려주고, Chrome은
그 미디어를 seek 불가로 판단한다(`audio.seekable`이 `[0,0]`). 그러면 문장 클릭·문장 이동·
±10초가 전부 먹지 않는데 증상은 플레이어 버그처럼 보인다.

```bash
python3 scripts/serve_docs.py        # http://localhost:8788, Range 206 지원
```

배포된 페이지에서는 문제가 없다 — Release 자산이 206을 돌려준다.

### 회차 오디오 (문장 동기화 플레이어)

현재 **20편 전편에 오디오가 있다** (Kokoro `af_heart` / speed 1.0 / 24kHz mono / 64k).

`docs/audio/tvshow/`의 내용물은 **`tts-maker`가 만든 생성물이다. 손으로 고치지 말 것.**

| 파일 | 무엇 |
|------|------|
| `episode-NN.json` (20개) | 문장별 start/end 타임라인. 문장 강조·클릭 seek이 전부 여기에 의존한다 |
| `config.json` | `audioBaseUrl` — 음원이 올라가 있는 Release 태그의 기준 URL |

**mp3는 이 저장소에 두지 않는다. 손으로 복사해 넣지 말 것.**
GitHub Pages가 서빙하는 사이트 상한이 1GB인데 20편이 448MB다. 커밋하면 git 이력에
영구히 쌓여 되돌릴 수 없다. 음원은 Release 자산으로 올리고 Pages에는 JSON만 둔다.

- 현재 Release: `tvshow-audio-2026-09-15-v1` (asset 20개)
- 재생 URL: `https://github.com/magpie1st/MacsALogs/releases/download/tvshow-audio-2026-09-15-v1/episode-NN.mp3`
- Release 자산도 Range 요청(206)을 지원하므로 문장 단위 seek이 그대로 동작한다.

```bash
cd /home/magpie/Workspace/dev/macGitHub/tts-maker

# 생성 (이미 만들어진 회차는 설정이 같으면 건너뛴다)
uv run tts-maker-tvshow -n --episode 1                    # 계획만 확인
uv run tts-maker-tvshow --episode {1..20} --bitrate 64k   # 전편 생성

# 배포 — 반드시 -n 으로 먼저 확인한다
uv run python scripts/publish_tvshow.py -n \
    --episode {1..20} --manifests-only \
    --audio-base-url https://github.com/magpie1st/MacsALogs/releases/download/tvshow-audio-2026-09-15-v1

# 위 명령에서 -n 만 빼면 실제 반영 (JSON 20개 + config.json 복사, docs의 mp3 제거,
# build_tvshow.py 실행까지)
```

`publish_tvshow.py`가 이 저장소의 `scripts/build_tvshow.py`까지 실행한다.
`build_tvshow.py`는 `config.json`이 있으면 오디오 `file`을 절대 https Release URL로 만들고
로컬 mp3를 요구하지 않는다. 없으면 예전처럼 상대경로 + 로컬 mp3를 요구한다.

manifest가 원본 대본과 어긋나면 **배포가 중단된다** — 문장 강조가 밀린 페이지를
올리는 것보다 올리지 않는 편이 낫다.

**업로드와 푸시는 자동화되어 있지 않다.** `publish_tvshow.py`는 파일만 준비하고 쓸 수 있는
`gh release create …` 명령을 출력할 뿐이다. 릴리스 업로드도, 커밋·푸시(원격 `github`)도
사람이 직접 한다.

### tvshow.html 페이지 UI

작품·시즌·회차를 셀렉트로 고른다. 작품이 하나뿐이면 작품 칸이, 시즌이 하나이고 그 번호가 1이면
시즌 칸이 숨는다 — "시즌 5 1화"처럼 **번호 자체가 정보인 경우에는 하나여도 보여 준다.**
주소 해시는 `#<작품 id>/<회차 id>`이고, 예전 주소(`#ep01`)로 들어오면 모든 작품을 훑어 찾는다.

녹음 작품에서만 **한국어** 토글이 나타난다(`K`). 영어 줄 바로 아래에 한국어 자막을 깔고,
녹음이 빈 문장은 흐리게 보여 준다 — 대본에서 빼면 읽을 때 흐름이 끊기기 때문이다.
본문 검색은 영어만 걸린다.

에피소드 전환 수단이 둘이다. 셀렉트와 `이전 에피소드` / `다음 에피소드` 버튼이며 서로 동기화된다
(hash 갱신, 재생 정지, `<audio src>` 교체, 검색 초기화, 상단 이동). 첫 회차에서 이전이,
마지막 회차에서 다음이 잠긴다(그 시즌 안에서만 움직인다). 키보드 `[` / `]` 로도 넘길 수 있다.

하단 플레이어의 `◀◀ 문장` / `문장 ▶▶`와는 **다른 것이다.** 라벨·위치·스타일을 일부러 다르게
뒀으니, 손댈 때 둘을 닮게 만들지 말 것.

## MOM(회의록) 페이지

`docs/mom.html`(목록)과 `docs/mom/<id>.html`(회의별 대본)도 내비게이션에 없는 독립형 페이지다.
원본은 `voice-in-scribe` 저장소의 `output/*_대본.json` · `_대본.html`(대본형 회의록)이고 읽기 전용이다.

**이 저장소는 공개이고 커밋은 자동 푸시된다(hermes `MacsALogs hourly auto-push monitor`).**
회의록은 **평문으로 공개**한다(2026-10-25 사용자 결정 — 처음엔 암호화해 올렸다가 풀었다).
인명 · 인원 협상 · 파트너 일정이 담긴 회의라, 새 회의를 실을 때마다 공개해도 되는지 사용자에게 확인한다.

- `docs/mom.html` 의 `<!-- MOM-DATA:START -->` ~ `END` 는 목록 JSON 이고, `docs/mom/<id>.html` 은 대본 HTML 그대로다.
  **둘 다 자동 생성물이다. 손으로 고치지 말 것**
- `--encrypt` 를 주면 예전처럼 암호로 잠근다(PBKDF2-SHA256 60만 회 → AES-256-GCM, 복호화는 `docs/js/mom.js`).
  암호는 `~/.config/macsalogs/mom_password`(또는 `MOM_PASSWORD`)이고 저장소에 두지 않는다
- `<id>` 는 그 암호 파일을 키로 한 HMAC 이다. **암호 파일을 바꾸면 id 가 바뀌어** 녹음 Release 를 다시 올려야 한다
- 녹음은 Release `mom-audio-v1` 자산이다(`<id>.m4a`, 암호화 없음). mp3 와 마찬가지로 저장소에 넣지 않는다

```bash
python3 scripts/build_mom.py -n   # 실을 회의 확인 (voice-in-scribe/output/*_대본.json 전부)
python3 scripts/build_mom.py      # 생성 + .mom-audio/ 에 녹음 준비 + 업로드 명령 출력
python3 scripts/build_mom.py --encrypt   # 암호로 잠가 생성
```

대본을 고쳤으면 voice-in-scribe 에서 `dialogue.py build` 를 먼저 돌린다. html 이 json 보다 오래되면 경고가 뜬다.
새 대본이 생기면 자동으로 목록에 들어가니, 싣지 않을 회의가 있으면 생성 전에 확인한다.

## 영어 복습 페이지

`docs/english.html`은 내비게이션 **"영어"** 메뉴로 연결되는 페이지다(`noindex`). 한 페이지 10카드, 한글만 보기·★ 헷갈림·섞기·🔊를 쓴다.
`macSndBrain`의 `concepts/english-expression-notebook.md`(5열)와 `concepts/english-vocabulary-notebook.md`(6열)가 원본이고
읽기 전용이다. **`docs/english.html` 전체가 자동 생성물이다. 손으로 고치지 말 것.**

```bash
cd /home/magpie/Workspace/dev/macGitHub/macSndBrain
python3 scripts/build_english_page.py --blog   # → ../MacsALogs/docs/english.html
```

- 노트를 고쳤으면 위 명령을 다시 돌린 뒤 이 저장소에서 커밋한다. 노트 표 열 개수가 어긋나면 생성이 에러로 멈춘다.
- **이 저장소는 공개이고 노트 전체가 평문으로 올라간다**(2026-10-26 사용자 결정). 회의에서 온 표현·예문(상대 발언·실명 포함)도 포함된다.
  새 회의 출처 행이 노트에 늘면 공개해도 되는지 사용자에게 다시 확인한다.
- 학습 상태(★·마지막 위치)는 브라우저 `localStorage`에만 저장되며 서버로 가지 않는다.
- 새 정적 페이지를 만들면 내비게이션 `<a href="english.html">영어</a>` 줄처럼 `소개` 앞에 메뉴를 넣는다.
  `ai-news` 자동 생성 포스트(i18n 헤더)에는 이 메뉴가 없다.

## 스타일 규칙

- 색상·여백 변경은 `style.css`의 `:root` 변수 값만 수정
- 새 컴포넌트 추가 시 기존 BEM-유사 클래스 패턴 유지 (`.post-card`, `.post-card-title` 등)
- 다크모드는 `@media (prefers-color-scheme: dark)` 블록에서만 변수 재정의

## 커밋 규칙

```
[YYYY-MM-DD] 작업 요약
예: [2026-06-28] AI 코딩 팁 포스트 추가
```
