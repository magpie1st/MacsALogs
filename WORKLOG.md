# WORKLOG

메일 및 업무 작업일지. 최신 항목이 상단에 위치합니다.

---

## 2026-09-15 (3) — 신사의 품격 전편 오디오 실배포 완료

### 작업

같은 날 앞 항목 (2)에서 "커밋·푸시 전"으로 남겨 두었던 것을 실제로 공개까지 마쳤다.

**(1) Release 자산 확인**

- <https://github.com/magpie1st/MacsALogs/releases/tag/tvshow-audio-2026-09-15-v1>
  asset **20개**, 합계 **447,880,030 bytes** — 로컬 mp3 크기와 정확히 일치
- 20개 전부에 `Range: bytes=0-0` 을 넣어 **HTTP 206 / 1 byte** 응답 확인.
  Episode 1 하나만이 아니라 전 회차에서 Range 요청이 산다는 것을 확인했다

**(2) 사이트 배포**

- 사이트 커밋 `24a2c0a15f5c714311684b133c438c819d986ca3` 를 원격 `github` 의 `main` 에 push.
  local/remote 해시 일치, ahead/behind **0/0**, 작업 트리 clean
- GitHub Pages 가 **정확히 그 커밋에서 `built`** (2026-09-15T12:07:32Z)

**(3) 공개 URL 검증**

- 공개 `tvshow.html` **HTTP 200 / 3,031,074 bytes**, live 와 local 의 SHA-256 이
  `03640c238b223ab79533e5ebb64da4993605b17843b64f1958ed9670d02b67ec` 로 일치
- JS · `config.json` 200. manifest **20개 모두 200** 이고 live/local SHA 일치
- Episode 20 의 Release MP3 에 대해 Range **206 / 1000 bytes** 재확인

**(4) 공개 페이지 실제 조작**

Chrome 152 로 공개 URL 을 직접 열어 확인했다.

- Episode 1 **실제 재생** — `currentTime` 증가, 활성 문장 1개
- `다음 에피소드` 로 E2 전환 — hash · select · `<audio src>` · **1,105 세그먼트** 동기화,
  E2 도 실제 재생
- Episode 20 에서 `다음` disabled, `이전` 으로 E19 이동. 가로 overflow **0**
- 스크린샷 `/tmp/tvshow-all-audio-release-live-public.png`

**(5) 보안 리뷰에서 걸린 두 건**

독립 리뷰가 **처음에는 실패**했다. 두 건이었다.

- 인라인 JSON 에 literal `</script>` 가 들어가면 stored XSS 가 된다
- Release URL 화이트리스트가 **임의의 HTTPS host** 를 허용하고 있었다

Claude(`-p --model opus`)로 TDD 로 고쳤다. JSON 의 `<`, `>`, `&` 와 U+2028/U+2029 를
escape 하고, host 를 `github.com/<owner>/<repo>/releases/download/<tag>` 형태로 정확히
제한했다. 테스트 **130 → 181 passed**. 최종 독립 리뷰 passed, concerns/errors **0**.
이 보안 수정은 위와 **같은 `24a2c0a` 커밋에 포함되어 있다** — 즉 공개된 코드는 수정본이다.

### 상태

자동 검증은 여기서 끝났다. Release 크기·Range, 커밋/푸시/Pages 빌드, 공개 HTML·JS·manifest
해시 일치, 브라우저 실제 재생·회차 이동까지 모두 확인했다.

**여전히 사람 청취는 하지 않았다.** 발음·억양·이음새의 자연스러움은 미검증이며,
15시간 33분 분량의 회차별 표본 청취가 남아 있다. 위 "재생됨"은 오디오가 흐르고 문장 하이라이트가
따라온다는 뜻이지, 음질이 좋다는 뜻이 아니다.

---

## 2026-09-15 (2)

### 작업

TVShow 페이지에 **전 20편 오디오**를 붙이고, 에피소드 이동 UI를 넣었다.
같은 날 앞 항목(Episode 1 단독 오디오)의 후속이며, 배포 방식이 바뀌었다.
이번에도 Claude Code(`claude -p`, Opus)로 진행했다.

**(1) 배포 방식 변경 — 음원을 GitHub Release로**

기존에는 mp3를 `docs/audio/tvshow/`에 그대로 넣었다. 20편으로 늘리면 이 방식이 깨진다.
GitHub Pages가 서빙하는 사이트 상한은 1GB인데, 작업 시작 시점 `docs/` 실측이 446,771,615 bytes였고
여기에 20편 mp3를 더하면 넘는다. 64k로 낮춰도 448MB를 커밋하게 되어 git 이력에 영구히 쌓인다.

- 음원은 Release 자산으로 올리고, Pages에는 타임라인 JSON만 둔다
- `docs/audio/tvshow/config.json`(신규)에 `audioBaseUrl`을 적고, `scripts/build_tvshow.py`가
  이를 읽어 오디오 `file`을 절대 https Release URL로 만든다. 없으면 기존 상대경로 동작 유지
- URL은 화이트리스트로 검사한다(https만, 자격증명·쿼리·`..`·`%`·공백·비ASCII 금지,
  trailing slash 정규화). 공개 HTML에 그대로 박히는 문자열이라 여기서 못 거르면 사이트에 남는다
- 인라인 JSON에 로컬 경로가 섞이면 생성을 중단하는 검사도 넣었다

**(2) 전 20편 오디오 (실측)**

- Kokoro `af_heart` / speed 1.0 / 24kHz mono / **64k**. Episode 1도 기존 128k에서 64k로 재생성
- mp3 20개 합계 **447,880,030 bytes**, 총 재생 길이 **55,984.176초(15:33:04.176)**,
  문장 세그먼트 **20,710개**, 단일 최대 **26,622,474 bytes**
- 회차별 원본 sha256 · mp3 sha256 · 문장 커버리지 · 타임라인 단조성 · ffprobe 재생 길이 검증 통과
  (manifest 마지막 `end`와 실제 길이의 차는 최대 **0.068초**)
- Release `tvshow-audio-2026-09-15-v1` 생성 완료 — draft/prerelease 아님, **asset 20개**,
  크기가 로컬과 일치. Episode 1에 `Range: bytes=0-999`를 넣어 redirect 후 **HTTP 206 / 1000 bytes**
  확인. Release 자산에서도 문장 단위 seek이 동작한다는 뜻이다
- 반영 결과: `docs/audio/tvshow/`에 JSON 20개 + `config.json`, **mp3 0개**.
  `docs/` 합계 **410,026,759 bytes**(1GB 대비 충분한 여유). `tvshow.html`은 20편 모두
  Release URL을 참조하고 인라인 세그먼트 합계가 20,710으로 manifest와 일치

**(3) 이전/다음 에피소드 버튼**

20편이 되니 셀렉트만으로는 회차를 넘기기 번거로웠다.

- `docs/tvshow.html` · `docs/js/tvshow.js` · `docs/css/style.css`에 추가
- 셀렉트와 동기화, hash 갱신, 재생 정지 + `<audio src>` 교체, 검색 초기화, 상단 이동
- Episode 1에서 이전 잠김 / Episode 20에서 다음 잠김 / 중간 회차 양쪽 활성.
  끝에 닿아 버튼이 잠기면 포커스를 반대쪽 버튼으로 옮긴다(키보드 사용자가 포커스를 잃지 않도록)
- 키보드 `[` / `]` 단축키, `role="group"` + `aria-label`, 상태는 `aria-live`로 알린다
- **하단 플레이어의 `◀◀ 문장` / `문장 ▶▶`와 시각적으로 구분했다.** 라벨을 '에피소드'까지 적고,
  위치(상단 도구모음)와 스타일(채워진 가로 버튼)을 다르게 뒀다

**(4) 검증**

- `uv run pytest -q` **130 passed** (tts-maker. Release URL·manifest-only·dry-run 무변경·
  불안전 URL 거부·로컬 폴백·실제 mp3 검증 테스트 추가)
- jsdom **17 passed** — E1/E2/E20 버튼 상태, 클릭 전환, hash, 재생정지/src 교체.
  `/tmp/tvshow-jsdom`에서만 돌리고 이 저장소에 `node_modules`를 만들지 않았다
- 실제 Chrome 152 desktop 1440×1200 / mobile 390×844: 버튼 상태·hash·src 교체 확인,
  **가로 overflow 0**. 스크린샷 `/tmp/tvshow-all-audio-{desktop,mobile}.png`
- `node --check`, python compile, `git diff --check` 통과

### 상태

**아직 이 저장소의 git commit / push / Pages 배포를 하지 않았다.**
작업 트리에만 반영되어 있다. Release 자산 업로드는 끝났으므로, 커밋·푸시(원격 `github`)하면
그때 공개 페이지에 반영된다.

**음성 품질은 사람이 듣고 확인하지 않았다.** 자동 검증은 파일 생성·해시·길이·타임라인 정합까지다.
발음·억양·이음새의 자연스러움은 미검증이며, 15시간 33분 분량이라 회차별 표본 청취가 남아 있다.

---

## 2026-09-15

### 작업

오늘 TVShow 스크립트 페이지를 세 단계로 만들었다. 모두 Claude Code(`claude -p --model opus`)로 진행했다.

**(1) `docs/tvshow.html` 독립 페이지 최초 구축 — Episode 1**
- 포스트가 아닌 독립형 페이지(내비게이션에 없고 URL 로만 접근). `docs/js/tvshow.js`,
  `style.css` 의 `.tv-*` 블록 신설
- Episode 1 반영: 장면 82개 · 대사 932줄 · 5,675 words
- 본문 검색(Enter/Shift+Enter 로 결과 이동, `/` 단축키), 글자 크기 7단계 조절,
  '맨 위로', 모바일 대응, 설정 localStorage 저장
- 원본은 `book-maker/output/<NN>/episode_<NN>.md` 이고 **읽기만 한다.**
  `scripts/build_tvshow.py` 가 `TVSHOW-DATA` 마커 사이 인라인 JSON 을 자동 생성한다

**(2) 전 20편으로 확장**
- E1~E20 전체 반영: 총 **1,604장면 · 18,855줄 · 123,032 words**
- 아직 원본이 없는 회차는 선택 목록에 `준비 중`으로 남긴다

**(3) Episode 1 오디오 + 문장 동기화 플레이어**
- `tts-maker` 저장소에 TVShow 전용 파이프라인을 만들어 Episode 1 전편을 합성했다.
  Kokoro-82M(`hexgrad/Kokoro-82M`) · `af_heart` · speed 1.0 · 전액 로컬 추론
- 산출물: 단일 MP3 **2664.168초(44:24.168) · 42,627,210 bytes · mp3 24kHz mono 128kbps**
  \+ 문장 타임라인 JSON **1,006 세그먼트** (`docs/audio/tvshow/episode-01.{mp3,json}`)
- 플레이어: 재생/일시정지, ±10초, 이전/다음 문장, 배속 0.75~1.5×, 진행바, 현재/전체 시간,
  현재 문장 표시, **본문 문장 클릭 시 해당 시각으로 seek**, 현재 문장 강조 및 자동 추적
  (손으로 스크롤하면 6초간 추적을 멈춘다. '따라가기' 체크박스로 끌 수도 있다)
- **E2~E20 에는 오디오가 없다.** 해당 회차에서는 플레이어가 숨고 기존 스크립트 UX 그대로다.
  회차를 바꾸면 재생을 멈추고 `src` 까지 해제한다

### 배포 상태

- (1)과 (2)는 커밋·푸시되어 GitHub Pages 에 반영됐다
  (`b6ff0ee TVShow 스크립트 페이지 추가`, `417e378 신사의 품격 전편 스크립트 추가`)
- (3)도 `5c57ec8 Episode 1 Kokoro 오디오 플레이어 추가`로 GitHub `main`에 푸시했다.
  Pages가 같은 SHA를 `built`로 처리한 뒤 페이지·JS·JSON·MP3의 HTTP 200을 확인했다.
- 공개 MP3는 **42,627,210 bytes**로 로컬과 SHA-256이 일치했고, Range 요청
  `bytes=0-999`가 **206 Partial Content**로 응답했다.
- 실제 Chrome에서 재생 시간이 0초→2.315초로 진행되고 현재 문장 1개가 강조되는 것,
  다음 문장 이동(6.795초), E1→E20에서 플레이어 숨김·음원 해제, E1 복귀를 확인했다.

### 검증

- `scripts/build_tvshow.py` 가 manifest 를 대본과 다시 맞춰 보고, 한 글자라도 어긋나면
  **중단한다.** 문장 강조가 밀린 페이지를 올리는 것보다 올리지 않는 편이 낫다
- 타임라인: 1,006 세그먼트 전부 단조 증가, 모든 구간 양수, 932줄이 문자 구간으로 빈틈없이
  덮임. 마지막 end 2664.105초 vs ffprobe 2664.168초 → 차 **0.063초**(MP3 인코더 패딩)
- 로컬 HTTP: 페이지/js/css/json 200, mp3 200 및 `Range: bytes=0-99` → **206**
- jsdom 11개 절 통과 — 문장 클릭 seek, 이전/다음, ±10초, timeupdate 강조 추적, 배속,
  E1↔E20 전환과 복귀, 검색, 932줄 원문 복원
- 실제 Chrome 렌더: 데스크톱 1440×1200 / 모바일 390×844 모두 **가로 넘침 0px**,
  고정 플레이어가 본문 마지막 줄을 가리지 않음
- `tts-maker` 테스트 42개 통과

### 판단

- **타임라인을 인라인 JSON 에 텍스트 없이 넣었다.** 본문은 이미 `scenes` 에 있으므로
  `[장면, 줄, 문장, 시작ms, 끝ms, 문자시작, 문자끝]` 일곱 숫자만 싣고, 브라우저가 그 구간으로
  줄을 잘라 문장 span 을 만든다. 덕분에 `tvshow.html` 이 2.4MB 로 사실상 그대로다
- **문장마다 MP3 를 만들지 않았다.** 회차당 1,006개는 저장소를 부풀리고 문장을 넘길 때마다
  새 요청이 붙는다. 단일 MP3 를 Range 로 seek 하는 편이 낫다
- 오디오·manifest 는 정적 자산이지만 재생목록 데이터는 여전히 **인라인**이다.
  사내 GHE 에서 `fetch()` 가 막힐 수 있다는 기존 방침을 그대로 지켰다

### 막힌 점

- **Claude Code 가 max-turns 로 두 번 끊겨 이어 실행했다.** 이어받을 때 기존 세션과
  산출물을 그대로 재사용했고, MP3 를 다시 합성하지 않았다. 재합성했다면 같은 입력에도
  다른 파형이 나와 타임라인을 다시 검증해야 했을 것이다
- **`setupAudio()` 의 `currentTime = 0` 대입이 `timeupdate` 를 일으켜, 재생을 누르기도 전에
  첫 문장이 강조됐다.** jsdom 테스트에서 잡혔다. `setActive(-1)` 은 이미 -1 일 때 조기
  반환하므로 초기화에 쓸 수 없어, 무조건 지우는 `clearActive()` 를 따로 뒀다
- **문장 버튼을 `display:inline-block` 으로 두면 긴 문장이 줄바꿈되지 않아 가로로 넘친다.**
  `display:inline` 으로 바꾸고 문장 사이 공백은 버튼 **밖에** 뒀다. 안에 넣으면 렌더링에서
  접혀 사라진다
- **2026-08-31 에 적은 "브라우저 자동화가 미디어를 차단한다"가 이번엔 재현되지 않았다.**
  Range 를 지원하는 로컬 서버 + headless Chrome 에서 `readyState=4` 로 실제 로드·재생됐다.
  당시 원인이 Range 미지원이었을 가능성이 있으나 단정하지는 않는다
- **발음·억양·문장 이음새는 여전히 사람이 들어야 한다.** 특히 한국 인명과 단위 표기를
  Kokoro 가 어떻게 읽는지는 자동으로 확인할 수 없다. 무음 길이(문장 0.12s / 줄 0.38s /
  장면 0.9s)가 대본 낭독에 적절한지도 청취 후 판단이 필요하다

---

## 2026-06-28

### 작업
- 저장소 초기 설정: CLAUDE.md, README.md, SPEC.md, WORKLOG.md 생성

---

## 2026-08-31

### 작업
- OPIc 음원 페이지 `docs/opic.html` 신설 (포스트 아님, 내비게이션 고정)
- 하단 고정 플레이어 `docs/js/opic.js` — 배속(0.75~1.5×), 한 곡 반복, 10초 뒤로,
  이전/다음, 스크립트 접기·펼치기, 배속·반복 설정 localStorage 저장
- `tts-maker`로 생성한 첫 음원 5개 배포 (Narration Experience 3 + Overseas Trips 2, 7.5분)
- `style.css`에 `.opic-*` 블록 추가 (기존 CSS 변수만 사용, 다크모드 자동 대응)

### 판단
- **포스트로 만들지 않은 이유**: 학습용 도구라 매일 다시 찾아 들어간다.
  날짜순 목록에 넣으면 시간이 지날수록 아래로 밀린다. 내비게이션 고정이 맞다.
- **재생목록을 인라인 JSON으로 넣은 이유**: 기존 `index.html`과 같은 이유로
  사내 GHE에서 `fetch()`가 막힐 수 있다. 대신 손으로 고치지 않도록
  `tts-maker/scripts/publish_blog.py`가 마커 사이를 자동 생성한다.

### 막힌 점
- 플레이어 버튼에 쓴 `⏮ ⏭ 🔁`가 브라우저에서 이모지로 렌더링되어 알아보기 어려웠다.
  `◀◀` `▶▶` `반복` `-10초` 텍스트로 교체.
- `.opic-track-title/meta`를 `<span>`으로 두어 제목과 재생시간이 한 줄에 붙었다.
  버튼 안의 span이라 `display:block`을 명시해야 했다.
- 로컬 검증 시 실제 오디오 재생은 확인하지 못했다 (브라우저 자동화 환경이 미디어
  로딩을 차단 — 기존 m4a 음원도 동일 증상). 레이아웃·플레이어 동작·스크립트 토글까지만 확인.

---

## 2026-08-31 (2)

### 작업
- 상단 내비게이션에서 「오픽」링크 제거 (index/about/opic 세 곳). URL로만 접근한다
- 플레이어의 반복을 버튼 → **체크박스**로 변경하고 동작을 재정의
  - 체크: 지금 듣는 곡만 무한 반복
  - 해제: 곡이 끝나면 다음 곡, 마지막 곡 뒤에는 첫 곡으로 돌아가 전체 목록 순환
- 목록이 순환하므로 이전/다음 버튼의 비활성화 처리를 제거하고 양끝에서 감싸도록 변경

### 판단
- 이전에는 마지막 곡이 끝나면 재생이 멈췄다. 이제 두 모드 모두 끝나지 않는다 —
  한 곡을 붙잡고 쉐도잉하거나 전체를 흘려듣거나, 둘 중 하나가 학습 패턴이기 때문.

### 검증
- 내비게이션 3개 페이지 모두 홈/소개만 남음
- 마지막 곡에서 다음 → 첫 곡, 첫 곡에서 이전 → 마지막 곡 순환 확인
- 체크박스 상태 localStorage 저장 및 새로고침 후 복원 확인
- 모바일 390px에서 컨트롤 6개가 한 줄에 들어가고 가로 스크롤 없음 (335px / 335px)

---

<!-- 아래에 새 항목을 추가할 때는 이 주석 위에 작성하세요 -->
