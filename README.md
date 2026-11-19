# MacsALogs

AI 개발 · 생산성 향상 · 취미 프로젝트를 기록하는 개인 블로그 저장소입니다.  
GitHub Pages를 통해 정적 HTML 블로그로 서비스됩니다.

## 블로그 보기

<https://magpie1st.github.io/MacsALogs/>

GitHub Pages가 `main` 브랜치의 `docs/` 폴더를 그대로 서빙합니다 (빌드 없음).

### Lang-Studio (학습 페이지)

블로그 메뉴 「Lang-Studio」 → [`/lang-studio/`](https://magpie1st.github.io/MacsALogs/lang-studio/) — 일상대화 · 드라마 · OPIc · 표현 복습 · 전화영어 · 회의록 · 오디오북.
페이지와 빌더의 원본은 [VoiceLang Studio](../voicelang-studio) 저장소에 있다(이 저장소에는 결과물만). 자세한 것은 `CLAUDE.md` 「Lang-Studio」.

## 구조

```
MacsALogs/
├── docs/                  # GitHub Pages 소스 (빌드 불필요)
│   ├── index.html · about.html
│   ├── css/style.css · js/app.js
│   ├── posts/             # 블로그 글 (posts.json + *.html)
│   ├── lang-studio/       # 학습 페이지 — VoiceLang Studio 가 만든다
│   ├── audio/             # 학습 음원(작은 것) · 뉴스 요약
│   └── *.html, mom/, lesson/   # 옛 주소 → lang-studio 로 넘겨주기
├── scripts/               # VoiceLang 빌더의 상태 파일만(salt · 작품 id)
├── WORKLOG.md · SPEC.md · CLAUDE.md
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

lang-study 로 녹음한 회차는 VoiceLang 에서 올린다: `vls watch langstudy`(내려받기 감시) 또는 `vls publish build langstudy <폴더>` → 승인.
mp3 는 이 저장소에 두지 않고 GitHub Release 자산으로만 올린다(Pages 상한 1GB).
