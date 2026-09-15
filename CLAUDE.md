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

`docs/audio/tvshow/episode-NN.{mp3,json}`은 **`tts-maker`가 만든 생성물이다. 손으로 고치지 말 것.**
json은 문장별 start/end 타임라인이고, 페이지의 문장 강조·클릭 seek이 전부 여기에 의존한다.

오디오가 있는 회차만 플레이어가 뜬다. 없는 회차는 기존 스크립트 화면 그대로다.
현재 오디오가 있는 회차는 Episode 1 하나다.

```bash
cd /home/magpie/Workspace/dev/macGitHub/tts-maker

uv run tts-maker-tvshow -n --episode 1            # 생성 계획만 확인
uv run tts-maker-tvshow --episode 1               # 실제 합성 (회차당 약 1분)

uv run python scripts/publish_tvshow.py -n        # 배포 계획 + 검증만
uv run python scripts/publish_tvshow.py           # 복사 + tvshow.html 갱신
```

`publish_tvshow.py`가 이 저장소의 `scripts/build_tvshow.py`까지 실행한다.
manifest가 원본 대본과 어긋나면 **배포가 중단된다** — 문장 강조가 밀린 페이지를
올리는 것보다 올리지 않는 편이 낫다. 그 뒤 커밋·푸시는 이 저장소에서 직접 한다.

## 스타일 규칙

- 색상·여백 변경은 `style.css`의 `:root` 변수 값만 수정
- 새 컴포넌트 추가 시 기존 BEM-유사 클래스 패턴 유지 (`.post-card`, `.post-card-title` 등)
- 다크모드는 `@media (prefers-color-scheme: dark)` 블록에서만 변수 재정의

## 커밋 규칙

```
[YYYY-MM-DD] 작업 요약
예: [2026-06-28] AI 코딩 팁 포스트 추가
```
