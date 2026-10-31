# SPEC.md

MacsALogs의 기술 구조와 기능 명세입니다. 변경 시 해당 섹션을 직접 수정하고 git으로 이력을 관리합니다.

---

## 아키텍처 개요

빌드 도구 없는 **순수 정적 HTML 블로그**입니다. GitHub Pages가 `docs/` 폴더를 그대로 서빙합니다.

```
브라우저 → GitHub Pages → docs/index.html
                              └─ fetch(posts/posts.json) → 포스트 카드 렌더링
                              └─ posts/*.html → 개별 포스트 페이지
```

## 파일별 역할

| 파일 | 역할 |
|------|------|
| `docs/index.html` | 블로그 메인 — `posts.json`을 fetch해 포스트 목록 렌더링 |
| `docs/about.html` | 소개 페이지 (정적 HTML) |
| `docs/css/style.css` | 전체 스타일. 라이트/다크모드 CSS 변수로 관리 |
| `docs/js/app.js` | `posts.json` fetch → 포스트 카드 DOM 삽입 |
| `docs/posts/posts.json` | 포스트 메타데이터 목록 (수동 관리, 최신순) |
| `docs/posts/*.html` | 개별 포스트 HTML |
| `docs/opic.html` | OPIc 음원 페이지 (포스트가 아닌 독립 페이지) |
| `docs/js/opic.js` | 오픽 재생목록 렌더링 + 하단 고정 플레이어 |
| `docs/audio/opic/<주제>/*.mp3` | OPIc 스토리 음원 |
| `docs/tvshow.html` | TV쇼·영화 스크립트 리더 (독립 페이지). 인라인 JSON + 문장 동기화 플레이어 |
| `docs/js/tvshow.js` | 작품·시즌·회차 전환, 본문 렌더링, 문장 강조·클릭 seek, 한국어 토글, 검색 |
| `docs/audio/tvshow/episode-NN.json` | TTS 시리즈의 문장 타임라인 (tts-maker 생성물) |
| `docs/audio/shows/<자산 슬러그>/` | 녹음 작품의 타임라인(`sNNeNN.json`·`feature.json`)과 `config.json` |
| `docs/english.html`, `docs/mom.html`, `docs/mom/` | 영어 복습·회의록 (독립 페이지) |
| `scripts/shows.py` | `tvshow.html` JSON 블록 읽기·쓰기, 예전 형식 옮기기, 공개 문자열 검사 |
| `scripts/build_tvshow.py` | TTS 시리즈 생성기 (`book-maker` 원본 → JSON 블록) |
| `scripts/build_langstudy.py` | 녹음 작품 생성기 (lang-study 내보내기 → 타임라인 + JSON 블록) |
| `scripts/publish_shows.py` | 녹음 음원을 Release에 올리고 주소를 돌림, Range 206 확인, 커밋·푸시 |
| `scripts/watch_langstudy.py` | `~/Downloads/lang-study` 감시 → zip 풀기·소리 확인 → 위 둘 실행 |
| `scripts/serve_docs.py` | 로컬 미리보기 서버 (**Range 206 지원** — `http.server`로는 문장 seek이 안 된다) |
| `scripts/test_shows.py` | 위 스크립트들의 자체 검사 (의존성 없음, `python3`만) |
| `scripts/show_ids.json` | 작품 제목 → 주소 id·자산 슬러그·영문 제목 (한 번 적으면 바꾸지 않는다) |

## posts.json 스키마

```jsonc
[
  {
    "slug": "YYYY-MM-DD-영문-제목",   // HTML 파일명과 일치해야 함
    "title": "포스트 제목",
    "date": "YYYY-MM-DD",
    "excerpt": "목록에 표시될 한두 줄 요약",
    "tags": ["태그1", "태그2"],       // 선택
    "readTime": "3분"                  // 선택
  }
]
```

## OPIc 음원 페이지 (`docs/opic.html`)

포스트가 아닌 **독립 페이지**입니다. 날짜순으로 흘러가면 안 되는 학습용 도구이므로
`posts.json`에 넣지 않습니다. 상단 내비게이션에도 노출하지 않으며 URL로 직접 접근합니다
(사용자 요청). 따라서 이 페이지는 블로그 어디에서도 링크되지 않습니다.

재생 모드는 두 가지이며 플레이어의 **반복 체크박스**로 전환합니다.

| 반복 | 동작 |
|------|------|
| 체크 | `audio.loop = true` — 지금 듣는 곡만 무한 반복 (`ended`가 발생하지 않음) |
| 해제 | 곡이 끝나면 다음 곡. 마지막 곡 뒤에는 첫 곡으로 돌아가 전체 목록이 순환 |

목록이 순환하므로 이전/다음 버튼도 양끝에서 반대편으로 넘어가며, 비활성화되지 않습니다.

- 재생목록 데이터는 페이지 안에 **인라인 JSON**으로 들어갑니다
  (`<!-- OPIC-DATA:START -->` ~ `END` 마커 사이, `id="opic-data"`).
  사내 GitHub Enterprise에서도 열리도록 `fetch()`에 의존하지 않는 기존 방침과 같습니다.
- 이 블록은 **손으로 고치지 않습니다.** `tts-maker` 저장소의
  `scripts/publish_blog.py`가 음원 복사와 함께 자동 생성합니다.
- 음원 생성 자체는 `tts-maker`(Kokoro TTS)가 담당하며, 이 저장소는 결과물만 서빙합니다.

### 데이터 스키마

```jsonc
{
  "generated": "YYYY-MM-DD",
  "voice": "af_heart",          // Kokoro 음성 이름
  "engine": "Kokoro-82M",
  "topics": [{
    "topic": "Overseas Trips",   // md의 H1
    "slug": "overseas-trips",
    "stories": [{
      "title": "...",            // md의 H2
      "index": 1,
      "audio": "audio/opic/overseas-trips/01-....mp3",
      "duration": 85.4,          // 초
      "bytes": 1366401,
      "paragraphs": ["...", "..."]   // 스크립트 본문 (접었다 펼치는 영역)
    }]
  }]
}
```

## TVShow 스크립트 페이지 (`docs/tvshow.html`)

포스트가 아닌 **독립 페이지**입니다(내비게이션에 없고 URL로만 접근). 한 페이지에
**드라마와 영화**가 같이 있고, 작품은 음원 출처로 두 종류가 섞여 있습니다.

| `kind` | 음원 | 원본 | 생성기 |
|---|---|---|---|
| `tts` | 기계 합성 낭독 | `book-maker/output/<NN>/episode_<NN>.md` | `build_tvshow.py` |
| `recording` | 실제 방송 녹음 (영어+한국어 자막) | lang-study 내보내기 | `build_langstudy.py` |

| `type` | 모양 |
|---|---|
| `series` | 작품 → 시즌 → 화. 주소 `#<작품 id>/<회차 id>` |
| `movie` | 회차 하나(`feature`)뿐. 시즌·회차 선택과 회차 이동을 숨김. 주소 `#<작품 id>` |

**생성기는 블록을 통째로 덮어쓰지 않고 자기 작품만 갈아 끼웁니다.** 둘이 서로 다른 머신에서
돌기 때문입니다 — TTS 쪽은 `book-maker` 원본이 있는 머신에서만 돕니다. 공통 로직은
`scripts/shows.py`에 있고 예전 형식(작품 하나, 시즌 없음)은 읽는 즉시 옮깁니다.
원본 Markdown 없이도 옮길 수 있도록 **HTML에 이미 있는 episodes를 그대로** 씁니다.

### 음원은 Release 자산으로만

GitHub Pages 사이트 상한이 1GB인데 한 회차가 16MB입니다. **mp3를 저장소에 두지 않습니다**
(`docs/audio/shows/**/*.mp3`는 `.gitignore`). `config.json`의 `audioBaseUrl`이 기준 주소이고,
`audio_href`가 **github.com의 Release 주소 모양만** 받습니다 — `config.json` 한 줄로 공개
페이지가 남의 서버에서 음원을 불러오는 일을 막습니다.

Release 자산은 **Range 요청(206)을 지원**하므로 문장 단위 seek이 그대로 됩니다.
로컬 미리보기는 `scripts/serve_docs.py`를 써야 합니다 — `python3 -m http.server`는 Range에
200을 돌려주고, 그러면 Chrome이 미디어를 seek 불가로 판단해(`audio.seekable`이 `[0,0]`)
문장 클릭·문장 이동·±10초가 **전부** 먹지 않습니다.

### 작품 id

주소 해시와 폴더 이름에 쓰는 값입니다. 사람의 입력 없이 정해집니다.

| 들어온 제목 | 주소 | mp3 자산 이름 |
|---|---|---|
| `Breaking Bad` (넷플릭스 UI가 영어) | `#breaking-bad` | `breaking-bad-s01e02.mp3` |
| `투 브로크 걸즈` + `--title-en` | `#2-broke-girls` | `2-broke-girls-s02e05.mp3` |
| `투 브로크 걸즈` (영문 제목 모름) | `#투-브로크-걸즈` | `tu-beurokeu-geoljeu-s02e05.mp3` |

ASCII가 꼭 필요한 곳은 **Release 자산 이름 하나**이므로 주소 id와 자산 슬러그를 나눕니다.
주소에는 한글을 써도 되고(브라우저가 퍼센트 인코딩으로 주고받습니다), 타임라인 폴더는
자산 슬러그를 써서 경로를 ASCII로 둡니다. 셋 다 `show_ids.json`에 기억하고 **한 번 적은 값은
바꾸지 않습니다** — 주소가 움직이면 북마크가 깨지고 예전 항목이 남습니다.

### 데이터 스키마

`<!-- TVSHOW-DATA:START -->` ~ `END` 사이, `id="tvshow-data"`. **자동 생성 영역입니다.**
`fetch()`에 의존하지 않는 기존 방침과 같습니다.

```jsonc
{
  "schema": "tvshow-data/2",
  "generated": "YYYY-MM-DD",
  "shows": [{
    "id": "emily-in-paris",     // 주소 해시에 들어간다
    "title": "에밀리, 파리에 가다",  // 화면에 보이는 제목
    "titleKo": "신사의 품격",      // 보조 제목 (없으면 null)
    "lang": "en",
    "type": "series",            // series | movie
    "kind": "recording",         // tts | recording
    "hasKo": true,               // 한국어 자막 토글(K)을 보일지
    "generated": "YYYY-MM-DD",
    "seasons": [{
      "number": 5,
      "plannedEpisodes": 10,     // 나머지는 선택 목록에 '준비 중'
      "episodes": [{
        "number": 1, "id": "s05e01",
        "title": "1화", "fullTitle": "에밀리, 파리에 가다 시즌 5 1화",
        "sceneCount": 33, "lineCount": 586, "wordCount": 3623,
        "scenes": [{ "n": 1, "lines": [
          { "kind": "dialogue", "text": "Mmm. Come back to bed.",
            "ko": "다시 침대로 와요",   // 녹음 작품만
            "silent": true }           // 녹음이 빈 문장 (흐리게 보여 준다)
        ]}],
        "audio": {
          "file": "https://github.com/.../releases/download/<태그>/<자산>.mp3",
          "durationSec": 2043.75, "segmentCount": 586,
          "coverage": 1.0,             // 녹음된 비율 (녹음 작품)
          "preview": true,             // --local-audio 빌드 표시 (페이지에 경고가 뜬다)
          // [장면, 줄, 문장, 시작ms, 끝ms, 문자시작, 문자끝]
          "segments": [[1, 1, 0, 25730, 28400, 0, 22]]
        }
      }]
    }]
  }]
}
```

세그먼트 행만 한 줄로 접어 직렬화합니다(`SEGMENT_PLACEHOLDER`). 인라인 JSON이 3MB를 넘는데
타임라인까지 들여쓰기로 펼치면 파일이 배로 커집니다. 자리표시자에는 **번호만** 씁니다 —
작품 id를 넣으면 한글 id에서 깨집니다 (본문은 `ensure_ascii=False`로 쓰는데 자리표시자를
찾는 `json.dumps`는 기본이 `True`라 한글이 `\uXXXX`로 escape됩니다).

### 공개 문자열 검사 두 겹

공개 HTML에 그대로 박히는 문자열이므로 쓰기 전에 두 번 걸러냅니다.

1. `escape_inline_json` — `<`, `>`, `&`, U+2028/2029를 JSON 이스케이프로. 본문이 자막에서
   왔으므로 `</script>`가 들어올 수 있고, 그러면 블록이 거기서 끝나고 뒤가 HTML로 읽힙니다
2. `assert_publishable` — 개인 머신 경로(`/Users/`, `/home/`)와 남은 이스케이프를 막고 중단

### 파이프라인

```
lang-study 확장 (Chrome)
  └ 에피소드 탭 → 전체 MP3 + 스크립트 JSON  →  ~/Downloads/lang-study/<작품> <회차>/
                                                    │
watch_langstudy.py (감시)                            │
  ① 다 내려왔는지(크기가 --stable 초 그대로)  ←───────┘
  ② *문장별*.zip 풀기 (zip slip 방어)
  ③ ffprobe로 소리 확인 (0바이트·1초 미만은 건너뜀)
  ④ build_langstudy.py --publish --push
       ├ docs/audio/shows/<자산 슬러그>/<회차>.json  (타임라인)
       ├ docs/tvshow.html 의 그 작품만 갈아 끼움
       └ publish_shows.py --yes --push
            ├ gh release upload (--clobber)
            ├ config.json 갱신 + 주소를 Release로 돌림
            ├ Range 206 확인
            └ 커밋·푸시
```

입력은 **전체 MP3 + (스크립트 JSON 또는 문장별 ZIP)** 입니다. ZIP 안에도 같은 `script.json`이
들어 있습니다(lang-study v0.9.0+). 둘 다 없으면 `sentences.csv`로 떨어지는데, CSV의 시간 열은
초 단위로 반올림된 값이라 문장 강조가 최대 0.5초 밀리고 녹음이 모자란 문장은 아예 빠집니다.

## 스타일 시스템

- CSS 변수(`--bg`, `--text`, `--accent` 등)로 라이트/다크 테마 관리
- `@media (prefers-color-scheme: dark)` 로 OS 설정 자동 감지
- 최대 너비 `760px`, 모바일 대응 완료

## GitHub Pages 설정

- Source: `main` 브랜치 / `docs/` 폴더
- 커스텀 도메인: 미설정 (기본 `magpie777.github.io/MacsALogs`)
- 빌드 프로세스: 없음 (파일 그대로 서빙)

## 포스트 작성 규칙

- 파일명: `docs/posts/YYYY-MM-DD-slug.html`
- slug: 영문 소문자 + 하이픈 (예: `ai-coding-tips`)
- `posts.json`에 항목 추가 시 배열 최상단(최신순)에 삽입
- 포스트 HTML은 기존 파일 구조를 복사해 내용만 교체

## 향후 확장 가능 사항

- 태그별 필터링 (JS 클라이언트 사이드)
- 검색 기능 (posts.json 기반)
- RSS 피드 (`feed.xml` 수동 생성)
- OG 메타태그 / SEO 개선

---

_최종 수정: 2026-08-31_
