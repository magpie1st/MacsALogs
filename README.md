# MacsALogs

AI 개발 · 생산성 향상 · 취미 프로젝트를 기록하는 개인 블로그 저장소입니다.  
GitHub Pages를 통해 정적 HTML 블로그로 서비스됩니다.

## 블로그 보기

> GitHub Pages 활성화 후 주소가 생성됩니다.  
> Settings → Pages → Source: `docs/` 폴더, `main` 브랜치 선택

## 구조

```
MacsALogs/
├── docs/                  # GitHub Pages 소스 (빌드 불필요)
│   ├── index.html         # 블로그 메인 (포스트 목록)
│   ├── about.html         # 소개 페이지
│   ├── css/style.css      # 스타일 (다크모드 자동 지원)
│   ├── js/app.js          # 포스트 목록 로딩
│   └── posts/
│       ├── posts.json     # 포스트 메타데이터 목록 (수동 관리)
│       └── *.html         # 개별 포스트 파일
├── WORKLOG.md             # 작업일지 (내부용)
├── SPEC.md                # 기술 명세
└── CLAUDE.md              # Claude Code 가이드
```

## 새 포스트 추가하기

1. `docs/posts/YYYY-MM-DD-slug.html` 파일 생성 (기존 포스트 HTML을 복사해서 내용 교체)
2. `docs/posts/posts.json` 상단에 항목 추가:

```json
{
  "slug": "YYYY-MM-DD-slug",
  "title": "포스트 제목",
  "date": "YYYY-MM-DD",
  "excerpt": "한두 줄 요약",
  "tags": ["태그1", "태그2"],
  "readTime": "3분"
}
```

3. 커밋 & 푸시하면 자동으로 블로그에 반영됩니다.

> Claude Code에 "새 포스트 만들어줘" 라고 하면 위 과정을 자동으로 처리해줍니다.
