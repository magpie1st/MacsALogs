/* TVShow 스크립트 페이지 — 에피소드 선택 + 본문 검색 + 글자 크기 + 맨 위로
   오디오가 있는 회차(현재 Episode 1)는 문장 단위로 동기화되는 플레이어를 함께 띄운다. */
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
  var episodes = [];
  var current = null;
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
    } catch (e) { /* 시크릿 모드 등: 기본값 사용 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        fontIndex: fontIndex, rate: rate, follow: follow
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
  function renderStats() {
    var available = episodes.length;
    var planned = data.plannedEpisodes || available;
    var words = episodes.reduce(function (sum, ep) { return sum + ep.wordCount; }, 0);

    var chips = ['에피소드 ' + available + '/' + planned + '편', '총 ' + words.toLocaleString('en-US') + ' words'];
    if (data.lang) chips.push(data.lang === 'en' ? '영어 스크립트' : data.lang);
    if (data.generated) chips.push('갱신 ' + data.generated);

    el.stats.innerHTML = chips.map(function (s) {
      return '<span class="tv-stat">' + escapeHtml(s) + '</span>';
    }).join('');
  }

  function renderEpisodeOptions() {
    var planned = data.plannedEpisodes || episodes.length;
    var total = Math.max(planned, episodes.length);
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
        html += '<option value="" disabled>Episode ' + n + ' · 준비 중</option>';
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
      html += '<p class="tv-episode-audio">🔊 낭독 ' + escapeHtml(formatTime(current.audio.durationSec)) +
              ' · 문장 ' + current.audio.segmentCount.toLocaleString('en-US') + '개 · ' +
              escapeHtml(current.audio.voice || '') +
              '<br /><span class="tv-episode-audio-hint">문장을 누르면 그 지점부터 재생됩니다. 기계 합성 음성입니다.</span></p>';
    }
    html += '</header>';

    current.scenes.forEach(function (scene) {
      html += '<section class="tv-scene" aria-label="장면 ' + scene.n + '">';
      html += '<h3 class="tv-scene-no">장면 ' + scene.n + '</h3>';
      scene.lines.forEach(function (line, order) {
        var kind = line.kind === 'narration' || line.kind === 'note' ? line.kind : 'dialogue';
        var ids = segByLine[scene.n + '|' + (order + 1)];
        var body = (ids && ids.length) ? renderLineWithSegments(line, ids) : highlight(line.text);
        html += '<p class="tv-line tv-line--' + kind + '">' + body + '</p>';
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

    if (updateHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + ep.id);
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
    el.episode.addEventListener('change', function () {
      if (el.episode.value) selectEpisode(el.episode.value, true);
    });

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

    // 데스크톱 편의: '/' 로 검색창에 바로 들어간다
    document.addEventListener('keydown', function (event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFormField(event.target)) return;
      event.preventDefault();
      el.search.focus();
      el.search.select();
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

    episodes = (data.episodes || []).slice().sort(function (a, b) { return a.number - b.number; });
    if (!episodes.length) {
      scriptEl.innerHTML = '<div class="empty-state"><p>아직 등록된 에피소드가 없습니다.</p></div>';
      return;
    }

    el = {
      series: document.getElementById('tv-series'),
      seriesKo: document.getElementById('tv-series-ko'),
      stats: document.getElementById('tv-stats'),
      episode: document.getElementById('tv-episode'),
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

    if (data.series) {
      el.series.textContent = data.series;
      document.title = data.series + ' 스크립트 — MacsALogs';
    }
    if (data.seriesKo) el.seriesKo.textContent = data.seriesKo;

    loadPrefs();
    applyFont();
    if (el.rate) el.rate.value = String(rate);
    if (el.follow) el.follow.checked = follow;
    renderStats();
    renderEpisodeOptions();

    // 해시로 들어온 회차가 있으면 그 회차를, 없으면 첫 회차(Episode 1)를 바로 보여 준다
    var hashId = window.location.hash.replace('#', '');
    selectEpisode(findEpisode(hashId) ? hashId : episodes[0].id, false);

    bind();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
