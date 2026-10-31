/* TVShow 스크립트 페이지 — 작품·시즌·회차 선택 + 본문 검색 + 글자 크기 + 맨 위로
   오디오가 있는 회차는 문장 단위로 동기화되는 플레이어를 함께 띄운다.

   작품은 음원 출처로 두 종류다.
     kind: 'tts'        기계 합성 낭독 (book-maker 대본 + tts-maker 음성)
     kind: 'recording'  실제 방송 녹음 (lang-study 확장이 Netflix·쿠팡플레이에서 녹음)
   녹음 작품은 줄마다 한국어 자막(line.ko)이 붙고, 녹음이 빈 문장에 line.silent 가 붙는다.

   모양으로도 두 종류다.
     type: 'series'     시즌·회차가 있다
     type: 'movie'      회차 하나(feature)뿐이다 — 시즌·회차 선택과 회차 이동을 숨긴다
   영화도 회차 하나에 담는 이유는 본문 그리기·문장 강조 경로를 공유하기 위해서다.

   '이전/다음 에피소드'(상단 도구모음)와 '이전/다음 문장'(하단 플레이어)은 다른 것이다.
   말풍선·아이콘·위치를 모두 다르게 둔 이유가 그것이다. */
(function () {
  'use strict';

  var FONT_STEPS = [0.85, 0.95, 1.0, 1.1, 1.25, 1.45, 1.65];
  var DEFAULT_FONT = 2;
  var STORE_KEY = 'tvshow-prefs';
  var SEARCH_DELAY = 150;   // 타이핑 중 재렌더가 과하게 일어나지 않도록
  var TOP_AT = 400;         // 이만큼 내려가면 '맨 위로' 버튼을 띄운다

  var RATES = [0.75, 1, 1.25, 1.5];
  var SKIP_SECONDS = 10;
  /* 손으로 스크롤한 뒤 이만큼은 자동 추적을 멈춘다. 읽던 자리를 뺏기지 않게 하려는 것이다. */
  var FOLLOW_PAUSE_MS = 6000;
  /* scrollIntoView 가 만드는 scroll 이벤트를 사용자의 조작으로 오인하지 않도록 두는 여유 */
  var PROGRAMMATIC_SCROLL_MS = 1200;

  var data = null;
  var shows = [];
  var show = null;         // 지금 보고 있는 작품
  var season = null;       // 그 작품의 지금 시즌
  var episodes = [];       // 그 시즌의 회차 (번호 순)
  var current = null;
  var showKo = true;       // 한국어 자막 표시 (녹음 작품에서만 쓴다)
  var query = '';
  var hits = [];
  var hitIndex = -1;
  var fontIndex = DEFAULT_FONT;
  var hitSeq = 0;
  var searchTimer = null;

  /* 오디오 상태 */
  var audioEl = null;
  var segRows = [];        // [장면, 줄, 문장, 시작ms, 끝ms, 문자시작, 문자끝]
  var segByLine = {};      // "장면|줄" -> 전역 세그먼트 번호 목록
  var segNodes = [];       // 전역 세그먼트 번호 -> 버튼 DOM
  var activeSeg = -1;
  var rate = 1;
  var follow = true;
  var lastUserScrollAt = 0;
  var programmaticUntil = 0;

  var el = {};

  /* ── 환경설정 (저장에 실패해도 페이지는 정상 동작해야 한다) ── */
  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (typeof saved.fontIndex === 'number' && FONT_STEPS[saved.fontIndex]) fontIndex = saved.fontIndex;
      if (RATES.indexOf(saved.rate) !== -1) rate = saved.rate;
      if (typeof saved.follow === 'boolean') follow = saved.follow;
      if (typeof saved.showKo === 'boolean') showKo = saved.showKo;
    } catch (e) { /* 시크릿 모드 등: 기본값 사용 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        fontIndex: fontIndex, rate: rate, follow: follow, showKo: showKo
      }));
    } catch (e) { /* 저장 실패는 무시 */ }
  }

  /* ── 유틸 ── */
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* keydown 의 target 은 document 처럼 matches() 가 없는 노드일 수도 있어 형(type)부터 확인한다 */
  function isFormField(node) {
    return !!node && typeof node.matches === 'function' && node.matches('input, textarea, select');
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var whole = Math.floor(seconds);
    var m = Math.floor(whole / 60);
    var s = whole % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* 검색어에 걸린 부분만 <mark>로 감싼다. 이스케이프는 조각 단위로 해야 태그가 깨지지 않는다. */
  function highlight(text) {
    if (!query) return escapeHtml(text);

    var lower = String(text).toLowerCase();
    var needle = query.toLowerCase();
    var out = '';
    var from = 0;
    var at = lower.indexOf(needle);

    while (at !== -1) {
      out += escapeHtml(text.slice(from, at));
      out += '<mark class="tv-hit" id="tv-hit-' + hitSeq + '">' +
             escapeHtml(text.slice(at, at + needle.length)) + '</mark>';
      hitSeq++;
      from = at + needle.length;
      at = lower.indexOf(needle, from);
    }
    return out + escapeHtml(text.slice(from));
  }

  /* ── 렌더링 ── */
  /* 예전 형식(작품 하나, 시즌 없음)도 받는다. 생성기가 둘이라 한쪽만 돌린 블록이
     올라올 수 있고, 그때도 페이지는 돌아가야 한다. */
  function normalizeShows(payload) {
    if (payload.shows && payload.shows.length) return payload.shows;
    if (payload.episodes && payload.episodes.length) {
      return [{
        id: 'default',
        title: payload.series,
        titleKo: payload.seriesKo,
        lang: payload.lang,
        kind: 'tts',
        seasons: [{
          number: 1,
          plannedEpisodes: payload.plannedEpisodes,
          episodes: payload.episodes
        }]
      }];
    }
    return [];
  }

  function findShow(id) {
    for (var i = 0; i < shows.length; i++) {
      if (shows[i].id === id) return shows[i];
    }
    return null;
  }

  function seasonsOf(s) {
    return (s && s.seasons ? s.seasons : []).slice().sort(function (a, b) {
      return (a.number || 0) - (b.number || 0);
    });
  }

  function findSeason(s, number) {
    var list = seasonsOf(s);
    for (var i = 0; i < list.length; i++) {
      if (list[i].number === number) return list[i];
    }
    return list[0] || null;
  }

  function hasKo() {
    return Boolean(show && show.hasKo);
  }

  function isMovie() {
    return Boolean(show && show.type === 'movie');
  }

  /* 시즌 칸을 보여 줄지. 시즌이 여럿이면 당연히 보여 주고, 하나뿐이어도 그 번호가 1이
     아니면 보여 준다 — "시즌 5 1화"는 시즌 번호 자체가 정보다. */
  function seasonsWorthShowing() {
    if (isMovie()) return false;   // 영화에는 시즌이 없다
    var list = seasonsOf(show);
    return list.length > 1 || (list.length === 1 && list[0].number !== 1);
  }

  function renderStats() {
    var available = episodes.length;
    var planned = (season && season.plannedEpisodes) || available;
    var words = episodes.reduce(function (sum, ep) { return sum + (ep.wordCount || 0); }, 0);

    var chips = [];
    if (isMovie()) {
      chips.push('영화');
    } else {
      if (seasonsWorthShowing() && season) chips.push('시즌 ' + season.number);
      chips.push('에피소드 ' + available + '/' + planned + '편');
    }
    chips.push('총 ' + words.toLocaleString('en-US') + ' words');
    chips.push(show && show.kind === 'recording' ? '방송 녹음' : '기계 합성 낭독');
    if (hasKo()) chips.push('한국어 자막');
    var lang = (show && show.lang) || data.lang;
    if (lang) chips.push(lang === 'en' ? '영어 스크립트' : lang);
    var generated = (show && show.generated) || data.generated;
    if (generated) chips.push('갱신 ' + generated);

    el.stats.innerHTML = chips.map(function (s) {
      return '<span class="tv-stat">' + escapeHtml(s) + '</span>';
    }).join('');
  }

  function renderHero() {
    if (!show) return;
    var name = show.title || show.id;
    el.series.textContent = name;
    document.title = name + ' 스크립트 — MacsALogs';
    if (el.seriesKo) el.seriesKo.textContent = show.titleKo || '';

    if (!el.heroSub) return;
    var tail = show.kind === 'recording'
      ? '방송 음성을 녹음해 자막 문장과 맞춰 둔 개인 학습용 페이지입니다.'
        + ' 문장을 누르면 그 지점부터 실제 음성이 재생되고, 영어 아래에 한국어 자막이 함께 나옵니다.'
      : '영어 스크립트를 에피소드별로 읽는 개인 학습용 페이지입니다.'
        + ' 기울임체는 내레이션, [대괄호]는 지문이고, 가로선은 장면이 바뀌는 지점입니다.';
    tail += isMovie()
      ? ' 위에서 작품을 고르고, 본문 검색과 글자 크기로 읽기 편하게 맞춰 보세요.'
      : ' 아래에서 작품과 회차를 고르고, 본문 검색과 글자 크기로 읽기 편하게 맞춰 보세요.';
    // 보조 제목(titleKo)이 있을 때만 앞에 굵게 붙인다. 없으면 빈 strong 때문에 앞에 빈칸이 생긴다.
    var lead = show.titleKo
      ? '<strong id="tv-series-ko">' + escapeHtml(show.titleKo) + '</strong> '
      : '<strong id="tv-series-ko" hidden></strong>';
    el.heroSub.innerHTML = lead + escapeHtml(tail);
    el.seriesKo = document.getElementById('tv-series-ko');
  }

  function renderShowOptions() {
    var option = function (s) {
      var mark = s.kind === 'recording' ? ' · 녹음' : '';
      return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml((s.title || s.id) + mark) + '</option>';
    };
    var series = shows.filter(function (s) { return s.type !== 'movie'; });
    var movies = shows.filter(function (s) { return s.type === 'movie'; });
    // 한쪽만 있으면 묶음 제목이 군더더기다
    el.show.innerHTML = (series.length && movies.length)
      ? '<optgroup label="시리즈">' + series.map(option).join('') + '</optgroup>'
        + '<optgroup label="영화">' + movies.map(option).join('') + '</optgroup>'
      : shows.map(option).join('');
    if (show) el.show.value = show.id;
    // 작품이 하나뿐이면 고를 것이 없다
    if (el.showField) el.showField.hidden = shows.length < 2;
  }

  function renderSeasonOptions() {
    var list = seasonsOf(show);
    el.season.innerHTML = list.map(function (s) {
      return '<option value="' + s.number + '">시즌 ' + s.number + '</option>';
    }).join('');
    if (season) el.season.value = String(season.number);
    if (el.seasonField) el.seasonField.hidden = !seasonsWorthShowing();
  }

  function renderEpisodeOptions() {
    if (el.episodeField) el.episodeField.hidden = isMovie();   // 고를 회차가 하나뿐이다
    var planned = (season && season.plannedEpisodes) || 0;
    // 회차 번호가 planned 보다 클 수 있다 (3화만 먼저 녹음한 경우). 그 회차가 목록에서
    // 사라지면 고를 수 없으므로 가장 큰 번호까지 칸을 만든다.
    var highest = episodes.reduce(function (max, ep) { return Math.max(max, ep.number || 0); }, 0);
    var total = Math.max(planned, episodes.length, highest);
    var html = '';

    for (var n = 1; n <= total; n++) {
      var ep = null;
      for (var i = 0; i < episodes.length; i++) {
        if (episodes[i].number === n) { ep = episodes[i]; break; }
      }
      if (ep) {
        var mark = ep.audio ? ' · 오디오' : '';
        html += '<option value="' + escapeHtml(ep.id) + '">' + escapeHtml(ep.title + mark) + '</option>';
      } else {
        // 아직 원본이 없는 회차도 목록에 남겨 둬야 어디까지 준비됐는지 바로 보인다
        html += '<option value="" disabled>' + n + '화 · 준비 중</option>';
      }
    }
    el.episode.innerHTML = html;
  }

  function episodeMeta(ep) {
    var parts = ['장면 ' + ep.sceneCount + '개', '대사 ' + ep.lineCount + '줄', ep.wordCount.toLocaleString('en-US') + ' words'];
    return parts.join(' · ');
  }

  /* 한 줄을 문장 버튼들로 쪼갠다. 버튼 사이의 공백은 버튼 **밖에** 두어야
     원문이 그대로 복원되고 줄바꿈도 자연스럽다. */
  function renderLineWithSegments(line, ids) {
    var html = '';
    for (var k = 0; k < ids.length; k++) {
      var row = segRows[ids[k]];
      var raw = line.text.slice(row[5], row[6]);
      var trimmed = raw.trim();
      if (!trimmed) { html += escapeHtml(raw); continue; }
      var lead = raw.indexOf(trimmed);

      html += escapeHtml(raw.slice(0, lead));
      html += '<button type="button" class="tv-seg" data-seg="' + ids[k] + '">' +
              highlight(trimmed) + '</button>';
      html += escapeHtml(raw.slice(lead + trimmed.length));
    }
    return html;
  }

  function renderEpisode() {
    if (!current) return;
    hitSeq = 0;

    var html = '<header class="tv-episode-head">';
    html += '<h2 class="tv-episode-title" id="tv-episode-title">' + escapeHtml(current.title) + '</h2>';
    html += '<p class="tv-episode-meta">' + escapeHtml(episodeMeta(current)) + '</p>';
    if (current.truncated) {
      html += '<p class="tv-episode-note">이 페이지에는 전체 ' + current.totalScenes +
              '개 장면 중 앞부분 ' + current.sceneCount + '개만 실려 있습니다.</p>';
    }
    if (current.audio) {
      var recording = show && show.kind === 'recording';
      var label = recording ? '🔊 녹음 ' : '🔊 낭독 ';
      var source = recording ? '방송 음성' : escapeHtml(current.audio.voice || '기계 합성 음성');
      html += '<p class="tv-episode-audio">' + label + escapeHtml(formatTime(current.audio.durationSec)) +
              ' · 문장 ' + current.audio.segmentCount.toLocaleString('en-US') + '개 · ' + source;
      // 녹음에 빈 구간이 있으면 알려 준다. 안 보고 지나간 장면은 소리가 없다
      if (recording && typeof current.audio.coverage === 'number' && current.audio.coverage < 0.995) {
        html += ' · 녹음된 구간 ' + Math.round(current.audio.coverage * 100) + '%';
      }
      html += '<br /><span class="tv-episode-audio-hint">문장을 누르면 그 지점부터 재생됩니다.' +
              (recording ? ' 녹음이 없는 문장은 흐리게 보입니다.' : ' 기계 합성 음성입니다.') +
              '</span>';
      // --local-audio 로 만든 빌드. 배포하면 소리가 안 나므로 화면에서 바로 보이게 둔다
      if (current.audio.preview) {
        html += '<br /><span class="tv-episode-audio-warn">로컬 미리보기 음원입니다. ' +
                '이 상태로 배포하면 소리가 나지 않습니다.</span>';
      }
      html += '</p>';
    }
    html += '</header>';

    current.scenes.forEach(function (scene) {
      html += '<section class="tv-scene" aria-label="장면 ' + scene.n + '">';
      html += '<h3 class="tv-scene-no">장면 ' + scene.n + '</h3>';
      scene.lines.forEach(function (line, order) {
        var kind = line.kind === 'narration' || line.kind === 'note' ? line.kind : 'dialogue';
        var ids = segByLine[scene.n + '|' + (order + 1)];
        var body = (ids && ids.length) ? renderLineWithSegments(line, ids) : highlight(line.text);
        // 녹음이 없는 문장은 흐리게. 대본에서 빼지는 않는다 — 읽을 때 대사가 비면 흐름이 끊긴다
        var cls = 'tv-line tv-line--' + kind + (line.silent ? ' tv-line--silent' : '');
        html += '<p class="' + cls + '">' + body + '</p>';
        // 한국어 자막은 영어 줄 바로 아래. 검색(highlight)은 영어만 걸린다
        if (line.ko && showKo) {
          html += '<p class="tv-line-ko">' + escapeHtml(line.ko) + '</p>';
        }
      });
      html += '</section>';
    });

    el.script.innerHTML = html;
    collectSegNodes();
    paintActive();
    collectHits();
  }

  /* ── 검색 ── */
  function collectHits() {
    hits = Array.prototype.slice.call(el.script.querySelectorAll('mark.tv-hit'));
    hitIndex = hits.length ? 0 : -1;
    updateHitState(false);
  }

  function updateHitState(scroll) {
    var disabled = hits.length < 2;
    el.prev.disabled = disabled;
    el.next.disabled = disabled;

    var marked = el.script.querySelector('mark.is-current');
    if (marked) marked.classList.remove('is-current');

    if (!query) {
      el.count.textContent = '';
      el.count.classList.remove('is-empty');
      return;
    }
    if (!hits.length) {
      el.count.textContent = '"' + query + '" 검색 결과 없음';
      el.count.classList.add('is-empty');
      return;
    }

    el.count.classList.remove('is-empty');
    el.count.textContent = '검색 결과 ' + hits.length + '개 중 ' + (hitIndex + 1) + '번째';

    var target = hits[hitIndex];
    if (target) {
      target.classList.add('is-current');
      if (scroll) scrollTo(target);
    }
  }

  function moveHit(step) {
    if (!hits.length) return;
    hitIndex = (hitIndex + step + hits.length) % hits.length;
    updateHitState(true);
  }

  function applySearch(value) {
    query = value.trim();
    renderEpisode();
    if (query && hits.length) updateHitState(true);
  }

  /* ── 글자 크기 ── */
  function applyFont() {
    var scale = FONT_STEPS[fontIndex];
    el.script.style.setProperty('--tv-font-scale', String(scale));
    el.fontValue.textContent = Math.round(scale * 100) + '%';
    el.fontDown.disabled = fontIndex === 0;
    el.fontUp.disabled = fontIndex === FONT_STEPS.length - 1;
  }

  function stepFont(step) {
    var next = Math.min(FONT_STEPS.length - 1, Math.max(0, fontIndex + step));
    if (next === fontIndex) return;
    fontIndex = next;
    applyFont();
    savePrefs();
  }

  /* ── 스크롤 ── */
  function scrollTo(node) {
    programmaticUntil = Date.now() + PROGRAMMATIC_SCROLL_MS;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* 화면 한가운데 근처에 있으면 굳이 움직이지 않는다. 문장마다 스크롤하면 읽기가 어렵다.
     아래쪽 경계를 넉넉히 잡은 것은 고정 플레이어가 화면 하단을 가리기 때문이다. */
  function needsScroll(node) {
    var box = node.getBoundingClientRect();
    return box.top < window.innerHeight * 0.15 || box.bottom > window.innerHeight * 0.68;
  }

  function shouldFollow() {
    return follow && Date.now() - lastUserScrollAt > FOLLOW_PAUSE_MS;
  }

  /* ── 오디오: 세그먼트 색인 ── */
  function indexSegments() {
    segByLine = {};
    for (var i = 0; i < segRows.length; i++) {
      var key = segRows[i][0] + '|' + segRows[i][1];
      if (!segByLine[key]) segByLine[key] = [];
      segByLine[key].push(i);
    }
  }

  function collectSegNodes() {
    segNodes = [];
    var nodes = el.script.querySelectorAll('.tv-seg');
    for (var i = 0; i < nodes.length; i++) {
      segNodes[parseInt(nodes[i].getAttribute('data-seg'), 10)] = nodes[i];
    }
  }

  /* 검색 등으로 본문을 다시 그린 뒤 현재 문장 표시를 되살린다 */
  function paintActive() {
    if (activeSeg < 0 || !segNodes[activeSeg]) return;
    segNodes[activeSeg].classList.add('is-active');
    segNodes[activeSeg].setAttribute('aria-current', 'true');
  }

  /* 시각(ms)에 해당하는 세그먼트를 이분 탐색한다. 무음 구간이면 직전 문장을 그대로 둔다. */
  function findSegment(ms) {
    if (!segRows.length) return -1;
    if (ms < segRows[0][3]) return 0;
    var low = 0;
    var high = segRows.length - 1;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (segRows[mid][3] <= ms) low = mid; else high = mid - 1;
    }
    return low;
  }

  function segmentText(i) {
    var row = segRows[i];
    if (!row || !current) return '';
    var scene = null;
    for (var s = 0; s < current.scenes.length; s++) {
      if (current.scenes[s].n === row[0]) { scene = current.scenes[s]; break; }
    }
    var line = scene && scene.lines[row[1] - 1];
    return line ? line.text.slice(row[5], row[6]).trim() : '';
  }

  /* 강조를 무조건 지운다. setActive(-1) 은 이미 -1 일 때 되돌아가므로 초기화에는 못 쓴다. */
  function clearActive() {
    if (activeSeg >= 0 && segNodes[activeSeg]) {
      segNodes[activeSeg].classList.remove('is-active');
      segNodes[activeSeg].removeAttribute('aria-current');
    }
    activeSeg = -1;
    el.now.textContent = '—';
  }

  function setActive(i, allowScroll) {
    if (i === activeSeg) return;
    if (activeSeg >= 0 && segNodes[activeSeg]) {
      segNodes[activeSeg].classList.remove('is-active');
      segNodes[activeSeg].removeAttribute('aria-current');
    }
    activeSeg = i;
    paintActive();

    el.now.textContent = i >= 0 ? segmentText(i) : '—';
    if (allowScroll && i >= 0 && segNodes[i] && shouldFollow() && needsScroll(segNodes[i])) {
      scrollTo(segNodes[i]);
    }
  }

  /* ── 오디오: 재생 제어 ── */
  function duration() {
    if (audioEl && isFinite(audioEl.duration) && audioEl.duration > 0) return audioEl.duration;
    return (current && current.audio) ? current.audio.durationSec : 0;
  }

  function updateProgress() {
    if (!audioEl) return;
    el.seek.value = String(audioEl.currentTime);
    el.timeNow.textContent = formatTime(audioEl.currentTime);
  }

  function updatePlayButton() {
    var playing = audioEl && !audioEl.paused;
    el.play.textContent = playing ? '일시정지' : '재생';
    el.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
  }

  function seekToSegment(i, keepPlaying) {
    if (!audioEl || !segRows[i]) return;
    audioEl.currentTime = segRows[i][3] / 1000;
    setActive(i, true);
    updateProgress();
    if (keepPlaying && audioEl.paused) {
      audioEl.play().catch(function () { /* 자동재생 차단 등은 무시 */ });
    }
  }

  function stepSegment(delta) {
    if (!audioEl || !segRows.length) return;
    var base = activeSeg >= 0 ? activeSeg : findSegment(audioEl.currentTime * 1000);
    var next = Math.min(segRows.length - 1, Math.max(0, base + delta));
    seekToSegment(next, !audioEl.paused);
  }

  function skip(seconds) {
    if (!audioEl) return;
    audioEl.currentTime = Math.min(duration(), Math.max(0, audioEl.currentTime + seconds));
    updateProgress();
  }

  function togglePlay() {
    if (!audioEl) return;
    if (audioEl.paused) audioEl.play().catch(function () { /* 무시 */ });
    else audioEl.pause();
  }

  /* 회차를 바꿀 때마다 부른다. 오디오가 없는 회차에서는 완전히 멈추고 플레이어를 감춘다. */
  function setupAudio() {
    if (!audioEl) return;

    audioEl.pause();
    clearActive();

    if (!current || !current.audio) {
      segRows = [];
      segByLine = {};
      segNodes = [];
      el.player.hidden = true;
      document.body.classList.remove('has-tv-player');
      audioEl.removeAttribute('src');
      audioEl.load();   // 남은 버퍼까지 버려야 다른 회차에서 소리가 새지 않는다
      updatePlayButton();
      return;
    }

    el.player.hidden = false;
    document.body.classList.add('has-tv-player');
    audioEl.src = current.audio.file;
    audioEl.playbackRate = rate;
    audioEl.currentTime = 0;
    el.seek.max = String(current.audio.durationSec);
    el.seek.value = '0';
    el.timeNow.textContent = '0:00';
    el.timeTotal.textContent = formatTime(current.audio.durationSec);
    // currentTime 대입이 timeupdate 를 일으켜 첫 문장이 강조될 수 있다.
    // 아직 재생을 누르지 않았으므로 마지막에 한 번 더 비운다.
    clearActive();
    updatePlayButton();
  }

  /* ── 에피소드 전환 ── */
  function findEpisode(id) {
    for (var i = 0; i < episodes.length; i++) {
      if (episodes[i].id === id) return episodes[i];
    }
    return null;
  }

  /* 준비된 회차들 안에서의 위치. '준비 중' 회차는 목록에 없으므로 건너뛰어 이동한다. */
  function currentIndex() {
    return current ? episodes.indexOf(current) : -1;
  }

  function updateEpisodeNav() {
    if (!el.epPrev || !el.epNext) return;
    if (isMovie()) {
      // 넘길 회차가 없다. 버튼을 남겨 두면 눌러도 아무 일이 없어 고장처럼 보인다
      el.epPrev.hidden = el.epNext.hidden = true;
      if (el.epStatus) el.epStatus.textContent = '';
      return;
    }
    el.epPrev.hidden = el.epNext.hidden = false;
    var i = currentIndex();
    el.epPrev.disabled = i <= 0;
    el.epNext.disabled = i < 0 || i >= episodes.length - 1;
    if (el.epStatus) {
      el.epStatus.textContent = i < 0 ? '' :
        (i + 1) + ' / ' + episodes.length + '편';
    }
  }

  /* 주소 해시는 `#<작품>/<회차>` 다. 작품 id 에 한글이 올 수 있는데(`#에밀리-파리에-가다`)
     브라우저는 `location.hash` 를 퍼센트 인코딩으로 준다 — 비교하기 전에 풀어야 한다.
     예전 주소(`#ep01`)로 들어오면 모든 작품을 훑어 찾는다. */
  function decodeHash(raw) {
    var hash = (raw || '').replace(/^#/, '');
    try {
      return decodeURIComponent(hash);
    } catch (e) {
      return hash;   // `%` 가 홀로 들어간 주소: 그대로 쓴다
    }
  }

  function resolveHash(raw) {
    var hash = decodeHash(raw);
    if (!hash) return null;
    var slash = hash.indexOf('/');
    if (slash > 0) {
      var s = findShow(hash.slice(0, slash));
      if (s) return { show: s, episodeId: hash.slice(slash + 1) };
      return null;
    }
    // `#inception` 처럼 작품 id 만 온 경우 (영화, 또는 작품의 첫 회차)
    var direct = findShow(hash);
    if (direct) return { show: direct, episodeId: null };
    for (var i = 0; i < shows.length; i++) {
      var list = seasonsOf(shows[i]);
      for (var j = 0; j < list.length; j++) {
        var eps = list[j].episodes || [];
        for (var k = 0; k < eps.length; k++) {
          if (eps[k].id === hash) return { show: shows[i], episodeId: hash };
        }
      }
    }
    return null;
  }

  function hashFor(ep) {
    // 한글 id 는 인코딩해 넣는다. 주소창에는 브라우저가 한글로 보여 준다.
    var part = function (text) { return encodeURIComponent(text); };
    if (!show) return '#' + part(ep.id);
    // 영화는 회차가 하나뿐이라 주소에 적을 것이 없다
    return isMovie() ? '#' + part(show.id) : '#' + part(show.id) + '/' + part(ep.id);
  }

  /* 작품을 바꾼다. 시즌·회차는 그 작품의 첫 것으로 떨어진다. */
  function selectShow(id, episodeId, updateHash) {
    var next = findShow(id) || shows[0];
    if (!next) return;
    show = next;
    el.show.value = show.id;
    renderHero();
    renderSeasonOptions();
    syncKoToggle();

    // 회차 id 를 받았으면 그 회차가 있는 시즌으로 간다
    var list = seasonsOf(show);
    var target = list[0] || null;
    if (episodeId) {
      for (var i = 0; i < list.length; i++) {
        var eps = list[i].episodes || [];
        for (var j = 0; j < eps.length; j++) {
          if (eps[j].id === episodeId) { target = list[i]; break; }
        }
      }
    }
    selectSeason(target ? target.number : 1, episodeId, updateHash);
  }

  function selectSeason(number, episodeId, updateHash) {
    season = findSeason(show, number);
    episodes = ((season && season.episodes) || []).slice().sort(function (a, b) {
      return a.number - b.number;
    });
    if (el.season) el.season.value = season ? String(season.number) : '';
    renderSeasonOptions();
    renderEpisodeOptions();
    renderStats();
    if (!episodes.length) {
      current = null;
      el.script.innerHTML = '<div class="empty-state"><p>이 시즌에는 아직 등록된 회차가 없습니다.</p></div>';
      updateEpisodeNav();
      return;
    }
    selectEpisode(findEpisode(episodeId) ? episodeId : episodes[0].id, updateHash);
  }

  function syncKoToggle() {
    if (!el.koField) return;
    el.koField.hidden = !hasKo();
    if (el.koToggle) {
      el.koToggle.textContent = showKo ? '한국어 숨기기' : '한국어 보이기';
      el.koToggle.setAttribute('aria-pressed', String(showKo));
    }
  }

  function toggleKo() {
    if (!hasKo()) return;
    showKo = !showKo;
    savePrefs();
    syncKoToggle();
    renderEpisode();
  }

  function selectEpisode(id, updateHash) {
    var ep = findEpisode(id) || episodes[0];
    if (!ep) return;
    current = ep;
    el.episode.value = ep.id;

    // 회차를 바꾸면 이전 검색어는 의미가 없으므로 비운다
    el.search.value = '';
    query = '';

    // 본문을 그리기 전에 세그먼트 색인이 서 있어야 문장 버튼이 만들어진다
    activeSeg = -1;
    segRows = (ep.audio && ep.audio.segments) || [];
    indexSegments();

    renderEpisode();
    setupAudio();
    updateEpisodeNav();

    if (updateHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', hashFor(ep));
    }
  }

  function scrollToTop() {
    // 우리가 만든 스크롤이므로 '따라가기'를 멈추게 하는 사용자 조작으로 세지 않는다
    programmaticUntil = Date.now() + PROGRAMMATIC_SCROLL_MS;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* 회차를 앞뒤로 넘긴다. `from` 은 이 이동을 일으킨 버튼이다 —
     끝 회차에 닿아 그 버튼이 비활성이 되면 포커스가 body 로 떨어지므로 반대쪽으로 옮긴다. */
  function stepEpisode(step, from) {
    var i = currentIndex();
    if (i < 0) return;
    var next = i + step;
    if (next < 0 || next >= episodes.length) return;

    selectEpisode(episodes[next].id, true);
    scrollToTop();

    if (from && from.disabled) {
      var other = from === el.epPrev ? el.epNext : el.epPrev;
      if (other && !other.disabled) other.focus();
      else if (el.series) el.series.focus();
    }
  }

  /* ── 이벤트 ── */
  function bindPlayer() {
    if (!audioEl) return;

    el.play.addEventListener('click', togglePlay);
    el.back10.addEventListener('click', function () { skip(-SKIP_SECONDS); });
    el.fwd10.addEventListener('click', function () { skip(SKIP_SECONDS); });
    el.segPrev.addEventListener('click', function () { stepSegment(-1); });
    el.segNext.addEventListener('click', function () { stepSegment(1); });

    el.rate.addEventListener('change', function () {
      rate = parseFloat(el.rate.value) || 1;
      audioEl.playbackRate = rate;
      savePrefs();
    });

    el.follow.addEventListener('change', function () {
      follow = el.follow.checked;
      lastUserScrollAt = 0;   // 직접 켠 것이므로 곧바로 따라가게 한다
      savePrefs();
      if (follow && activeSeg >= 0 && segNodes[activeSeg]) scrollTo(segNodes[activeSeg]);
    });

    el.seek.addEventListener('input', function () {
      audioEl.currentTime = parseFloat(el.seek.value) || 0;
      el.timeNow.textContent = formatTime(audioEl.currentTime);
    });

    audioEl.addEventListener('timeupdate', function () {
      updateProgress();
      setActive(findSegment(audioEl.currentTime * 1000), true);
    });
    audioEl.addEventListener('loadedmetadata', function () {
      if (isFinite(audioEl.duration) && audioEl.duration > 0) {
        el.seek.max = String(audioEl.duration);
        el.timeTotal.textContent = formatTime(audioEl.duration);
      }
    });
    audioEl.addEventListener('play', updatePlayButton);
    audioEl.addEventListener('pause', updatePlayButton);
    audioEl.addEventListener('ended', function () {
      updatePlayButton();
      clearActive();
    });
    audioEl.addEventListener('error', function () {
      if (audioEl.getAttribute('src')) el.now.textContent = '오디오를 불러오지 못했습니다.';
    });

    // 본문의 문장을 누르면 그 지점으로 이동한다
    el.script.addEventListener('click', function (event) {
      var node = event.target && event.target.closest ? event.target.closest('.tv-seg') : null;
      if (!node) return;
      seekToSegment(parseInt(node.getAttribute('data-seg'), 10), true);
    });
  }

  function bind() {
    el.show.addEventListener('change', function () {
      selectShow(el.show.value, null, true);
      scrollToTop();
    });

    if (el.season) {
      el.season.addEventListener('change', function () {
        selectSeason(parseInt(el.season.value, 10), null, true);
        scrollToTop();
      });
    }

    if (el.koToggle) el.koToggle.addEventListener('click', toggleKo);

    el.episode.addEventListener('change', function () {
      if (el.episode.value) selectEpisode(el.episode.value, true);
    });

    el.epPrev.addEventListener('click', function () { stepEpisode(-1, el.epPrev); });
    el.epNext.addEventListener('click', function () { stepEpisode(1, el.epNext); });

    el.search.addEventListener('input', function () {
      var value = el.search.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () { applySearch(value); }, SEARCH_DELAY);
    });

    el.search.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.clearTimeout(searchTimer);
        if (el.search.value.trim() !== query) { applySearch(el.search.value); return; }
        moveHit(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        el.search.value = '';
        window.clearTimeout(searchTimer);
        applySearch('');
      }
    });

    el.prev.addEventListener('click', function () { moveHit(-1); });
    el.next.addEventListener('click', function () { moveHit(1); });

    el.fontDown.addEventListener('click', function () { stepFont(-1); });
    el.fontUp.addEventListener('click', function () { stepFont(1); });
    el.fontReset.addEventListener('click', function () {
      fontIndex = DEFAULT_FONT;
      applyFont();
      savePrefs();
    });

    el.top.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      el.series.focus();   // 키보드 사용자가 포커스를 잃지 않도록 맨 위 제목으로 옮긴다
    });

    window.addEventListener('scroll', function () {
      el.top.hidden = window.pageYOffset < TOP_AT;
      // 우리가 만든 스크롤이 아니면 사용자가 읽는 위치를 옮긴 것으로 본다
      if (Date.now() > programmaticUntil) lastUserScrollAt = Date.now();
    }, { passive: true });

    window.addEventListener('hashchange', function () {
      var id = window.location.hash.replace('#', '');
      if (id && findEpisode(id)) selectEpisode(id, false);
    });

    // 데스크톱 편의: '/' 로 검색창에, '[' ']' 로 앞뒤 에피소드로 간다
    document.addEventListener('keydown', function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFormField(event.target)) return;

      if (event.key === '/') {
        event.preventDefault();
        el.search.focus();
        el.search.select();
      } else if (event.key === '[' || event.key === ']') {
        if (isMovie()) return;   // 넘길 회차가 없다
        event.preventDefault();
        stepEpisode(event.key === '[' ? -1 : 1, null);
      } else if (event.key === 'k' || event.key === 'K') {
        if (!hasKo()) return;
        event.preventDefault();
        toggleKo();
      }
    });

    bindPlayer();
  }

  function init() {
    var dataEl = document.getElementById('tvshow-data');
    var scriptEl = document.getElementById('tv-script');
    if (!dataEl || !scriptEl) return;

    try {
      data = JSON.parse(dataEl.textContent);
    } catch (e) {
      scriptEl.innerHTML = '<div class="empty-state"><p>스크립트를 불러올 수 없습니다.</p></div>';
      console.error(e);
      return;
    }

    shows = normalizeShows(data);
    if (!shows.length) {
      scriptEl.innerHTML = '<div class="empty-state"><p>아직 등록된 작품이 없습니다.</p></div>';
      return;
    }

    el = {
      series: document.getElementById('tv-series'),
      seriesKo: document.getElementById('tv-series-ko'),
      heroSub: document.getElementById('tv-hero-sub'),
      stats: document.getElementById('tv-stats'),
      show: document.getElementById('tv-show'),
      showField: document.getElementById('tv-show') && document.getElementById('tv-show').closest('.tv-field'),
      season: document.getElementById('tv-season'),
      seasonField: document.getElementById('tv-season-field'),
      koField: document.getElementById('tv-ko-field'),
      koToggle: document.getElementById('tv-ko-toggle'),
      episode: document.getElementById('tv-episode'),
      episodeField: document.getElementById('tv-episode')
        && document.getElementById('tv-episode').closest('.tv-field'),
      epPrev: document.getElementById('tv-ep-prev'),
      epNext: document.getElementById('tv-ep-next'),
      epStatus: document.getElementById('tv-ep-status'),
      search: document.getElementById('tv-search'),
      count: document.getElementById('tv-search-count'),
      prev: document.getElementById('tv-search-prev'),
      next: document.getElementById('tv-search-next'),
      fontDown: document.getElementById('tv-font-down'),
      fontUp: document.getElementById('tv-font-up'),
      fontValue: document.getElementById('tv-font-value'),
      fontReset: document.getElementById('tv-font-reset'),
      script: scriptEl,
      top: document.getElementById('tv-top'),

      player: document.getElementById('tv-player'),
      now: document.getElementById('tv-player-now'),
      seek: document.getElementById('tv-seek'),
      timeNow: document.getElementById('tv-time-now'),
      timeTotal: document.getElementById('tv-time-total'),
      play: document.getElementById('tv-play'),
      back10: document.getElementById('tv-back10'),
      fwd10: document.getElementById('tv-fwd10'),
      segPrev: document.getElementById('tv-seg-prev'),
      segNext: document.getElementById('tv-seg-next'),
      rate: document.getElementById('tv-rate'),
      follow: document.getElementById('tv-follow')
    };
    audioEl = document.getElementById('tv-audio');

    loadPrefs();
    applyFont();
    if (el.rate) el.rate.value = String(rate);
    if (el.follow) el.follow.checked = follow;

    // 해시로 들어온 작품·회차가 있으면 그것을, 없으면 첫 작품의 첫 회차를 보여 준다
    var target = resolveHash(window.location.hash);
    show = target ? target.show : shows[0];
    renderShowOptions();
    selectShow(show.id, target ? target.episodeId : null, false);

    bind();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
