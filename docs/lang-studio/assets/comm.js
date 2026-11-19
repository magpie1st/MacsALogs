// Lang-Studio 일상대화 — 원본은 VoiceLang web/lang-studio/assets/comm.js(옛 MacsALogs docs/js/comm.js). 음원 주소는 LS.url 로 사이트 뿌리 기준.
/* 일상대화 영어 대본 — 목록(#) · 회차(#<id>[/<scene|tN>]) · 표현 복습(#review[/<id>])
 * 회차: 보기 전환(한·영 / English / 한국어 / 말해 보기), 턴 단위 재생
 * 복습: 모든 회차의 장면 표현 + 직역 주의 표현을 카드로. 상자 단계(라이트너)로 간격을 늘린다. 상태는 이 브라우저에만 둔다 */
(function () {
  'use strict';

  var SPEEDS = [0.75, 0.9, 1.0, 1.15, 1.3];
  var VIEWS = [['both', '한·영'], ['en', 'English'], ['ko', '한국어'], ['quiz', '말해 보기']];
  var STORE = 'comm-prefs', REVIEW = 'comm-review';
  var DAY = 86400000, INTERVALS = [0, 1, 3, 7, 14, 30];   // 상자 단계별 다음 복습까지 날짜

  var episodes = [];
  var mode = '';           // list | episode | review
  var ep = null;           // 회차 화면의 회차
  var turns = [];          // 회차 화면의 평탄화된 턴 (재생 순서)
  var audio = new Audio();
  var cur = -1, stopAt = null;
  var prefs = { view: 'both', speed: 2, step: false, follow: true, rvFilter: 'due', rvEp: '' };
  var rv = {};             // 카드 키 → {b: 상자, d: 다음 복습 시각(ms), s: ★}
  var deck = [], pos = 0, shown = false;
  var el = {};

  /* ── 저장 (실패해도 페이지는 동작한다) ── */
  function load() {
    try { var p = JSON.parse(localStorage.getItem(STORE) || '{}'); for (var k in p) if (k in prefs) prefs[k] = p[k]; } catch (e) {}
    try { rv = JSON.parse(localStorage.getItem(REVIEW) || '{}') || {}; } catch (e) { rv = {}; }
    if (!SPEEDS[prefs.speed]) prefs.speed = 2;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} }
  function saveRv() { try { localStorage.setItem(REVIEW, JSON.stringify(rv)); } catch (e) {} }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(s) { if (!isFinite(s) || s < 0) s = 0; var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  function byId(id) { return episodes.find(function (x) { return x.id === id; }); }

  function speakerMap(e) {
    var m = {};
    (e.speakers || []).forEach(function (s, i) { m[s.id] = { ko: s.ko, en: s.en, slot: 's' + (i % 3) }; });
    return m;
  }

  /* ── 복습 카드 ── */
  function cardsOf(e) {
    var out = [];
    if (!e) return out;
    e.scenes.forEach(function (s, si) {
      (s.expressions || []).forEach(function (x) {
        var t = x.turn != null ? s.turns[x.turn] : null;
        out.push({ key: e.id + '|x|' + x.ko + '|' + x.en, ep: e, scene: si, kind: 'x', front: x.ko, back: x.en, note: x.note,
          line: t ? t.en : '', ti: x.turn });
      });
    });
    (e.cautions || []).forEach(function (c) {
      out.push({ key: e.id + '|c|' + c.ko, ep: e, scene: -1, kind: 'c', front: c.ko, back: c.use, literal: c.literal, note: c.why });
    });
    return out;
  }
  function allCards() { return episodes.reduce(function (a, e) { return a.concat(cardsOf(e)); }, []); }
  function scopeCards() { return prefs.rvEp ? cardsOf(byId(prefs.rvEp)) : allCards(); }
  function state(c) { return rv[c.key] || null; }
  function isDue(c, now) { var s = state(c); return !s || s.d <= now; }
  function isKnown(c) { var s = state(c); return !!s && s.b >= 3; }
  function stats(cards) {
    var now = Date.now();
    return { total: cards.length, due: cards.filter(function (c) { return isDue(c, now); }).length,
      known: cards.filter(isKnown).length, star: cards.filter(function (c) { return state(c) && state(c).s; }).length };
  }
  function statsHtml(st) {
    return '<b>' + st.due + '</b> 오늘 복습 · <b>' + st.known + '</b> 익힘 · <b>' + st.star + '</b> ★ · 전체 ' + st.total;
  }

  /* ── 공통 ── */
  function tabs(active) {
    var st = stats(allCards());
    return '<nav class="cm-tabs"><a href="#" class="' + (active === 'list' ? 'on' : '') + '">회차 목록 <span>' + episodes.length + '</span></a>' +
      '<a href="#review" class="' + (active === 'review' ? 'on' : '') + '">표현 복습 <span>' + (st.due ? '오늘 ' + st.due : st.total) + '</span></a></nav>';
  }
  function showPlayer(on) {
    el.player.hidden = !on;
    document.body.classList.toggle('has-player', on);
  }
  function setMode(m) {
    if (mode !== m) { audio.pause(); stopAt = null; }
    mode = m;
    el.hero.hidden = m === 'episode';
    document.body.setAttribute('data-mode', m);
  }
  function setSrc(e) {
    var want = LS.url(e.audio);
    if (audio.src !== want) { audio.src = want; audio.preload = 'metadata'; }
    audio.playbackRate = SPEEDS[prefs.speed];
  }

  /* ── 목록 ── */
  function renderList() {
    setMode('list'); ep = null; showPlayer(false);
    var h = [tabs('list')];
    if (!episodes.length) h.push('<div class="empty-state"><p>아직 올린 대본이 없습니다.</p></div>');
    h.push('<div class="cm-list">');
    episodes.forEach(function (e) {
      var nt = e.scenes.reduce(function (a, s) { return a + s.turns.length; }, 0), st = stats(cardsOf(e));
      var pct = st.total ? Math.round(st.known / st.total * 100) : 0;
      h.push('<a class="cm-item" href="#' + esc(e.id) + '"><div class="cm-item-date">' + esc(e.date) + '</div>' +
        '<div class="cm-item-title">' + esc(e.title_ko) + '</div><div class="cm-item-en">' + esc(e.title_en) + '</div>' +
        (e.summary ? '<p class="cm-item-sum">' + esc(e.summary) + '</p>' : '') +
        '<div class="cm-item-meta">장면 ' + e.scenes.length + ' · 턴 ' + nt +
        (e.audio ? ' · 낭독 ' + fmt(e.duration) + ' · ' + esc(e.voice) : ' · 음원 준비 중') + '</div>' +
        '<div class="cm-progress" title="익힌 표현 (복습에서 세 번 넘게 알았다고 한 것)"><span style="width:' + pct + '%"></span></div>' +
        '<div class="cm-item-meta">표현 ' + st.total + ' · 익힘 ' + st.known + (st.due ? ' · 오늘 복습 ' + st.due : '') + '</div></a>');
    });
    h.push('</div>');
    el.app.innerHTML = h.join('');
  }

  /* ── 회차 ── */
  function renderEpisode(e) {
    setMode('episode');
    ep = e; turns = []; cur = -1; stopAt = null;
    var sp = speakerMap(e), hasAudio = !!e.audio, h = [];
    h.push('<a class="cm-back" href="#">← 회차 목록</a>');
    h.push('<div class="cm-ep-head"><h2>' + esc(e.title_ko) + '</h2><div class="en">' + esc(e.title_en) + '</div></div>');
    var meta = [esc(e.date)];
    if (hasAudio) meta.push('낭독 ' + fmt(e.duration) + ' · ' + esc(e.voice) + ' (' + esc(e.engine) + ')');
    else meta.push('음원 준비 중');
    meta.push('<a href="#review/' + esc(e.id) + '">이 회차 표현 복습 ' + cardsOf(e).length + '</a>');
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
      var base = turns.length;
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
            var go = x.turn != null ? ' <a class="x-go" href="#' + esc(e.id) + '/t' + (base + x.turn) + '" title="이 표현이 나온 대사로">↗</a>' : '';
            return '<tr><td>' + esc(x.ko) + '</td><td><div class="x-en">' + esc(x.en) + go + '</div>' +
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

    el.app.innerHTML = h.join('');
    document.body.setAttribute('data-view', prefs.view);
    if (hasAudio) {
      setSrc(e); showPlayer(true);
      el.total.textContent = fmt(e.duration);
    } else showPlayer(false);
    updateNow();
  }

  /* ── 표현 복습 ── */
  function buildDeck() {
    var now = Date.now(), cards = scopeCards();
    if (prefs.rvFilter === 'due') cards = cards.filter(function (c) { return isDue(c, now); })
      .sort(function (a, b) { return ((state(a) || {}).d || 0) - ((state(b) || {}).d || 0); });
    else if (prefs.rvFilter === 'star') cards = cards.filter(function (c) { return state(c) && state(c).s; });
    deck = cards; pos = 0; shown = false;
  }
  function renderReview() {
    setMode('review'); ep = null; showPlayer(false);
    var h = [tabs('review')];
    h.push('<div class="cm-rv-stats" id="cm-rvstats">' + statsHtml(stats(scopeCards())) + '</div>');
    h.push('<div class="cm-rv-bar"><div class="cm-seg" id="cm-rvf">' + [['due', '복습할 것'], ['all', '전체'], ['star', '★ 헷갈림']].map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (prefs.rvFilter === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
      '<select id="cm-rvep" aria-label="회차"><option value="">모든 회차</option>' + episodes.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (prefs.rvEp === e.id ? ' selected' : '') + '>' + esc(e.date) + ' · ' + esc(e.title_ko) + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="cm-btn" id="cm-shuffle">섞기</button></div>');
    h.push('<div id="cm-card"></div>');
    h.push('<p class="cm-rv-help">한국어를 보고 영어로 먼저 말해 본 뒤 <b>정답 보기</b>. 맞혔으면 <b>알았어요</b>(1 → 3 → 7 → 14 → 30일 뒤 다시), ' +
      '틀렸으면 <b>다시</b>(이번 복습 끝에 한 번 더). 🔊 는 대화 속 그 대사를 들려줍니다. 기록은 이 브라우저에만 남습니다. ' +
      '키보드: Space 정답 보기 · 알았어요, X 다시, P 듣기.</p>');
    el.app.innerHTML = h.join('');
    paintCard();
  }
  function flatIndex(e, si, ti) {
    var k = 0;
    for (var i = 0; i < si; i++) k += e.scenes[i].turns.length;
    return k + ti;
  }
  function paintCard() {
    var box = document.getElementById('cm-card');
    if (!box) return;
    var c = deck[pos];
    if (!c) {
      box.innerHTML = '<div class="cm-flash done"><div class="cm-flash-front">' +
        (prefs.rvFilter === 'due' ? '오늘 복습할 표현을 다 했습니다 👏' : '카드가 없습니다') + '</div>' +
        (prefs.rvFilter === 'due' ? '<div class="cm-flash-note"><b>전체</b>를 누르면 날짜와 상관없이 다시 볼 수 있습니다.</div>' : '') + '</div>';
      return;
    }
    var s = state(c) || { b: 0 }, sc = c.scene >= 0 ? c.ep.scenes[c.scene] : null;
    var where = esc(c.ep.date) + ' · ' + (sc ? esc(sc.title_ko) : '직역 주의') + ' · ' + (pos + 1) + ' / ' + deck.length;
    var t = sc && c.ti != null ? sc.turns[c.ti] : null, canPlay = !!(c.ep.audio && t && t.start != null);
    var h = '<div class="cm-flash' + (shown ? ' shown' : '') + '"><div class="cm-flash-where"><span>' + where + '</span>' +
      '<button type="button" class="cm-star" id="cm-star" aria-pressed="' + !!s.s + '" title="헷갈림 표시">' + (s.s ? '★' : '☆') + '</button></div>' +
      '<div class="cm-flash-tag">' + (c.kind === 'c' ? '직역하면 어색한 말' : '표현') + ' · 상자 ' + (s.b || 0) + '</div>' +
      '<div class="cm-flash-front">' + esc(c.front) + '</div>';
    if (shown) {
      h += '<div class="cm-flash-back">' + esc(c.back) + '</div>';
      if (c.kind === 'c' && c.literal) h += '<div class="cm-flash-lit">직역: <s>' + esc(c.literal) + '</s></div>';
      if (c.note) h += '<div class="cm-flash-note">' + esc(c.note) + '</div>';
      if (c.line) h += '<div class="cm-flash-line">“' + esc(c.line) + '”</div>';
      h += '<div class="cm-flash-act">' +
        (canPlay ? '<button type="button" class="cm-btn" id="cm-say">🔊 대화에서 듣기</button>' : '') +
        (sc ? '<a class="cm-btn cm-btn--link" href="#' + esc(c.ep.id) + '/' + (c.ti != null ? 't' + flatIndex(c.ep, c.scene, c.ti) : esc(sc.id)) + '">대화에서 보기</a>' : '') +
        '</div><div class="cm-flash-grade"><button type="button" class="cm-btn" id="cm-no">다시</button>' +
        '<button type="button" class="cm-btn cm-btn--play" id="cm-yes">알았어요</button></div>';
    } else {
      h += '<div class="cm-flash-grade"><button type="button" class="cm-btn cm-btn--play" id="cm-reveal">정답 보기</button></div>';
    }
    box.innerHTML = h + '</div>';
  }
  function grade(ok) {
    var c = deck[pos]; if (!c) return;
    var s = rv[c.key] || { b: 0, d: 0 };
    if (ok) { s.b = Math.min((s.b || 0) + 1, INTERVALS.length - 1); s.d = Date.now() + INTERVALS[s.b] * DAY; }
    else { s.b = 0; s.d = Date.now(); deck.push(c); }   // 이번 복습 끝에 한 번 더
    rv[c.key] = s; saveRv();
    pos++; shown = false;
    paintCard();
    var st = document.getElementById('cm-rvstats');
    if (st) st.innerHTML = statsHtml(stats(scopeCards()));
  }
  function sayCard() {
    var c = deck[pos]; if (!c || !c.ep.audio || c.ti == null) return;
    var t = c.ep.scenes[c.scene].turns[c.ti];
    if (!t || t.start == null) return;
    setSrc(c.ep);
    stopAt = t.end + 0.05;
    var go = function () { audio.currentTime = t.start; audio.play().catch(function () {}); };
    if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
  }

  /* ── 재생 (회차 화면) ── */
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
    if (stopAt != null && t >= stopAt) { audio.pause(); stopAt = null; }
    if (mode !== 'episode') return;
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

  function shuffleRest() {
    for (var i = deck.length - 1; i > pos; i--) {
      var j = pos + Math.floor(Math.random() * (i - pos + 1)), x = deck[i];
      deck[i] = deck[j]; deck[j] = x;
    }
    shown = false; paintCard();
  }

  function bind() {
    audio.addEventListener('play', function () { el.toggle.textContent = '❚❚'; el.toggle.setAttribute('aria-label', '일시정지'); cancelAnimationFrame(raf); loop(); });
    audio.addEventListener('pause', function () { el.toggle.textContent = '▶︎'; el.toggle.setAttribute('aria-label', '재생'); tick(); });
    audio.addEventListener('timeupdate', function () { if (audio.paused) tick(); });

    el.app.addEventListener('click', function (ev) {
      if (mode === 'review') {
        var id = ev.target.id;
        if (id === 'cm-reveal') { shown = true; paintCard(); return; }
        if (id === 'cm-yes') { grade(true); return; }
        if (id === 'cm-no') { grade(false); return; }
        if (id === 'cm-say') { sayCard(); return; }
        if (id === 'cm-shuffle') { shuffleRest(); return; }
        if (id === 'cm-star') {
          var c = deck[pos];
          if (c) { var s = rv[c.key] || { b: 0, d: 0 }; s.s = !s.s; rv[c.key] = s; saveRv(); paintCard(); }
          return;
        }
        var f = ev.target.closest('#cm-rvf button');
        if (f) { prefs.rvFilter = f.dataset.f; save(); buildDeck(); renderReview(); }
        return;
      }
      if (mode !== 'episode') return;
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
    el.app.addEventListener('change', function (ev) {
      if (ev.target.id === 'cm-rvep') location.hash = ev.target.value ? 'review/' + ev.target.value : 'review';
    });
    document.addEventListener('keydown', function (ev) {
      if (mode !== 'review' || ev.target.closest('input, select, textarea, button, a')) return;
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!shown) { shown = true; paintCard(); } else grade(true); }
      else if (shown && (ev.key === 'x' || ev.key === 'X')) grade(false);
      else if (shown && (ev.key === 'p' || ev.key === 'P')) sayCard();
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
    if (parts[0] === 'review') {
      prefs.rvEp = parts[1] && byId(parts[1]) ? parts[1] : '';   // #review = 모든 회차, #review/<id> = 그 회차만
      save(); buildDeck(); renderReview(); window.scrollTo(0, 0); return;
    }
    var e = parts[0] && byId(parts[0]);
    if (!e) { renderList(); window.scrollTo(0, 0); return; }
    if (mode !== 'episode' || e !== ep) { renderEpisode(e); window.scrollTo(0, 0); }
    if (parts[1]) {
      var n = document.getElementById(parts[1]), isTurn = /^t\d+$/.test(parts[1]);
      if (n) {
        n.scrollIntoView({ block: isTurn ? 'center' : 'start' });
        if (isTurn) { n.classList.add('flash'); setTimeout(function () { n.classList.remove('flash'); }, 1600); }
      }
    }
  }

  function init() {
    ['app', 'hero', 'player', 'now', 'seek', 'elapsed', 'total', 'step', 'prev', 'toggle', 'next', 'again', 'speed', 'follow']
      .forEach(function (k) { el[k] = document.getElementById('cm-' + k); });
    load(); paintBtns();
    try { episodes = JSON.parse(document.getElementById('comm-data').textContent).episodes || []; } catch (e) { episodes = []; }
    bind();
    route();
  }

  init();
})();
