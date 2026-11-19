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
- `docs/lang-studio/` — 학습 페이지(Lang-Studio). 원본은 VoiceLang Studio — 아래 절

## 새 포스트 추가 절차

1. `docs/posts/YYYY-MM-DD-slug.html` 생성 — 기존 포스트 HTML 구조 복사 후 내용 교체
2. `docs/posts/posts.json` 배열 **최상단**에 메타데이터 항목 삽입
3. `docs/index.html`의 `<script id="posts-data" type="application/json">` 배열 **최상단**에도 동일 항목 삽입
4. 세 파일의 `slug` 값이 일치해야 함

> `index.html`에 인라인 데이터가 있는 이유: GitHub Pages(Samsung GHE)에서 `fetch()`가 차단될 수 있어
> `fetch()` 없이 DOM에서 직접 JSON을 읽도록 설계되었음.

## Lang-Studio (학습 페이지) — `docs/lang-studio/`

2026-11-19 리빌딩: 흩어져 있던 학습 페이지(comm · tvshow · opic · english · lesson · mom · audiobook)를 `docs/lang-studio/` 한 폴더로 모았다.
블로그 메뉴 「Lang-Studio」가 입구(`lang-studio/`)를 가리킨다. **이 페이지들의 원본(템플릿 · JS · CSS)과 빌더는 VoiceLang Studio 저장소에 있다**
(`../voicelang-studio` — `web/lang-studio/`, `src/voicelang/publish/`). 여기서 손으로 고치지 않는다 — 다음 빌드가 덮어쓴다.

| 주소 | 페이지 | 공개 | 만드는 명령(VoiceLang) |
|---|---|---|---|
| `lang-studio/` | 입구(카드 · 암호 한 번) | 공개 | `vls publish build hub` |
| `lang-studio/talk/` | 일상대화 영어 대본 | 공개 | `vls publish build comm <이름>` |
| `lang-studio/drama/` | 드라마 스크립트 리더 | 공개 | `vls publish build tvshow` · `langstudy` · `shows-release` · `tvshow-release` |
| `lang-studio/opic/` | OPIc 내 이야기 | 공개 | `vls publish build opic` |
| `lang-studio/review/` | 표현 복습 | 공개 | `vls publish build english --blog` |
| `lang-studio/lesson/` | 전화영어 수업 | 암호 | `vls publish build lesson` |
| `lang-studio/minutes/` | 회의록 | 암호 | `vls publish build minutes` |
| `lang-studio/audiobook/` | 오디오북 | 암호 | `vls publish build audiobook` (음원은 `audiobook-audio` 저장소) |

- 게시는 VoiceLang 의 게시 대기 → 사람 승인(`vls publish approve`)으로만 한다. `docs/` 에 쓰면 hermes 가 한 시간 안에 푸시한다 = 공개
- 암호는 하나(저장소 밖 `~/.config/macsalogs/langstudio_pw`). 입구에서 한 번 넣으면 브라우저가 기억한다(localStorage `ls-pw`). 내용은 PBKDF2-SHA256 → AES-256-GCM 암호문으로 저장된다
- 옛 주소(`comm.html` · `tvshow.html` · `opic.html` · `english.html` · `lesson.html` · `mom.html` · `audiobook.html` · `study.html` · `mom/<id>.html` · `lesson/<id>.html`)는 새 주소로 넘겨주는 작은 페이지다
- 음원: 작은 것은 `docs/audio/`(opic · comm · lesson · minutes 의 잠근 `.bin`), 큰 것은 GitHub Release(드라마 · lang-study 녹음)
- `scripts/` 에는 빌더가 읽고 쓰는 상태 파일만 남았다: `audiobook_crypto.json` · `langstudio_crypto.json`(salt — 비밀 아님) · `show_ids.json`
- 로컬 미리보기: VoiceLang 에서 `vls publish serve [<대기 id>]` (Range 206 지원)

## 스타일 규칙

- 색상·여백 변경은 `style.css`의 `:root` 변수 값만 수정
- 새 컴포넌트 추가 시 기존 BEM-유사 클래스 패턴 유지 (`.post-card`, `.post-card-title` 등)
- 다크모드는 `@media (prefers-color-scheme: dark)` 블록에서만 변수 재정의

## 커밋 규칙

```
[YYYY-MM-DD] 작업 요약
예: [2026-06-28] AI 코딩 팁 포스트 추가
```
