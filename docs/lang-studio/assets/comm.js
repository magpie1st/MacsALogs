// Lang-Studio 일상대화 — 원본은 VoiceLang web/lang-studio/assets/comm.js(옛 MacsALogs docs/js/comm.js). 음원 주소는 LS.url 로 사이트 뿌리 기준.
/* 일상대화 영어 대본 — 목록(#) · 회차(#<id>[/<scene|tN>]) · 표현 복습(#review[/<id>])
 * 회차: 자막 언어 + 말해 보기, 재생 범위(1 이번 회차 ↔ all 전체 회차), 이전 · 다음 회차, R 현재 턴 반복, F 따라가기 (2026-11-22)
 * 플레이어 겉모양은 드라마 플레이어와 같다(tv-ctl · tv-ico · tv-sep · tv-rate-select — 블로그 css/style.css)
 * 자막 언어는 버튼 하나 — 누를 때마다 한 → 영 → A(한·영) → 한 (nextLang). 위 막대(#cm-lang)와 플레이어(#cm-plang) 두 곳이
 * 같은 prefs.lang 을 쓰고 같이 바뀐다(음원 없는 회차는 플레이어가 없다)
 * 복습: 모든 회차의 장면 표현 + 직역 주의 표현을 카드로. 상자 단계(라이트너)로 간격을 늘린다. 상태는 이 브라우저에만 둔다
 * 회차 삭제: 사이트 파일은 그대로 두고 이 브라우저(localStorage 'comm-hidden')에서만 숨긴다 — 누르면 확인 대화상자(취소 = 그대로)를 거쳐 목록 · 복습 · 전체 재생에서 빠지고 언제든 복원 */
(function () {
  'use strict';

  var SPEEDS = [0.75, 0.9, 1.0, 1.15, 1.3];
  // 자막 언어 순환 순서: [값, 플레이어 글자, 이름, 위 막대 글자]
  var LANGS = [['ko', '한', '한국어만', '한'], ['en', '영', '영어만', '영'], ['both', 'A', '한·영 동시', '한·영']];
  // 재생 범위: [값, 버튼 글자, 이름, 설명]
  var SCOPES = [['ep', '1', '이번 회차', '이 회차 끝에서 멈춤'], ['all', 'all', '전체 회차', '회차가 끝나면 다음 회차로 이어서 (삭제한 회차는 건너뜀)']];
  var STORE = 'comm-prefs', REVIEW = 'comm-review', HIDE = 'comm-hidden';
  var DAY = 86400000, INTERVALS = [0, 1, 3, 7, 14, 30];   // 상자 단계별 다음 복습까지 날짜
  var KNOWN_BOX = 3;       // 상자 3 이상 = 익힘. 「다시」는 상자를 0 으로 돌리므로 「다시」 없이 「알았어요」를 세 번 이어서 누른 것

  /* 카드 상태 {b: 상자 0~5, d: 다음 복습 시각(ms), s: ★} 의 규칙 — 저장 형식은 옛 것 그대로(localStorage 'comm-review') */
  function nextState(s, ok, now) {
    var n = {};
    for (var k in (s || {})) n[k] = s[k];   // ★(s) 는 그대로 둔다
    if (ok) { n.b = Math.min((n.b || 0) + 1, INTERVALS.length - 1); n.d = now + INTERVALS[n.b] * DAY; }
    else { n.b = 0; n.d = now; }
    return n;
  }
  function knownState(s) { return !!s && (s.b || 0) >= KNOWN_BOX; }
  /* 회차 번호: 빌더가 넣은 no 를 그대로 쓴다. 번호는 한 번 매기면 바뀌지 않는다 — 중간 회차를 빼도 뒤 회차가 당겨지지 않고
     빈 번호로 남는다(빌더 comm.numbered). no 가 없는 옛 데이터만 첫 빌드와 같은 규칙으로 채운다 — 목록은 최근 것이 위이므로 맨 아래가 1회.
     주소 · 복습 기록은 id 를 쓰므로 번호와 무관하다. (span 클래스는 cm-epno — 「다시」 버튼의 id cm-no 와 다른 이름) */
  function numberOf(list) {
    var m = {};
    list.forEach(function (e, i) { m[e.id] = e.no != null ? e.no : list.length - i; });
    return m;
  }

  /* ── 회차 순서 · 숨김 · 반복 규칙 (브라우저 없이도 시험한다) ── */
  function visibleOf(list, hidden) { return list.filter(function (e) { return !(hidden && hidden[e.id]); }); }
  // 재생 순서 = 회차 번호 오름차순(1회 → 2회 …). 「다음 회차」 · 전체 회차 재생이 이 순서를 따른다
  function playOrder(list, no) {
    return list.slice().sort(function (a, b) { return (no[a.id] - no[b.id]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
  }
  /* id 의 이전(dir -1) · 다음(dir +1) 보이는 회차 id. id 가 숨긴 회차여도 번호로 이웃을 찾는다. needAudio 면 음원 없는 회차는 건너뛴다 */
  function neighbor(list, no, hidden, id, dir, needAudio) {
    var order = playOrder(visibleOf(list, hidden), no).filter(function (e) { return !needAudio || e.audio; });
    var n = no[id];
    if (n == null) return null;
    var after = function (e) { var m = no[e.id]; return m > n || (m === n && e.id > id); };
    var before = function (e) { var m = no[e.id]; return m < n || (m === n && e.id < id); };
    var cands = order.filter(dir > 0 ? after : before);   // order 는 오름차순 — 다음은 첫 것, 이전은 마지막 것
    var pick = dir > 0 ? cands[0] : cands[cands.length - 1];
    return pick ? pick.id : null;
  }
  // 턴의 끝: end 가 없으면 다음 턴 시작, 그것도 없으면 회차 길이
  function turnEndOf(list, k, duration) {
    var t = list[k];
    if (!t) return null;
    if (t.end != null) return t.end;
    for (var i = k + 1; i < list.length; i++) if (list[i].start != null) return list[i].start;
    return duration != null ? duration : null;
  }
  /* 반복 중 재생 위치 t 와 지금 턴 [a, b) → 'loop'(턴 끝 — a 로 되감기) · 'stay'(이 턴 안) · 'free'(사용자가 멀리 옮김 — 그 자리 턴으로)
     끝을 막 지난 1초는 같은 턴으로 본다(다음 프레임이 늦게 와도 다음 턴으로 새지 않게) */
  var LOOP_SLACK = 1.0;
  function repeatStep(t, a, b) {
    if (a == null || b == null || t < a - 0.05 || t >= b + LOOP_SLACK) return 'free';
    return t >= b ? 'loop' : 'stay';
  }
  /* 저장된 설정 → 지금 설정. 옛 view('both' | 'en' | 'ko' | 'quiz')는 lang + quiz 로 옮긴다. 옛 step(한 턴씩)은 버린다 */
  function migratePrefs(p, base) {
    var out = {}, k;
    for (k in base) out[k] = base[k];
    for (k in (p || {})) if (k in base) out[k] = p[k];
    if (p && p.view && !('lang' in p)) {
      if (p.view === 'quiz') out.quiz = true; else out.lang = p.view;
    }
    if (!LANGS.some(function (l) { return l[0] === out.lang; })) out.lang = 'both';
    if (!SCOPES.some(function (s) { return s[0] === out.scope; })) out.scope = 'ep';
    out.quiz = !!out.quiz;
    return out;
  }
  /* 자막 언어 순환 — 한 → 영 → A(한·영) → 한. 모르는 값은 A 로 본다 */
  function langOf(id) { return LANGS.find(function (l) { return l[0] === id; }) || LANGS[2]; }
  function nextLang(id) {
    var i = LANGS.indexOf(langOf(id));
    return LANGS[(i + 1) % LANGS.length][0];
  }
  function langName(id) {   // 버튼 aria-label · title — 지금 언어와 누르면 바뀔 언어
    var c = langOf(id), n = langOf(nextLang(id));
    return '자막 언어: ' + c[2] + ' (' + c[1] + ') — 누르면 ' + n[2];
  }
  function scopeOf(id) { return SCOPES.find(function (s) { return s[0] === id; }) || SCOPES[0]; }
  function nextScope(id) { return scopeOf(id)[0] === 'ep' ? 'all' : 'ep'; }
  function scopeName(id) {
    var c = scopeOf(id), n = scopeOf(nextScope(id));
    return '재생 범위: ' + c[2] + ' — ' + c[3] + ' (누르면 ' + n[2] + ')';
  }

  /* 삭제 확인 문구 — name 은 「3회 「제목」」 꼴(epName). 실제로 무엇이 일어나는지(이 브라우저에서 숨김)와 무엇이 남는지를 함께 묻는다 */
  function hideConfirmText(name) {
    return name + ' 회차를 삭제할까요?\n\n' +
      '이 브라우저의 회차 목록 · 표현 복습 · 전체 회차 재생에서 숨깁니다.\n' +
      '사이트의 대본과 음원 파일은 지워지지 않으며, 목록 아래 「삭제한 회차」에서 언제든 복원할 수 있습니다.\n\n' +
      '[확인] 삭제(숨김)   [취소] 그대로 두기';
  }

  var episodes = [], epNo = {}, hidden = {};
  var mode = '';           // list | episode | review
  var ep = null;           // 회차 화면의 회차
  var turns = [];          // 회차 화면의 평탄화된 턴 (재생 순서)
  var audio = typeof Audio === 'function' ? new Audio() : null;   // 브라우저 밖(테스트)에는 없다
  var cur = -1, stopAt = null;
  var repeat = false;      // 지금 턴 반복 — 이 탭에서만(새로 열면 꺼져 있다)
  var pendingPlay = false; // 회차를 옮긴 뒤 처음부터 이어서 재생할지(전체 회차 · 재생 중 이전/다음 회차)
  var DEFAULTS = { lang: 'both', quiz: false, scope: 'ep', speed: 2, follow: true, rvFilter: 'due', rvEp: '' };
  var prefs = migratePrefs({}, DEFAULTS);
  var rv = {};             // 카드 키 → {b: 상자, d: 다음 복습 시각(ms), s: ★}
  var deck = [], pos = 0, shown = false;
  var rvHiddenNote = '';   // #review/<숨긴 회차> 로 들어왔을 때 알린다
  var hiddenOpen = false;  // 목록의 「삭제한 회차」 펼침
  var el = {}, toastTimer = 0;

  /* ── 저장 (실패해도 페이지는 동작한다) ── */
  function load() {
    try { prefs = migratePrefs(JSON.parse(localStorage.getItem(STORE) || '{}'), DEFAULTS); } catch (e) {}
    try { rv = JSON.parse(localStorage.getItem(REVIEW) || '{}') || {}; } catch (e) { rv = {}; }
    try { hidden = JSON.parse(localStorage.getItem(HIDE) || '{}') || {}; } catch (e) { hidden = {}; }
    if (!SPEEDS[prefs.speed]) prefs.speed = 2;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} }
  function saveRv() { try { localStorage.setItem(REVIEW, JSON.stringify(rv)); } catch (e) {} }
  function saveHidden() { try { localStorage.setItem(HIDE, JSON.stringify(hidden)); } catch (e) {} }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(s) { if (!isFinite(s) || s < 0) s = 0; var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  function byId(id) { return episodes.find(function (x) { return x.id === id; }); }
  function isHidden(e) { return !!(e && hidden[e.id]); }
  function visible() { return visibleOf(episodes, hidden); }
  function epName(e) { return (noLabel(e) ? noLabel(e) + ' ' : '') + '「' + e.title_ko + '」'; }

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
  function allCards() { return visible().reduce(function (a, e) { return a.concat(cardsOf(e)); }, []); }   // 숨긴 회차는 뺀다
  function scopeCards() { var e = prefs.rvEp && byId(prefs.rvEp); return e && !isHidden(e) ? cardsOf(e) : allCards(); }
  function state(c) { return rv[c.key] || null; }
  function isDue(c, now) { var s = state(c); return !s || s.d <= now; }
  function isKnown(c) { return knownState(state(c)); }
  function noLabel(e) { return epNo[e.id] != null ? epNo[e.id] + '회' : ''; }
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
    return '<nav class="cm-tabs"><a href="#" class="' + (active === 'list' ? 'on' : '') + '">회차 목록 <span>' + visible().length + '</span></a>' +
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
    var h = [tabs('list')], vis = visible(), gone = episodes.filter(isHidden);
    if (!episodes.length) h.push('<div class="empty-state"><p>아직 올린 대본이 없습니다.</p></div>');
    else if (!vis.length) h.push('<div class="empty-state"><p>모든 회차를 이 브라우저 목록에서 삭제했습니다. 아래 <b>삭제한 회차</b>에서 복원할 수 있습니다.</p></div>');
    h.push('<div class="cm-list">');
    vis.forEach(function (e) {
      var nt = e.scenes.reduce(function (a, s) { return a + s.turns.length; }, 0), st = stats(cardsOf(e));
      var pct = st.total ? Math.round(st.known / st.total * 100) : 0;
      var del = '<button type="button" class="cm-hide" data-hide="' + esc(e.id) + '" ' +
        'aria-label="' + esc(epName(e)) + ' 목록에서 삭제 (이 브라우저에서만 숨김, 복원 가능)" title="이 브라우저 목록에서 삭제 — 사이트 파일은 그대로, 언제든 복원">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span>삭제</span></button>';
      h.push('<div class="cm-item-wrap">' +
        '<a class="cm-item" href="#' + esc(e.id) + '"><div class="cm-item-date">' + esc(e.date) + '</div>' +
        '<div class="cm-item-title"><span class="cm-epno">' + noLabel(e) + '</span>' + esc(e.title_ko) + '</div><div class="cm-item-en">' + esc(e.title_en) + '</div>' +
        (e.summary ? '<p class="cm-item-sum">' + esc(e.summary) + '</p>' : '') +
        '<div class="cm-item-meta">장면 ' + e.scenes.length + ' · 턴 ' + nt +
        (e.audio ? ' · 낭독 ' + fmt(e.duration) + ' · ' + esc(e.voice) : ' · 음원 준비 중') + '</div>' +
        '<div class="cm-progress" title="익힌 표현 (복습에서 「다시」 없이 「알았어요」를 세 번 이어서 누른 것 — 상자 3 이상)"><span style="width:' + pct + '%"></span></div>' +
        '<div class="cm-item-meta">표현 ' + st.total + ' · 익힘 ' + st.known + (st.due ? ' · 오늘 복습 ' + st.due : '') + '</div></a>' + del + '</div>');
    });
    h.push('</div>');
    if (gone.length) h.push(hiddenBox(gone));
    el.app.innerHTML = h.join('');
  }
  /* 삭제한(숨긴) 회차 — 이 브라우저에서만. 사이트의 대본 · 음원은 그대로다 */
  function hiddenBox(gone) {
    return '<details class="cm-hidden" id="cm-hidden"' + (hiddenOpen ? ' open' : '') + '><summary>삭제한 회차 <b>' + gone.length + '</b>' +
      '<span>이 브라우저에서만 숨김 · 복원 가능</span></summary>' +
      '<p>여기 있는 회차는 이 브라우저의 목록 · 표현 복습 · 전체 회차 재생에서만 빠져 있습니다. 사이트의 대본과 음원은 지워지지 않았고, ' +
      '다른 브라우저나 기기에서는 그대로 보입니다. 브라우저 저장 데이터를 지우면 모두 다시 나타납니다.</p><ul>' +
      playOrder(gone, epNo).map(function (e) {
        return '<li><a href="#' + esc(e.id) + '"><span class="cm-epno">' + noLabel(e) + '</span>' + esc(e.title_ko) + '</a>' +
          '<span class="cm-hidden-date">' + esc(e.date) + '</span>' +
          '<button type="button" class="cm-btn" data-restore="' + esc(e.id) + '" aria-label="' + esc(epName(e)) + ' 복원">복원</button></li>';
      }).join('') + '</ul>' +
      (gone.length > 1 ? '<button type="button" class="cm-btn" data-restore="*">모두 복원</button>' : '') + '</details>';
  }

  /* ── 회차 ── */
  function renderEpisode(e) {
    setMode('episode');
    ep = e; turns = []; cur = -1; stopAt = null;
    var sp = speakerMap(e), hasAudio = !!e.audio, h = [];
    h.push('<a class="cm-back" href="#">← 회차 목록</a>');
    if (isHidden(e)) h.push('<div class="cm-hidden-banner" role="status"><p><b>이 브라우저 목록에서 삭제(숨김)한 회차입니다.</b> ' +
      '목록 · 표현 복습 · 전체 회차 재생에서 빠져 있지만 사이트의 대본과 음원은 그대로이고, 주소로는 이렇게 볼 수 있습니다.</p>' +
      '<button type="button" class="cm-btn cm-btn--play" data-restore="' + esc(e.id) + '">목록에 복원</button></div>');
    h.push('<div class="cm-ep-head"><h2><span class="cm-epno">' + noLabel(e) + '</span>' + esc(e.title_ko) + '</h2><div class="en">' + esc(e.title_en) + '</div></div>');
    var meta = [esc(e.date)];
    if (hasAudio) meta.push('낭독 ' + fmt(e.duration) + ' · ' + esc(e.voice) + ' (' + esc(e.engine) + ')');
    else meta.push('음원 준비 중');
    if (!isHidden(e)) meta.push('<a href="#review/' + esc(e.id) + '">이 회차 표현 복습 ' + cardsOf(e).length + '</a>');
    h.push('<div class="cm-meta">' + meta.join(' · ') + (isHidden(e) ? '' : ' · <button type="button" class="cm-linkbtn" data-hide="' + esc(e.id) +
      '" title="이 브라우저 목록에서 삭제 — 사이트 파일은 그대로, 언제든 복원">목록에서 삭제</button>') + '</div>');
    h.push('<div class="cm-cast">' + (e.speakers || []).map(function (s, i) {
      var v = e.voices && e.voices[s.id] ? ' · 🔊 ' + esc(e.voices[s.id]) : '';
      return '<span class="cm-chip s' + (i % 3) + '">' + esc(s.en) + ' · ' + esc(s.ko) + v + '</span>';
    }).join('') + '</div>');
    if (e.summary) h.push('<p class="cm-summary">' + esc(e.summary) + '</p>');
    if (e.note) h.push('<div class="cm-note">' + esc(e.note) + '</div>');

    h.push('<div class="cm-bar">' + langButtonTop() + '<button type="button" class="cm-btn cm-quiz" id="cm-quiz" aria-pressed="' + prefs.quiz +
      '" title="한국어만 보고 영어로 말해 본 뒤, 가린 영어를 눌러 확인">말해 보기</button><nav class="cm-toc" aria-label="장면">' + e.scenes.map(function (s, i) {
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
    applyView();
    if (hasAudio) {
      var same = audio.src === LS.url(e.audio);
      setSrc(e); showPlayer(true);
      el.total.textContent = fmt(e.duration);
      if (same && audio.currentTime > 0) mark(turnAt(audio.currentTime));   // 같은 회차를 다시 그릴 때(삭제 · 복원) 지금 턴 표시를 잇는다
      if (pendingPlay) { pendingPlay = false; playFromTop(); }
    } else { showPlayer(false); pendingPlay = false; }
    paintNav();
    updateNow();
  }
  function langButtonTop() {
    var c = langOf(prefs.lang), name = esc(langName(prefs.lang));
    return '<button type="button" class="cm-btn cm-langbtn" id="cm-lang" data-lang="' + c[0] + '" aria-label="' + name + '" title="' + name + '">자막: ' + c[3] + '</button>';
  }
  function paintLang(b, top) {   // 위 막대 · 플레이어의 자막 언어 버튼 — 글자 · aria-label · title 에 지금 언어
    if (!b) return;
    var c = langOf(prefs.lang), name = langName(prefs.lang);
    b.textContent = top ? '자막: ' + c[3] : c[1];
    b.setAttribute('data-lang', c[0]);
    if (b.dataset) b.dataset.lang = c[0];
    b.setAttribute('aria-label', name); b.title = name;
  }
  function cycleLang() { prefs.lang = nextLang(prefs.lang); prefs.quiz = false; save(); applyView(); }   // 언어를 바꾸면 말해 보기는 끈다
  function applyView() {
    document.body.setAttribute('data-view', prefs.quiz ? 'quiz' : prefs.lang);
    paintLang(document.getElementById('cm-lang'), true);
    paintLang(el.plang, false);
    var q = document.getElementById('cm-quiz');
    if (q) q.setAttribute('aria-pressed', prefs.quiz);
    document.querySelectorAll('.cm-en.shown').forEach(function (x) { x.classList.remove('shown'); });
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
    var h = [tabs('review')], gone = byId(rvHiddenNote);
    if (gone) h.push('<div class="cm-hidden-banner" role="status"><p><b>' + esc(epName(gone)) + '</b>은(는) 이 브라우저 목록에서 삭제(숨김)한 회차라 ' +
      '복습에서 뺐습니다. 지금은 보이는 모든 회차의 표현을 보여 줍니다.</p><button type="button" class="cm-btn cm-btn--play" data-restore="' + esc(gone.id) + '">목록에 복원</button></div>');
    else if (episodes.length && !visible().length) h.push('<div class="cm-hidden-banner" role="status"><p>모든 회차를 이 브라우저 목록에서 삭제해 복습할 카드가 없습니다. ' +
      '<a href="#">회차 목록</a>의 <b>삭제한 회차</b>에서 복원할 수 있습니다.</p></div>');
    h.push('<div class="cm-rv-stats" id="cm-rvstats">' + statsHtml(stats(scopeCards())) + '</div>');
    h.push('<div class="cm-rv-bar"><div class="cm-seg" id="cm-rvf">' + [['due', '복습할 것'], ['all', '전체'], ['star', '★ 헷갈림']].map(function (f) {
      return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (prefs.rvFilter === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
      '<select id="cm-rvep" aria-label="회차"><option value="">모든 회차</option>' + visible().map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (prefs.rvEp === e.id ? ' selected' : '') + '>' + noLabel(e) + ' · ' + esc(e.date) + ' · ' + esc(e.title_ko) + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="cm-btn" id="cm-shuffle">섞기</button></div>');
    h.push('<div id="cm-card"></div>');
    h.push('<p class="cm-rv-help">한국어를 보고 영어로 먼저 말해 본 뒤 <b>정답 보기</b>. 맞혔으면 <b>알았어요</b>(1 → 3 → 7 → 14 → 30일 뒤 다시), ' +
      '틀렸으면 <b>다시</b>(상자 0 으로 돌아가고 이번 복습 끝에 한 번 더). <b>다시</b> 없이 <b>알았어요</b>를 세 번 이어서 누르면(상자 3) ' +
      '<b>익힘</b>으로 셉니다. 🔊 는 대화 속 그 대사를 들려줍니다. 기록은 이 브라우저에만 남습니다. ' +
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
    var where = noLabel(c.ep) + ' · ' + esc(c.ep.date) + ' · ' + (sc ? esc(sc.title_ko) : '직역 주의') + ' · ' + (pos + 1) + ' / ' + deck.length;
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
    rv[c.key] = nextState(rv[c.key], ok, Date.now());
    if (!ok) deck.push(c);   // 이번 복습 끝에 한 번 더
    saveRv();
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
    if (!t) { el.now.textContent = ep ? ep.title_en : ''; return; }
    el.now.innerHTML = '<span class="cm-now-pos">턴 ' + (cur + 1) + '/' + turns.length + '</span>' +
      (repeat ? '<span class="cm-now-tag">↻ 반복 중</span>' : '') +
      esc(ep.scenes[t.scene].title_ko + ' — ' + t.sp + ': ' + t.en);
  }
  function curEnd() { return turnEndOf(turns, cur, ep && ep.duration); }
  function playTurn(k, only) {
    var t = turns[k];
    if (!t || t.start == null) return;
    stopAt = only && !repeat ? t.end + 0.05 : null;   // 반복 중에는 멈추지 않고 그 턴을 되풀이한다
    audio.currentTime = t.start;
    mark(k);
    audio.play().catch(function () {});
  }
  function playScene(si) {
    var k = turns.findIndex(function (t) { return t.scene === si; });
    if (k >= 0) playTurn(k, false);
  }
  function playFromTop() {
    var go = function () { stopAt = null; audio.currentTime = 0; audio.play().catch(function () {}); };
    if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
  }
  function tick() {
    var t = audio.currentTime;
    if (stopAt != null && t >= stopAt) { audio.pause(); stopAt = null; }
    if (mode !== 'episode') return;
    var k;
    if (repeat && cur >= 0) {
      var step = repeatStep(t, turns[cur].start, curEnd());
      if (step === 'loop' && !audio.paused) { audio.currentTime = turns[cur].start; t = turns[cur].start; }
      k = step === 'free' ? turnAt(t) : cur;   // 반복 중에는 저절로 다음 턴으로 넘어가지 않는다
    } else k = turnAt(t);
    if (k !== cur) mark(k);
    if (!seeking && ep && ep.duration) {
      el.seek.value = Math.round(t / ep.duration * 1000);
      el.elapsed.textContent = fmt(t);
    }
  }
  var seeking = false, raf = 0;
  function loop() { tick(); if (!audio.paused) raf = requestAnimationFrame(loop); }

  /* ── 회차 이동 · 반복 · 범위 ── */
  function goEpisode(dir) {
    if (!ep) return;
    var id = neighbor(episodes, epNo, hidden, ep.id, dir, false);
    if (!id) return;
    pendingPlay = !audio.paused && !!byId(id).audio;   // 듣던 중이면 옮긴 회차도 처음부터 이어서
    location.hash = id;
  }
  function onEnded() {
    if (mode !== 'episode' || !ep) return;
    if (repeat && cur >= 0) { audio.currentTime = turns[cur].start; audio.play().catch(function () {}); return; }
    if (prefs.scope !== 'all') return;                 // 이 회차: 회차 끝에서 멈춘다
    var id = neighbor(episodes, epNo, hidden, ep.id, +1, true);
    if (id) { pendingPlay = true; location.hash = id; }
    else toast('마지막 회차까지 다 들었습니다.');
  }
  function setRepeat(on) {
    repeat = on;
    if (repeat && cur < 0 && turns.length) {
      var k = turnAt(audio.currentTime);
      mark(k >= 0 ? k : turns.findIndex(function (t) { return t.start != null; }));
    }
    if (repeat) stopAt = null;
    document.body.classList.toggle('cm-repeat', repeat);
    paintBtns(); updateNow();
  }
  function paintNav() {
    [['prevep', -1, '이전 회차'], ['nextep', +1, '다음 회차']].forEach(function (x) {
      var b = el[x[0]], id = ep && neighbor(episodes, epNo, hidden, ep.id, x[1], false), e = id && byId(id);
      b.disabled = !e;
      var label = e ? x[2] + ': ' + epName(e) : x[2] + ' 없음';
      b.setAttribute('aria-label', label); b.title = label;
    });
  }

  /* ── 삭제(이 브라우저에서 숨김) · 복원 ── */
  function toast(msg, undoId) {
    if (!el.toast) return;
    el.toast.innerHTML = '<span>' + msg + '</span>' +
      (undoId ? '<button type="button" class="cm-btn" data-undo="' + esc(undoId) + '">되돌리기</button>' : '') +
      '<button type="button" class="cm-toast-x" data-close aria-label="알림 닫기">×</button>';
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, undoId ? 12000 : 6000);
    var u = el.toast.querySelector('[data-undo]');
    if (u) u.focus();   // 누른 삭제 버튼은 사라지므로 포커스를 되돌리기로 옮긴다
  }
  function rerender() {
    if (mode === 'list') renderList();
    else if (mode === 'episode' && ep) renderEpisode(ep);
    else if (mode === 'review') { buildDeck(); renderReview(); }
  }
  /* 삭제 버튼 → 반드시 확인을 받는다. 취소(또는 대화상자를 못 띄움)면 아무것도 바꾸지 않는다 */
  function askHide(id) {
    var e = byId(id); if (!e || isHidden(e)) return false;
    var ok = false;
    try { ok = typeof window.confirm === 'function' && window.confirm(hideConfirmText(epName(e))) === true; } catch (x) { ok = false; }
    if (ok) hideEp(id);
    return ok;
  }
  function hideEp(id) {
    var e = byId(id); if (!e) return;
    hidden[id] = Date.now(); saveHidden();
    if (prefs.rvEp === id) { prefs.rvEp = ''; save(); }
    rerender();
    toast('<b>' + esc(epName(e)) + '</b>을(를) 이 브라우저 목록에서 삭제했습니다. 사이트의 대본 · 음원은 지워지지 않고, 목록 아래 <b>삭제한 회차</b>에서 언제든 복원할 수 있습니다.', id);
  }
  function restoreEp(id) {
    var ids = id === '*' ? Object.keys(hidden) : [id];
    ids.forEach(function (x) { delete hidden[x]; });
    saveHidden();
    if (rvHiddenNote && !hidden[rvHiddenNote]) {     // #review/<복원한 회차> 였다면 그 회차만 보기로 돌아간다
      prefs.rvEp = rvHiddenNote; rvHiddenNote = ''; save();
    }
    rerender();
    var e = byId(id);
    toast(id === '*' ? '삭제한 회차 ' + ids.length + '개를 모두 목록에 복원했습니다.' : '<b>' + esc(e ? epName(e) : id) + '</b>을(를) 목록에 복원했습니다.');
  }

  function shuffleRest() {
    for (var i = deck.length - 1; i > pos; i--) {
      var j = pos + Math.floor(Math.random() * (i - pos + 1)), x = deck[i];
      deck[i] = deck[j]; deck[j] = x;
    }
    shown = false; paintCard();
  }

  function bind() {
    audio.addEventListener('play', function () { el.toggle.textContent = '❚❚'; el.toggle.setAttribute('aria-label', '일시정지'); cancelAnimationFrame(raf); loop(); });
    audio.addEventListener('pause', function () { el.toggle.textContent = '▶'; el.toggle.setAttribute('aria-label', '재생'); tick(); });
    audio.addEventListener('timeupdate', tick);   // 탭이 뒤에 있어 화면 갱신(rAF)이 멈춰도 반복 · 멈춤이 동작하게
    audio.addEventListener('ended', onEnded);

    el.app.addEventListener('click', function (ev) {
      var hb = ev.target.closest('[data-hide]');
      if (hb) { ev.preventDefault(); askHide(hb.dataset.hide); return; }
      var rb = ev.target.closest('[data-restore]');
      if (rb) { ev.preventDefault(); restoreEp(rb.dataset.restore); return; }
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
      var sc = ev.target.closest('.cm-scene-play');
      if (sc) { playScene(+sc.dataset.scene); return; }
      if (ev.target.closest('#cm-lang')) { cycleLang(); return; }
      if (ev.target.closest('#cm-quiz')) { prefs.quiz = !prefs.quiz; save(); applyView(); return; }
      var en = ev.target.closest('.cm-en');
      if (en && prefs.quiz) {
        en.classList.toggle('shown');
        var row = en.closest('.cm-turn');
        if (en.classList.contains('shown') && row && ep.audio) playTurn(+row.dataset.k, true);
      }
    });
    el.app.addEventListener('toggle', function (ev) { if (ev.target.id === 'cm-hidden') hiddenOpen = ev.target.open; }, true);
    el.app.addEventListener('change', function (ev) {
      if (ev.target.id === 'cm-rvep') location.hash = ev.target.value ? 'review/' + ev.target.value : 'review';
    });
    if (el.toast) el.toast.addEventListener('click', function (ev) {
      var u = ev.target.closest('[data-undo]');
      if (u) { restoreEp(u.dataset.undo); return; }
      if (ev.target.closest('[data-close]')) el.toast.hidden = true;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.target.closest('input, select, textarea, button, a, summary')) return;
      if (mode === 'review') {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!shown) { shown = true; paintCard(); } else grade(true); }
        else if (shown && (ev.key === 'x' || ev.key === 'X')) grade(false);
        else if (shown && (ev.key === 'p' || ev.key === 'P')) sayCard();
        return;
      }
      if (mode !== 'episode' || el.player.hidden) return;
      // 회차 화면: Space 재생 · 일시정지, R 지금 턴 반복
      if (ev.key === ' ') { ev.preventDefault(); el.toggle.click(); }
      else if (ev.key === 'r' || ev.key === 'R') setRepeat(!repeat);
    });

    el.toggle.addEventListener('click', function () {
      if (!audio.paused) { audio.pause(); return; }
      stopAt = null;
      if (repeat && cur >= 0 && repeatStep(audio.currentTime, turns[cur].start, curEnd()) !== 'stay') audio.currentTime = turns[cur].start;
      else if (audio.ended || (ep && ep.duration && audio.currentTime >= ep.duration - 0.05)) audio.currentTime = 0;
      audio.play().catch(function () {});
    });
    el.prevep.addEventListener('click', function () { goEpisode(-1); });
    el.nextep.addEventListener('click', function () { goEpisode(+1); });
    el.repeat.addEventListener('click', function () { setRepeat(!repeat); });
    el.scope.addEventListener('click', function () { prefs.scope = nextScope(prefs.scope); save(); paintBtns(); });   // 1 ↔ all
    el.speed.addEventListener('change', function () {
      var i = +el.speed.value;
      if (SPEEDS[i]) { prefs.speed = i; audio.playbackRate = SPEEDS[i]; save(); }
      paintBtns();
    });
    el.follow.addEventListener('click', function () { prefs.follow = !prefs.follow; save(); paintBtns(); });
    el.plang.addEventListener('click', cycleLang);   // 플레이어의 자막 언어 — 위 막대와 같은 설정, 같은 순환
    el.seek.addEventListener('input', function () { seeking = true; el.elapsed.textContent = fmt(el.seek.value / 1000 * ep.duration); });
    el.seek.addEventListener('change', function () {
      seeking = false; stopAt = null;
      audio.currentTime = el.seek.value / 1000 * ep.duration;
      mark(turnAt(audio.currentTime));   // 반복 중이면 옮긴 자리의 턴을 반복한다
      tick();
    });

    window.addEventListener('hashchange', route);
  }
  function paintBtns() {
    el.speed.value = String(prefs.speed);
    el.follow.setAttribute('aria-pressed', prefs.follow);
    el.repeat.setAttribute('aria-pressed', repeat);
    var sc = scopeOf(prefs.scope), sn = scopeName(prefs.scope);   // 켜짐(채운 모양) = 전체 회차 이어 재생
    el.scope.textContent = sc[1];
    el.scope.setAttribute('data-scope', sc[0]);
    el.scope.setAttribute('aria-pressed', sc[0] === 'all');
    el.scope.setAttribute('aria-label', sn); el.scope.title = sn;
    paintLang(el.plang, false);
  }

  function closeToast() {
    if (!el.toast || el.toast.hidden) return;
    if (el.toast.contains(document.activeElement)) document.activeElement.blur();   // 화면을 옮긴 뒤 Space 가 「되돌리기」를 누르지 않게
    el.toast.hidden = true;
  }
  function route() {
    closeToast();
    var parts = decodeURIComponent(location.hash.slice(1)).split('/');
    if (parts[0] === 'review') {
      var re = parts[1] && byId(parts[1]);
      rvHiddenNote = re && isHidden(re) ? re.id : '';
      prefs.rvEp = re && !isHidden(re) ? re.id : '';   // #review = 모든 회차, #review/<id> = 그 회차만(숨긴 회차면 알리고 모든 회차)
      save(); buildDeck(); renderReview(); window.scrollTo(0, 0); return;
    }
    rvHiddenNote = '';
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

  // HTML 과 이 JS 가 서로 다른 판일 때(캐시가 섞임) — 「불러오는 중…」에 멈추지 않게 한 번 다시 받고, 그래도 안 되면 알린다
  var RELOAD_KEY = 'cm-reloaded';
  function stale(why) {
    if (window.console) console.error('[comm] 초기화 실패 — ' + why);
    var tried = false;
    try { tried = sessionStorage.getItem(RELOAD_KEY) === '1'; if (!tried) sessionStorage.setItem(RELOAD_KEY, '1'); } catch (e) { tried = true; }
    if (!tried) { location.reload(); return; }
    var app = document.getElementById('cm-app');
    if (app) app.innerHTML = '<div class="empty-state"><p>페이지를 불러오지 못했습니다. 새 판으로 바뀌는 중일 수 있어요 — ' +
      '잠시 뒤 <a href="" onclick="location.reload();return false">새로고침</a>(안 되면 Ctrl+Shift+R) 해 주세요.</p></div>';
  }

  function init() {
    ['app', 'hero', 'player', 'now', 'seek', 'elapsed', 'total', 'scope', 'prevep', 'toggle', 'nextep', 'repeat', 'speed', 'follow', 'plang', 'toast']
      .forEach(function (k) { el[k] = document.getElementById('cm-' + k); });
    var missing = Object.keys(el).filter(function (k) { return !el[k] && k !== 'toast'; });
    var data = document.getElementById('comm-data');
    if (missing.length || !data) return stale('페이지에 없는 요소: ' + missing.concat(data ? [] : ['comm-data']).join(', '));
    try {
      load(); paintBtns();
      try { episodes = JSON.parse(data.textContent).episodes || []; } catch (e) { episodes = []; }
      epNo = numberOf(episodes);
      bind();
      route();
    } catch (e) { return stale(e && e.message || String(e)); }
    try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) { /* 저장소를 못 쓰면 그만 */ }
  }

  // 브라우저가 아니면(테스트 — tests/test_comm_page.py) 규칙만 내보낸다
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { nextState: nextState, knownState: knownState, numberOf: numberOf,
      visibleOf: visibleOf, playOrder: playOrder, neighbor: neighbor, turnEndOf: turnEndOf, repeatStep: repeatStep, migratePrefs: migratePrefs, hideConfirmText: hideConfirmText,
      nextLang: nextLang, langName: langName, nextScope: nextScope, scopeName: scopeName, LANGS: LANGS, SCOPES: SCOPES,
      DEFAULTS: DEFAULTS, LOOP_SLACK: LOOP_SLACK, INTERVALS: INTERVALS, KNOWN_BOX: KNOWN_BOX, DAY: DAY, STORE: STORE, REVIEW: REVIEW, HIDE: HIDE };
    return;
  }
  init();
})();
