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
