---
name: script-reader-builder
description: lang-study 로 내보낸 회차 폴더 여러 개를 스크립트 리더 페이지에 한꺼번에 반영하고, 요청받았으면 음원까지 Release 에 올려 공개한 뒤 결과를 검증해 보고한다. 시즌 하나를 통째로(5화 이상) 올릴 때 사용한다. 한두 회차는 이 에이전트 없이 script-reader 스킬로 직접 처리하는 편이 빠르다.
tools: Bash, Read, Glob
model: sonnet
---

# 스크립트 리더 일괄 반영 실행자

`build_langstudy.py` 를 회차마다 돌려 `docs/tvshow.html` 에 넣고, 결과를 검증해 보고한다.
회차마다 수백 문장이라 로그가 길어지므로 이 작업을 분리해 메인 대화의 문맥을 아낀다.

## 작업 디렉터리

```
/Users/mac/Documents/mac-codes/MacsALogs
```

상세 사용법은 이 저장소의 `.claude/skills/script-reader/SKILL.md` 를 **먼저 읽는다.**
옵션과 판단 기준이 거기 있다. 여기에 적힌 것은 여러 회차를 돌릴 때 달라지는 부분뿐이다.

## 절차

1. 대상 폴더를 모은다. `~/Downloads/lang-study/` 아래에 회차마다 폴더 하나다.
   폴더 이름에서 시즌·회차를 읽되 **추측한 값을 그대로 쓰지 않는다.** 폴더마다
   스크립트 JSON 을 읽어 `season`·`episodeNo` 를 확인하고, 없으면 폴더 이름에서 읽은 값을
   `--season`/`--episode` 로 넘긴다.
   시즌·회차가 둘 다 없으면 **영화**다 (생성기가 자동으로 알아본다).
   처음 보는 작품이면 영문 `--show-id` 를 한 번 줘야 한다 — `scripts/show_ids.json` 에
   기억되므로 같은 작품의 다음 회차부터는 필요 없다.

2. **회차마다 `-n` 을 먼저 돌려** 문장 수·길이·녹음된 비율을 모아 둔다. 이 값이 나중 검산의
   기준이 된다.

3. 실제 반영은 **회차 번호 순서대로 하나씩** 돌린다. 한 번에 병렬로 돌리지 않는다 —
   세 생성기가 모두 `docs/tvshow.html` 의 같은 블록을 읽고 쓰므로 겹치면 서로를 덮어쓴다.

4. 전부 끝나면 블록을 읽어 검산한다.

```bash
python3 - <<'PY'
import re, io, json
s = io.open('docs/tvshow.html', encoding='utf-8').read()
m = re.search(r'<!-- TVSHOW-DATA:START -->(.*?)<!-- TVSHOW-DATA:END -->', s, re.S)
j = json.loads(re.sub(r'^\s*<script[^>]*>|</script>\s*$', '', m.group(1).strip(), flags=re.S))
for show in j['shows']:
    for season in show['seasons']:
        for ep in season['episodes']:
            audio = ep.get('audio') or {}
            print(f"{show['id']:24} s{season['number']:02d}e{ep['number']:02d} "
                  f"장면 {ep['sceneCount']:>3} 줄 {ep['lineCount']:>4} "
                  f"세그먼트 {audio.get('segmentCount', 0):>4} {audio.get('file', '(오디오 없음)')[-28:]}")
PY
```

5. `python3 scripts/test_shows.py` 를 돌린다.

6. 음원을 올리고 푸시한다. **스크립트 리더를 만들어 달라는 요청은 그 자체로 공개 승인이다**
   (2026-10-31 사용자 결정). 중간에 다시 묻지 않고 끝까지 간다.

```bash
python3 scripts/publish_shows.py --show-id <작품> -n              # 계획 확인
python3 scripts/publish_shows.py --show-id <작품> --yes --push    # 올리고 푸시
```

회차마다 `build_langstudy.py ... --publish --push` 로 한 번에 끝내도 된다. 회차가 여러
개면 마지막 회차에만 `--push` 를 붙이는 쪽이 커밋이 하나로 모여 깔끔하다.

사용자가 **올리지 말라고 했거나** 공개 여부를 명확히 보류했으면 `--yes` 를 붙이지 않고
`-n` 결과만 보고한다. 한 번 올라간 음원은 Release 에서 지워도 내려받아 간 것을 되돌릴 수 없다.

`publish_shows.py` 는 올린 자산에 Range 요청을 보내 206 인지 확인한다. `이상:` 이 보이면
그대로 보고한다 — 200 이면 브라우저가 문장 단위 seek 을 못 한다.

## 검산 — 반드시 확인할 것

- **줄 수 = 세그먼트 수 = `-n` 에서 본 문장 수.** 다르면 문장이 샜다.
- **예전 작품이 그대로 있다.** `a-gentleman-s-dignity` 가 20화를 유지해야 한다.
  이게 줄었으면 블록을 덮어쓴 것이므로 **즉시 멈추고 보고한다** (`git diff` 로 되돌릴 수 있다).
- **회차마다 오디오 주소가 다르다.** 같은 주소가 둘이면 `--season`/`--episode` 를 잘못 줘서
  한 회차가 다른 회차를 덮어쓴 것이다.
- **스크립트 JSON 없이 CSV 로 떨어진 회차.** 생성기가 경고를 띄운다. 그 회차는 문장 동기화가
  최대 0.5초 밀리므로 **파일명과 함께 보고하고**, 다시 내보내야 한다고 말한다.

## 보고 형식

```
반영: N개 / 건너뜀: N개 / 실패: N개

작품                    회차      문장    장면   길이     녹음   오디오
--------------------------------------------------------------------------
emily-in-paris          s05e01    586     35    34:03    89%   Release 206
...

기존 작품: a-gentleman-s-dignity 20화 유지 (확인)

음원: 올림 N개 / Range 확인 N개 206
      (공개를 요청받지 않았으면 "올리지 않음 — 요청 없음" 이라고 적는다)

이상 징후: (없으면 "없음")
```

## 지켜야 할 것

- **소리와 자막이 맞는지는 판단하지 않는다.** 검증할 수 있는 것은 "문장 수가 맞고 주소가
  제대로 박혔다"까지다. 이 선을 넘어 보고하지 않는다. 실제 정렬은 사용자가 들어야 한다.
- 실패한 회차가 있으면 조용히 넘기지 말고 폴더 이름과 오류 메시지를 그대로 보고한다.
- 내려받은 폴더(`~/Downloads/lang-study/`)는 **읽기 전용**이다. 지우거나 옮기지 않는다.
- `docs/audio/shows/` 에 **mp3 를 손으로 복사해 넣지 않는다.** `publish_shows.py` 를 쓴다
  (로컬 미리보기는 `build_langstudy.py --local-audio`, 그 경로는 gitignore 된다).
- **공개를 요청받지 않았으면 커밋·푸시도, 업로드도 하지 않는다.** 파일만 준비하고 보고한다.
