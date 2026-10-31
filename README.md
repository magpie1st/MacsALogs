# MacsALogs

AI 개발 · 생산성 향상 · 취미 프로젝트를 기록하는 개인 블로그 저장소입니다.  
GitHub Pages를 통해 정적 HTML 블로그로 서비스됩니다.

## 블로그 보기

<https://magpie1st.github.io/MacsALogs/>

GitHub Pages가 `main` 브랜치의 `docs/` 폴더를 그대로 서빙합니다 (빌드 없음).

### 독립형 페이지

포스트 목록에 넣지 않고 주소로만 접근하는 학습용 페이지들입니다. 내비게이션에도 없습니다
(날짜순으로 흘러가면 안 되는 도구이므로).

| 주소 | 무엇 |
|---|---|
| [`/tvshow.html`](https://magpie1st.github.io/MacsALogs/tvshow.html) | **TV쇼·영화 스크립트 리더.** 대본을 읽으며 문장을 누르면 그 지점부터 재생. 작품 → 시즌 → 화, 한국어 자막 토글(`K`), 본문 검색 |
| [`/opic.html`](https://magpie1st.github.io/MacsALogs/opic.html) | OPIc 스크립트 음원 재생목록 |
| [`/english.html`](https://magpie1st.github.io/MacsALogs/english.html) | 영어 노트 카드형 복습 |
| `/mom.html` | 회의록 대본 |

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
│   ├── tvshow.html        # 스크립트 리더 (인라인 JSON + 문장 동기화 플레이어)
│   ├── opic.html, english.html, mom.html
│   ├── js/tvshow.js       # 작품·시즌·회차 전환, 문장 강조·클릭 seek, 한국어 토글
│   └── audio/
│       ├── opic/<주제>/*.mp3      # OPIc 음원 (저장소에 둔다)
│       ├── tvshow/episode-NN.json # TTS 시리즈 타임라인
│       └── shows/<작품>/*.json    # 녹음 작품 타임라인 (mp3는 Release에만)
├── scripts/               # 생성기 (python3 하나로 돈다. 의존성 없음)
│   ├── shows.py           # JSON 블록 읽기·쓰기, 공개 문자열 검사
│   ├── build_tvshow.py    # TTS 시리즈 (book-maker 원본)
│   ├── build_langstudy.py # 녹음 작품 (lang-study 내보내기)
│   ├── publish_shows.py   # 음원 Release 업로드 + 주소 교체 + 푸시
│   ├── watch_langstudy.py # ~/Downloads/lang-study 감시 → 자동 반영
│   ├── serve_docs.py      # 로컬 미리보기 (Range 206 지원)
│   └── test_shows.py      # 자체 검사
├── .claude/               # 스킬·에이전트 (script-reader)
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

## 스크립트 리더에 회차 올리기

[lang-study](https://github.com/magpie1st/lang-study) 확장이 Netflix·쿠팡플레이에서 녹음한
회차를 올립니다. 입력은 그 확장의 **전체 MP3 + 스크립트 JSON** 두 파일입니다.

```bash
# 한 번에 (대본 → 음원 Release 업로드 → 주소 교체 → Range 확인 → 커밋·푸시)
python3 scripts/build_langstudy.py "~/Downloads/lang-study/<폴더>" --publish --push

# 내려받기만 하면 알아서 올라가게
python3 scripts/watch_langstudy.py

# 로컬에서 먼저 보기 (Range 206 지원 — http.server 를 쓰면 문장 클릭이 안 된다)
python3 scripts/serve_docs.py
```

**mp3는 이 저장소에 두지 않습니다.** Pages 사이트 상한이 1GB인데 한 회차가 16MB라
GitHub Release 자산으로만 올립니다. 자세한 절차는 `CLAUDE.md`와
`.claude/skills/script-reader/SKILL.md`, 설계는 [SPEC.md](SPEC.md)를 참고하세요.

```bash
python3 scripts/test_shows.py   # 생성기 자체 검사 (의존성 없음)
```
