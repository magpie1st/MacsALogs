/* 일상대화 영어 대본 — 회차 렌더링, 보기 전환(한·영 / English / 한국어 / 말해 보기), 턴 단위 재생 */
(function () {
  'use strict';

  var SPEEDS = [0.75, 0.9, 1.0, 1.15, 1.3];
  var VIEWS = [['both', '한·영'], ['en', 'English'], ['ko', '한국어'], ['quiz', '말해 보기']];
  var STORE = 'comm-prefs';

  var episodes = [];
  var ep = null;
  var turns = [];          // 평탄화된 턴 (재생 순서)
  var audio = new Audio();
  var cur = -1;            // 지금 재생 중인 턴
  var stopAt = null;       // 이 시각에 멈춘다 (턴 하나만 재생할 때)
  var prefs = { view: 'both', speed: 2, step: false, follow: true };
  var el = {};

  function load() {
    try { var p = JSON.parse(localStorage.getItem(STORE) || '{}'); for (var k in p) if (k in prefs) prefs[k] = p[k]; } catch (e) {}
    if (!SPEEDS[prefs.speed]) prefs.speed = 2;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} }

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(s) { if (!isFinite(s) || s < 0) s = 0; var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }

  function speakerMap(e) {
    var m = {};
    (e.speakers || []).forEach(function (s, i) { m[s.id] = { ko: s.ko, en: s.en, slot: 's' + (i % 3) }; });
    return m;
  }

  function render(e) {
    ep = e; turns = []; cur = -1; stopAt = null;
    var sp = speakerMap(e), hasAudio = !!e.audio, h = [];
    h.push('<div class="cm-ep-head"><h2>' + esc(e.title_ko) + '</h2><div class="en">' + esc(e.title_en) + '</div></div>');
    var meta = [e.date];
    if (hasAudio) meta.push('낭독 ' + fmt(e.duration) + ' · ' + esc(e.voice) + ' (' + esc(e.engine) + ')');
    else meta.push('음원 준비 중');
    h.push('<div class="cm-meta">' + meta.join(' · ') + '</div>');
    h.push('<div class="cm-cast">' + (e.speakers || []).map(function (s, i) {
      var v = e.voices && e.voices[s.id] ? ' · 🔊 ' + esc(e.voices[s.id]) : '';
      return '<span class="cm-chip s' + (i % 3) + '">' + esc(s.en) + ' · ' + esc(s.ko) + v + '</span>';
    }).join('') + '</div>');
    if (e.summary) h.push('<p class="cm-summary">' + esc(e.summary) + '</p>');
    if (e.note) h.push('<div class="cm-note">' + esc(e.note) + '</div>');

    h.push('<div class="cm-bar"><div class="cm-seg" id="cm-view">' + VIEWS.map(function (v) {
      return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (prefs.view === v[0]) + '">' + v[1] + '</button>';
    }).join('') + '</div><nav class="cm-toc">' + e.scenes.map(function (s, i) {
      return '<a href="#' + esc(e.id) + '/' + esc(s.id) + '">' + (i + 1) + '. ' + esc(s.title_ko) + '</a>';
    }).join('') + '</nav></div>');

    e.scenes.forEach(function (s, si) {
      h.push('<section class="cm-scene" id="' + esc(s.id) + '"><div class="cm-scene-head"><h3>' + (si + 1) + '. ' + esc(s.title_ko) +
        '</h3><span class="en">' + esc(s.title_en) + '</span>' +
        (hasAudio ? '<button type="button" class="cm-scene-play" data-scene="' + si + '">▶ 장면 듣기</button>' : '') + '</div>');
      s.turns.forEach(function (t) {
        var k = turns.length, who = sp[t.sp] || { en: t.sp, ko: t.sp, slot: 's0' };
        turns.push({ scene: si, start: t.start, end: t.end, sp: who.en, en: t.en });
        h.push('<div class="cm-turn" id="t' + k + '" data-k="' + k + '"><div class="cm-who"><span class="cm-chip ' + who.slot +
          (t.low ? ' low" title="화자 추정 — 녹음에서 화자를 확신할 수 없다' : '') + '">' + esc(who.en.split(' ')[0]) + '</span>' +
          (hasAudio && t.start != null ? '<button type="button" class="cm-play" data-k="' + k + '" aria-label="이 대사 듣기">▶︎</button>' : '') +
          '</div><div class="cm-en">' + esc(t.en) + '</div><div class="cm-ko">' + esc(t.ko) + '</div></div>');
      });
      if (s.expressions && s.expressions.length) {
        h.push('<details class="cm-box"><summary>이 장면의 표현 ' + s.expressions.length + '</summary><table>' +
          s.expressions.map(function (x) {
            return '<tr><td>' + esc(x.ko) + '</td><td><div class="x-en">' + esc(x.en) + '</div>' +
              (x.note ? '<div class="x-note">' + esc(x.note) + '</div>' : '') + '</td></tr>';
          }).join('') + '</table></details>');
      }
      h.push('</section>');
    });

    if (e.cautions && e.cautions.length) {
      h.push('<section class="cm-cautions" id="cautions"><h3>직역하면 어색해지는 말</h3>' +
        '<p>한국어로는 자연스럽지만 그대로 옮기면 뜻이 달라지는 것들.</p>' + e.cautions.map(function (c) {
          return '<div class="cm-card"><div class="k">' + esc(c.ko) + '</div><div class="lit">직역: <s>' + esc(c.literal) + '</s></div>' +
            '<div class="use">' + esc(c.use) + '</div><div class="why">' + esc(c.why) + '</div></div>';
        }).join('') + '</section>');
    }

    el.episode.innerHTML = h.join('');
    document.body.setAttribute('data-view', prefs.view);
    if (hasAudio) {
      audio.src = e.audio; audio.preload = 'metadata'; audio.playbackRate = SPEEDS[prefs.speed];
      el.player.hidden = false; document.body.classList.add('has-player');
      el.total.textContent = fmt(e.duration);
    } else {
      el.player.hidden = true; document.body.classList.remove('has-player');
    }
    updateNow();
  }

  /* ── 재생 ── */
  function turnAt(t) {
    for (var i = turns.length - 1; i >= 0; i--) if (turns[i].start != null && turns[i].start <= t + 0.05) return i;
    return -1;
  }
  function mark(k) {
    if (k === cur) return;
    var old = document.querySelector('.cm-turn.playing');
    if (old) old.classList.remove('playing');
    cur = k;
    var n = k >= 0 ? document.getElementById('t' + k) : null;
    if (n) {
      n.classList.add('playing');
      if (prefs.follow && !audio.paused) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    updateNow();
  }
  function updateNow() {
    var t = turns[cur];
    el.now.textContent = t ? (ep.scenes[t.scene].title_ko + ' — ' + t.sp + ': ' + t.en) : (ep ? ep.title_en : '');
  }
  function playTurn(k, only) {
    var t = turns[k];
    if (!t || t.start == null) return;
    stopAt = only || prefs.step ? t.end + 0.05 : null;
    audio.currentTime = t.start;
    mark(k);
    audio.play().catch(function () {});
  }
  function playScene(si) {
    var k = turns.findIndex(function (t) { return t.scene === si; });
    if (k >= 0) playTurn(k, false);
  }
  function tick() {
    var t = audio.currentTime;
    if (stopAt != null && t >= stopAt) {
      audio.pause(); stopAt = null;
    }
    var k = turnAt(t);
    if (k !== cur) {
      // 한 턴씩: 다음 턴으로 넘어가기 직전에 멈춘다
      if (prefs.step && cur >= 0 && k > cur && !audio.paused) { audio.pause(); audio.currentTime = turns[cur].end; return; }
      mark(k);
    }
    if (!seeking && ep && ep.duration) {
      el.seek.value = Math.round(t / ep.duration * 1000);
      el.elapsed.textContent = fmt(t);
    }
  }
  var seeking = false, raf = 0;
  function loop() { tick(); if (!audio.paused) raf = requestAnimationFrame(loop); }

  function bind() {
    audio.addEventListener('play', function () { el.toggle.textContent = '❚❚'; el.toggle.setAttribute('aria-label', '일시정지'); cancelAnimationFrame(raf); loop(); });
    audio.addEventListener('pause', function () { el.toggle.textContent = '▶︎'; el.toggle.setAttribute('aria-label', '재생'); tick(); });
    audio.addEventListener('timeupdate', function () { if (audio.paused) tick(); });

    el.episode.addEventListener('click', function (ev) {
      var b = ev.target.closest('.cm-play');
      if (b) { playTurn(+b.dataset.k, true); return; }
      var sc = ev.target.closest('.cm-scene-play');
      if (sc) { playScene(+sc.dataset.scene); return; }
      var v = ev.target.closest('#cm-view button');
      if (v) {
        prefs.view = v.dataset.view; save();
        document.body.setAttribute('data-view', prefs.view);
        document.querySelectorAll('#cm-view button').forEach(function (x) { x.setAttribute('aria-pressed', x === v); });
        document.querySelectorAll('.cm-en.shown').forEach(function (x) { x.classList.remove('shown'); });
        return;
      }
      var en = ev.target.closest('.cm-en');
      if (en && prefs.view === 'quiz') {
        en.classList.toggle('shown');
        var row = en.closest('.cm-turn');
        if (en.classList.contains('shown') && row && ep.audio) playTurn(+row.dataset.k, true);
      }
    });

    el.toggle.addEventListener('click', function () {
      if (!audio.paused) { audio.pause(); return; }
      if (prefs.step) {
        // 멈춘 곳이 턴 끝이면 다음 턴, 아니면 지금 턴을 이어서
        var k = cur < 0 ? 0 : cur, t = turns[k];
        if (t && audio.currentTime >= t.end - 0.05) k = Math.min(k + 1, turns.length - 1);
        playTurn(k, true); return;
      }
      stopAt = null; audio.play().catch(function () {});
    });
    el.prev.addEventListener('click', function () { playTurn(Math.max(0, (cur < 0 ? 0 : cur) - 1), prefs.step); });
    el.next.addEventListener('click', function () { playTurn(Math.min(turns.length - 1, cur + 1), prefs.step); });
    el.again.addEventListener('click', function () { playTurn(cur < 0 ? 0 : cur, true); });
    el.speed.addEventListener('click', function () {
      prefs.speed = (prefs.speed + 1) % SPEEDS.length; audio.playbackRate = SPEEDS[prefs.speed]; save(); paintBtns();
    });
    el.step.addEventListener('click', function () { prefs.step = !prefs.step; save(); paintBtns(); });
    el.follow.addEventListener('click', function () { prefs.follow = !prefs.follow; save(); paintBtns(); });
    el.seek.addEventListener('input', function () { seeking = true; el.elapsed.textContent = fmt(el.seek.value / 1000 * ep.duration); });
    el.seek.addEventListener('change', function () { seeking = false; stopAt = null; audio.currentTime = el.seek.value / 1000 * ep.duration; tick(); });

    window.addEventListener('hashchange', route);
  }
  function paintBtns() {
    el.speed.textContent = SPEEDS[prefs.speed] + '×';
    el.step.setAttribute('aria-pressed', prefs.step);
    el.follow.setAttribute('aria-pressed', prefs.follow);
  }

  function route() {
    var parts = decodeURIComponent(location.hash.slice(1)).split('/');
    var e = episodes.find(function (x) { return x.id === parts[0]; }) || episodes[0];
    if (!e) return;
    if (e !== ep) { audio.pause(); render(e); if (el.select) el.select.value = e.id; }
    if (parts[1]) { var s = document.getElementById(parts[1]); if (s) s.scrollIntoView(); }
  }

  function init() {
    ['episode', 'pick', 'player', 'now', 'seek', 'elapsed', 'total', 'step', 'prev', 'toggle', 'next', 'again', 'speed', 'follow']
      .forEach(function (k) { el[k] = document.getElementById('cm-' + k); });
    load(); paintBtns();
    try { episodes = JSON.parse(document.getElementById('comm-data').textContent).episodes || []; } catch (e) { episodes = []; }
    if (!episodes.length) { el.episode.innerHTML = '<div class="empty-state"><p>아직 올린 대본이 없습니다.</p></div>'; return; }
    if (episodes.length > 1) {
      el.pick.hidden = false;
      el.pick.innerHTML = '<select aria-label="회차 선택">' + episodes.map(function (e) {
        return '<option value="' + esc(e.id) + '">' + esc(e.date) + ' · ' + esc(e.title_ko) + '</option>';
      }).join('') + '</select>';
      el.select = el.pick.querySelector('select');
      el.select.addEventListener('change', function () { location.hash = el.select.value; });
    }
    bind();
    route();
  }

  init();
})();
