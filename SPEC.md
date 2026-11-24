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
| `docs/lang-studio/` | 학습 페이지(Lang-Studio) — 원본 · 빌더는 VoiceLang Studio(아래 절) |
| `docs/work/` | 업무 기록(Work — 회의록 · Harman-Plus), 2026-11-24 분리 |
| `docs/{lang-studio,work}/assets/key.json` | 섹션 암호 확인 상자(섹션 이름을 봉인 — 비밀 아님) |
| `docs/audio/` | 학습 음원(opic · comm · tvshow/shows 타임라인 · lesson/minutes 잠근 녹음) · 뉴스 요약 m4a |
| `docs/*.html`(comm · tvshow · …), `docs/mom/`, `docs/lesson/`, `docs/lang-studio/minutes/` | 옛 주소 → `lang-studio/` · `work/` 넘겨주기 |
| `.gitattributes` | 줄바꿈 LF 하나(`* text=auto eol=lf`) |
| `scripts/audiobook_crypto.json` · `scripts/langstudio_crypto.json` | 암호 열쇠의 salt(비밀 아님) — VoiceLang 빌더가 읽는다 |
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

## 학습 페이지 → Lang-Studio (2026-11-19)

OPIc · TVShow(드라마) · 오디오북 · 일상대화 · 전화영어 · 회의록 · 영어 복습 페이지의 명세는 VoiceLang Studio 로 옮겼다
(`../voicelang-studio/SPEC.md` 3.6 「Lang-Studio」, 페이지 원본 `web/lang-studio/`). 이 저장소에는 결과물(`docs/lang-studio/`)과
옛 주소의 넘겨주기 페이지만 있다. 옛 명세(스키마 · 화면 · 기억 키)는 이 파일의 git 이력(2026-11-19 이전)에 있다.

## Work 분리 · 암호 화면 · 메뉴 숨김 (2026-11-24)

명세는 VoiceLang `SPEC.md` 3.6.2(무엇을 왜 바꿨나 표). 이 저장소에서 보이는 결과:
- 블로그 메뉴는 「홈 · 소개」 — Work · Lang-Studio 는 주소로만
- `docs/work/`: 회의록 41건(work 암호). 영어 대본이 있는 회의 2건은 `docs/lang-studio/meeting/` 에도
- Lang-Studio 의 모든 페이지가 암호를 넣어야 보인다 — 봉인(전화영어 · 오디오북 · 회의대본: 내용이 암호문) / 문(미디어 · 일상대화 · 표현카드 · OPIc: 내용은 평문, 화면만 가림)
- 오디오북 잠금 화면에 책 제목 · 저자가 나오지 않는다
- 줄바꿈 LF 하나 — `.gitattributes`

## 스타일 시스템

- CSS 변수(`--bg`, `--text`, `--accent` 등)로 라이트/다크 테마 관리
- `@media (prefers-color-scheme: dark)` 로 OS 설정 자동 감지
- 최대 너비 `760px`, 모바일 대응 완료

## GitHub Pages 설정

- Source: `main` 브랜치 / `docs/` 폴더
- 커스텀 도메인: 미설정 (기본 `magpie1st.github.io/MacsALogs`)
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
