/* TVShow 스크립트 페이지 — 에피소드 선택 + 본문 검색 + 글자 크기 + 맨 위로 */
(function () {
  'use strict';

  var FONT_STEPS = [0.85, 0.95, 1.0, 1.1, 1.25, 1.45, 1.65];
  var DEFAULT_FONT = 2;
  var STORE_KEY = 'tvshow-prefs';
  var SEARCH_DELAY = 150;   // 타이핑 중 재렌더가 과하게 일어나지 않도록
  var TOP_AT = 400;         // 이만큼 내려가면 '맨 위로' 버튼을 띄운다

  var data = null;
  var episodes = [];
  var current = null;
  var query = '';
  var hits = [];
  var hitIndex = -1;
  var fontIndex = DEFAULT_FONT;
  var hitSeq = 0;
  var searchTimer = null;

  var el = {};

  /* ── 환경설정 (저장에 실패해도 페이지는 정상 동작해야 한다) ── */
  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (typeof saved.fontIndex === 'number' && FONT_STEPS[saved.fontIndex]) fontIndex = saved.fontIndex;
    } catch (e) { /* 시크릿 모드 등: 기본값 사용 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ fontIndex: fontIndex }));
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
        html += '<option value="' + escapeHtml(ep.id) + '">' + escapeHtml(ep.title) + '</option>';
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
    html += '</header>';

    current.scenes.forEach(function (scene) {
      html += '<section class="tv-scene" aria-label="장면 ' + scene.n + '">';
      html += '<h3 class="tv-scene-no">장면 ' + scene.n + '</h3>';
      scene.lines.forEach(function (line) {
        var kind = line.kind === 'narration' || line.kind === 'note' ? line.kind : 'dialogue';
        html += '<p class="tv-line tv-line--' + kind + '">' + highlight(line.text) + '</p>';
      });
      html += '</section>';
    });

    el.script.innerHTML = html;
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
      if (scroll) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    renderEpisode();

    if (updateHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + ep.id);
    }
  }

  /* ── 이벤트 ── */
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
      top: document.getElementById('tv-top')
    };

    if (data.series) {
      el.series.textContent = data.series;
      document.title = data.series + ' 스크립트 — MacsALogs';
    }
    if (data.seriesKo) el.seriesKo.textContent = data.seriesKo;

    loadPrefs();
    applyFont();
    renderStats();
    renderEpisodeOptions();

    // 해시로 들어온 회차가 있으면 그 회차를, 없으면 첫 회차(Episode 1)를 바로 보여 준다
    var hashId = window.location.hash.replace('#', '');
    selectEpisode(findEpisode(hashId) ? hashId : episodes[0].id, false);

    bind();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
