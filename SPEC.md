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

_최종 수정: 2026-06-28_
