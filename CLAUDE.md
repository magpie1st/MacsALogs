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

## Work · Lang-Studio — `docs/work/` · `docs/lang-studio/`

**블로그 메뉴는 「홈 · 소개」뿐이다.** Work · Lang-Studio 는 메뉴에 두지 않고 주소(`/work/` · `/lang-studio/`)로만 들어간다(2026-11-24 사용자).
2026-11-19 학습 페이지를 `docs/lang-studio/`로 모았고, 2026-11-24 업무 쪽을 `docs/work/`로 나눴다.
두 입구(`work/` · `lang-studio/`)는 같은 틀을 쓴다. 위에는 카드 설명이 공개로 나오고, **카드 목록은 그 섹션 암호로 봉인**되어 있어 암호를 넣어야 보인다.
**Lang-Studio 의 모든 페이지는 암호를 넣어야 보인다.** 내용이 암호문인 페이지(봉인)와, 내용은 평문이고 화면만 가리는 페이지(「문」)가 있다.
**이 페이지들의 원본(템플릿 · JS · CSS)과 빌더는 VoiceLang Studio 저장소에 있다**
(`../voicelang-studio` — `web/lang-studio/`, `src/voicelang/publish/`). 여기서 손으로 고치지 않는다. 다음 빌드가 덮어쓴다.

| 주소 | 페이지 | 잠금 | 만드는 명령(VoiceLang) |
|---|---|---|---|
| `work/` · `lang-studio/` | 입구 두 개(카드는 섹션 암호) | 설명만 공개, 카드 봉인 | `vls publish build hub` |
| `work/harman-plus/` | Harman-Plus (지금은 빈 자리) | 봉인(work) | hub 가 빈 자리만 만든다 |
| `work/minutes/` | 회의록(정리본 · 영어 정리본) | 봉인(work) | `vls publish build minutes` |
| `lang-studio/lesson/` | 전화영어 수업 | 봉인(ls) | `vls publish build lesson` |
| `lang-studio/audiobook/` | 오디오북(잠금 화면에 책 제목도 없음) | 봉인(ls) | `vls publish build audiobook` (음원은 `audiobook-audio` 저장소) |
| `lang-studio/drama/` | 미디어(드라마 · 영화 리더) | 문(ls) | `vls publish build tvshow` · `langstudy` · `shows-release` · `tvshow-release` |
| `lang-studio/talk/` | 일상대화 영어 대본 | 문(ls) | `vls publish build comm <이름>` |
| `lang-studio/review/` | 표현카드 | 문(ls) | `vls publish build english --blog` |
| `lang-studio/opic/` | OPIc 내 이야기 | 문(ls) | `vls publish build opic` |
| `lang-studio/meeting/` | 회의대본(영어 대본이 있는 회의 + 녹음) | 봉인(ls) | `vls publish build minutes` |

- 봉인 = 내용이 암호문(암호 없이는 읽을 수 없다). 문 = 내용은 평문이고, `ls.js` 가 암호를 넣기 전에는 머리 메뉴 · 암호 창 밖을 가린다. 암호 확인은 `<섹션>/assets/key.json`(섹션 이름을 봉인한 상자). 「문」 페이지의 소스 · 음원은 주소를 알면 받을 수 있다 — 내용 암호화는 하지 않기로 했다(2026-11-24 사용자)
- 게시는 VoiceLang 의 `vls publish auto <빌더>`(게시 대기 → 관문 → 승인 → 푸시)로 한다. `docs/` 에 쓰고 푸시하면 공개다
- 블로그 메뉴(`index.html` · `about.html` · `posts/*.html`)의 Work · Lang-Studio 링크는 `vls publish build hub` 가 지운다. 새 글을 만들 때도 메뉴에 넣지 않는다
- 암호 파일은 두 개뿐이다(저장소 밖 `~/.config/macsalogs/`). `langstudio_pw` → Lang-Studio(브라우저 localStorage `ls-pw`), `work_pw` → Work(`work-pw`). 내용은 PBKDF2-SHA256 → AES-256-GCM 암호문으로 저장된다
- 옛 주소는 새 주소로 넘겨주는 작은 페이지다. `lang-studio/minutes/*` · `mom.html` · `mom/*` → `work/minutes/`(대본만 있는 회의는 `lang-studio/meeting/`), 그 밖의 `comm.html` · `tvshow.html` · `opic.html` · `english.html` · `lesson.html` · `audiobook.html` · `study.html` · `lesson/<id>.html` 도 같다
- 음원은 크기로 나뉜다. 작은 것은 `docs/audio/`(opic · comm · lesson · 회의대본의 잠근 `.bin`), 큰 것은 GitHub Release(드라마 · lang-study 녹음)
- `scripts/` 에는 빌더가 읽고 쓰는 상태 파일만 남았다: `audiobook_crypto.json` · `langstudio_crypto.json`(salt — 비밀 아님) · `show_ids.json`
- 로컬 미리보기: VoiceLang 에서 `vls publish serve [<대기 id>]` (Range 206 지원)

## 줄바꿈 — LF 하나 (2026-11-24)

- `.gitattributes`(`* text=auto eol=lf`) — Windows 에서 CRLF 로 저장해도 커밋은 LF, 받을 때도 LF. 바이너리는 건드리지 않는다
- 까닭: 글 9개가 CRLF 로 커밋돼 있었고, 메뉴 한 줄을 고칠 때 파일 전체 줄바꿈이 바뀌어 수천 줄 diff 가 났다(`aa3d0e0` 에서 LF 로 통일)

## 이 PC 의 로컬 메모 — `CLAUDE.local.md`(git 밖)

공개하지 않는 작업 메모(원격 · PC별 git 설정 등)는 저장소 뿌리의 `CLAUDE.local.md` 에 있다. `.gitignore` 에 들어 있어 커밋 · 푸시되지 않는다.
**git 원격 · 푸시 · `.git/config` 를 다루기 전에 반드시 그 파일을 먼저 읽는다.** Claude Code 는 이 파일을 자동으로 함께 읽는다(다른 에이전트는 직접 연다).

## 스타일 규칙

- 색상·여백 변경은 `style.css`의 `:root` 변수 값만 수정
- 새 컴포넌트 추가 시 기존 BEM-유사 클래스 패턴 유지 (`.post-card`, `.post-card-title` 등)
- 다크모드는 `@media (prefers-color-scheme: dark)` 블록에서만 변수 재정의

## 커밋 규칙

```
[YYYY-MM-DD] 작업 요약
예: [2026-06-28] AI 코딩 팁 포스트 추가
```
