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

원본은 `book-maker` 저장소의 `output/<NN>/episode_<NN>.md`이며, 이 저장소의 생성기가 읽어서
JSON 블록만 교체한다(원본은 읽기 전용).

```bash
python3 scripts/build_tvshow.py            # 원본 전체 반영
python3 scripts/build_tvshow.py --scenes 6 # 앞 6개 장면만 (발췌본)
python3 scripts/build_tvshow.py --no-audio # 오디오 타임라인 무시하고 스크립트만
```

에피소드 추가는 `book-maker/output/`에 `episode_02.md` … 를 만든 뒤 위 명령을 다시 실행하면 된다.
JSON에 없는 회차는 선택 목록에 `준비 중`으로 표시된다.

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

에피소드 전환 수단이 둘이다. 셀렉트와 `이전 에피소드` / `다음 에피소드` 버튼이며 서로 동기화된다
(hash 갱신, 재생 정지, `<audio src>` 교체, 검색 초기화, 상단 이동). Episode 1에서 이전이,
Episode 20에서 다음이 잠긴다. 키보드 `[` / `]` 로도 넘길 수 있다.

하단 플레이어의 `◀◀ 문장` / `문장 ▶▶`와는 **다른 것이다.** 라벨·위치·스타일을 일부러 다르게
뒀으니, 손댈 때 둘을 닮게 만들지 말 것.

## 스타일 규칙

- 색상·여백 변경은 `style.css`의 `:root` 변수 값만 수정
- 새 컴포넌트 추가 시 기존 BEM-유사 클래스 패턴 유지 (`.post-card`, `.post-card-title` 등)
- 다크모드는 `@media (prefers-color-scheme: dark)` 블록에서만 변수 재정의

## 커밋 규칙

```
[YYYY-MM-DD] 작업 요약
예: [2026-06-28] AI 코딩 팁 포스트 추가
```
