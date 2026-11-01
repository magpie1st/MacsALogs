/* 오디오북 페이지 — 책 · 챕터 선택, 목차, 문장 동기화 낭독 플레이어.

   데이터는 docs/audiobook.html 안의 #audiobook-data (scripts/build_audiobook.py 가 생성).
     books[].chapters[].paragraphs[] = [kind, text, emSpans, sentenceSpans]
     books[].chapters[].audio = { file, durationSec, rows: [[startMs, endMs], ...] }  (문장 번호 = 배열 순서)

   주소 해시: #<책 id>            → 목차
              #<책 id>/<챕터 id>  → 챕터

   '이전/다음 챕터'(상단)와 '이전/다음 문장'(하단 플레이어)은 다른 것이다 — tvshow 와 같은 원칙.

   플레이어 동작
     ↻ 다시 (A)     지금 문장을 처음부터 한 번 더
     R 문장 반복    켜 두면 지금 문장을 끝없이 되풀이 (R, L)
     S 문장마다 멈춤 문장 끝마다 멈추고, 재생을 누르면 다음 문장 (S, P) — 따라 말하기용
     F 따라가기     낭독 위치를 따라 본문 스크롤 (F)
     이어듣기       챕터별 마지막 위치를 이 브라우저에 기억한다 (localStorage) */
(function () {
  'use strict';

  var FONT_STEPS = [0.85, 0.95, 1.0, 1.1, 1.25, 1.45, 1.65];
  var DEFAULT_FONT = 2;
  var PREFS_KEY = 'audiobook-prefs';
  var POS_KEY = 'audiobook-pos';
  var SKIP_SECONDS = 10;
  var FOLLOW_PAUSE_MS = 6000;
  var PROGRAMMATIC_SCROLL_MS = 1200;
  var RESUME_MIN_SEC = 15;     // 이보다 앞이면 이어듣기를 권하지 않는다
  var END_EPSILON_MS = 40;     // 문장 끝 판정 여유

  var books = [];
  var book = null;
  var chapter = null;          // null 이면 목차
  var fontIndex = DEFAULT_FONT;
  var rate = 1;
  var follow = true;
  var autoNext = true;
  var loopOn = false;
  var stepMode = false;
  var engine = null;           // 고른 낭독 엔진 (gemini / kokoro-bf_emma / kokoro-af_heart). null 이면 책의 defaultEngine
  var ENGINE_NAMES = { gemini: 'Gemini · Sulafat', 'kokoro-bf_emma': 'Kokoro · 영국 여성', 'kokoro-af_heart': 'Kokoro · 미국 여성' };
  var positions = {};          // "책/챕터" -> 초

  var audioEl = null;
  var rows = [];               // [startMs, endMs]
  var segNodes = [];
  var segText = [];
  var activeSeg = -1;
  var holdSeg = -1;            // 반복·멈춤 기준 문장 (재생 중 지나가도 이 문장을 기준으로 판정)
  var rafId = 0;
  var lastSaveAt = 0;
  var lastUserScrollAt = 0;
  var programmaticUntil = 0;
  var pendingAutoplay = false;

  /* 책갈피: 책마다 { last: 읽던 곳(자동), list: 책갈피(직접) }. 이 브라우저(localStorage)에만 있다 */
  var MARKS_KEY = 'audiobook-marks';
  var marks = {};
  var segPara = [];            // 전역 문장 번호 → 문단 번호
  var shownLast = null;        // 이 챕터를 열 때의 '읽던 곳' (읽는 동안 따라 움직이지 않게 고정)
  var lastTimer = null;
  var flashTimer = null;

  /* 암호화 페이지 (build_audiobook.py 기본) */
  var PW_KEY = 'audiobook-pw';
  var cryptoKey = null;        // 본문을 푼 열쇠. 잠근 음원(.bin)도 이 열쇠로 푼다
  var blobUrl = null;          // 지금 재생 중인 복호화 음원
  var audioSeq = 0;            // 챕터를 빨리 넘길 때 늦게 도착한 음원을 버리기 위한 번호

  var el = {};

  /* ── 저장 (실패해도 페이지는 동작해야 한다) ── */
  function readStore(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
  }
  function savePrefs() {
    writeStore(PREFS_KEY, { font: fontIndex, rate: rate, follow: follow, autoNext: autoNext, stepMode: stepMode, engine: engine });
  }

  /* 챕터마다 audios = { gemini: …, kokoro: … }. 고른 엔진이 없으면 있는 엔진으로 */
  function wantedEngine(b) { return engine || b.defaultEngine || 'gemini'; }
  function applyEngine() {
    books.forEach(function (b) {
      var want = wantedEngine(b);
      b.chapters.forEach(function (c) {
        var a = c.audios || (c.audio ? { legacy: c.audio } : {});
        var keys = Object.keys(a);
        c.audios = a;
        c.audio = a[want] || (keys.length ? a[keys[0]] : null);
      });
    });
  }
  function renderEngineOptions() {
    var have = {};
    book.chapters.forEach(function (c) { Object.keys(c.audios || {}).forEach(function (k) { have[k] = (have[k] || 0) + 1; }); });
    var keys = Object.keys(have).filter(function (k) { return ENGINE_NAMES[k]; });
    el.engineWrap.hidden = keys.length < 2;
    el.engine.innerHTML = keys.map(function (k) {
      return '<option value="' + k + '">' + ENGINE_NAMES[k] + ' (' + have[k] + '챕터)</option>';
    }).join('');
    el.engine.value = wantedEngine(book);
  }

  /* ── 복호화 (PBKDF2-SHA256 → AES-256-GCM, WebCrypto) ── */
  function b64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }

  function openSealed(pw, box) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(box.salt), iterations: box.iter },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct)).then(function (plain) {
          return { key: key, data: JSON.parse(new TextDecoder().decode(plain)) };
        });
      });
  }

  /* 잠근 음원: 파일 = iv(12바이트) + 암호문. 통째로 받아 풀고 blob 주소로 재생한다 (blob 은 seek 가능) */
  function openAudio(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12) }, cryptoKey, new Uint8Array(buf, 12));
    }).then(function (plain) {
      return URL.createObjectURL(new Blob([plain], { type: 'audio/mpeg' }));
    });
  }

  function storedPw() {
    try { return sessionStorage.getItem(PW_KEY) || localStorage.getItem(PW_KEY); } catch (e) { return null; }
  }
  function rememberPw(pw, persist) {
    try { sessionStorage.setItem(PW_KEY, pw); if (persist) localStorage.setItem(PW_KEY, pw); } catch (e) { /* 무시 */ }
  }
  function forgetPw() {
    try { sessionStorage.removeItem(PW_KEY); localStorage.removeItem(PW_KEY); } catch (e) { /* 무시 */ }
  }

  /* 저장된 암호로 먼저 풀어 보고, 없거나 틀리면 입력 창을 띄운다 */
  function unlock(data, onOpen) {
    var outline = data.outline || [];
    var first = outline[0] || {};
    el.title.textContent = first.title || 'Audiobook';
    el.sub.textContent = (first.author ? first.author + ' · ' : '') + '암호가 걸린 페이지입니다';
    el.stats.innerHTML = '';
    el.toolbar.hidden = true;
    var saved = storedPw();
    function done(res) {
      cryptoKey = res.key;
      el.toolbar.hidden = false;
      el.lock.hidden = false;
      onOpen(res.data);
    }
    function ask() {
      el.script.innerHTML =
        '<form class="ab-lock" autocomplete="on">' +
        '<h2 class="tv-episode-title">🔒 암호를 입력하세요</h2>' +
        '<p class="tv-episode-meta">' + esc(outline.map(function (b) { return b.title + ' (' + b.chapterCount + '챕터)'; }).join(' · ')) + '</p>' +
        '<input type="text" name="username" value="audiobook" autocomplete="username" hidden />' +
        '<div class="ab-lock-row"><input class="tv-search" id="ab-pw" type="password" autocomplete="current-password" required aria-label="암호" />' +
        '<button class="tv-btn tv-btn--play" type="submit">열기</button></div>' +
        '<label class="tv-follow ab-lock-remember"><input type="checkbox" id="ab-persist" /> 이 기기에 기억</label>' +
        '<p class="tv-search-count" id="ab-pw-msg" role="status" aria-live="polite"></p></form>';
      var form = el.script.querySelector('form');
      var msg = el.script.querySelector('#ab-pw-msg');
      var input = el.script.querySelector('#ab-pw');
      input.focus();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var pw = input.value;
        msg.textContent = '푸는 중…';
        openSealed(pw, data.sealed).then(function (res) {
          rememberPw(pw, el.script.querySelector('#ab-persist').checked);
          done(res);
        }, function () {
          msg.textContent = '암호가 맞지 않습니다.';
          input.select();
        });
      });
    }
    if (saved) openSealed(saved, data.sealed).then(done, function () { forgetPw(); ask(); });
    else ask();
  }

  /* ── 유틸 ── */
  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtLong(sec) {
    var m = Math.round(sec / 60);
    return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : m + '분';
  }
  function isFormField(n) {
    return n && (n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA');
  }
  function posKey(ch) { return book.id + '/' + ch.id + (ch.audio && ch.audio.engine ? '/' + ch.audio.engine : ''); }

  /* 문단 텍스트의 [a,b) 구간을 em 구간을 살려 HTML 로 만든다 */
  function renderRange(text, a, b, em) {
    var cuts = [a, b];
    em.forEach(function (s) {
      if (s[1] > a && s[0] < b) { cuts.push(Math.max(a, s[0])); cuts.push(Math.min(b, s[1])); }
    });
    cuts = cuts.filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
    var html = '';
    for (var i = 0; i + 1 < cuts.length; i++) {
      var p = cuts[i], q = cuts[i + 1];
      var inEm = em.some(function (s) { return s[0] <= p && q <= s[1]; });
      var piece = esc(text.slice(p, q));
      html += inEm ? '<em>' + piece + '</em>' : piece;
    }
    return html;
  }

  /* ── 상단 ── */
  function renderHero() {
    el.title.textContent = book.title;
    var voiced = book.chapters.filter(function (c) { return c.audio; });
    var dur = voiced.reduce(function (s, c) { return s + c.audio.durationSec; }, 0);
    el.sub.innerHTML = esc(book.author) + (chapter ? ' · <strong>' + esc(chapter.title) + '</strong>' : ' · 목차');
    var words = book.chapters.reduce(function (s, c) { return s + c.words; }, 0);
    var chips = [book.chapters.length + '개 챕터', words.toLocaleString() + ' 단어',
                 '음원 ' + voiced.length + '/' + book.chapters.length + (dur ? ' · ' + fmtLong(dur) : '')];
    if (voiced[0] && voiced[0].audio.voice) chips.push('낭독 · ' + voiced[0].audio.voice);
    el.stats.innerHTML = chips.map(function (c) { return '<span class="tv-stat">' + esc(c) + '</span>'; }).join('');
    document.title = (chapter ? chapter.title + ' · ' : '') + book.title + ' — Audiobook';
  }

  function renderOptions() {
    el.book.innerHTML = books.map(function (b) {
      return '<option value="' + esc(b.id) + '">' + esc(b.title) + '</option>';
    }).join('');
    el.book.value = book.id;
    el.bookField.hidden = books.length < 2;
    el.chapter.innerHTML = '<option value="">목차</option>' + book.chapters.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.title) + (c.audio ? '' : ' (준비 중)') + '</option>';
    }).join('');
    el.chapter.value = chapter ? chapter.id : '';
  }

  function chapterIndex() { return chapter ? book.chapters.indexOf(chapter) : -1; }

  function updateChapterNav() {
    var i = chapterIndex();
    el.prev.disabled = i < 0;                       // 목차에서는 이전 없음
    el.next.disabled = i >= book.chapters.length - 1;
    el.prev.textContent = i === 0 ? '◀ 목차' : '◀ 이전 챕터';
  }

  /* ── 책갈피 ── */
  function bookMarks() {
    if (!marks[book.id]) marks[book.id] = { last: null, list: [] };
    return marks[book.id];
  }
  function saveMarks() { writeStore(MARKS_KEY, marks); }
  function paraNodes() { return el.script.querySelectorAll('.ab-para'); }
  function chapterById(id) { return book.chapters.filter(function (c) { return c.id === id; })[0] || null; }
  function snippet(ch, p) {
    var para = ch && ch.paragraphs[p];
    if (!para) return '';
    var t = para[1];
    return t.length > 72 ? t.slice(0, 72) + '…' : t;
  }
  function paraHref(chId, p) {
    return '#' + encodeURIComponent(book.id) + '/' + encodeURIComponent(chId) + '/p' + p;
  }
  /* 지금 읽는 문단: 재생 중이면 낭독 중인 문장의 문단, 아니면 화면 위쪽에 걸친 첫 문단 */
  function currentPara() {
    if (audioEl && !audioEl.paused && activeSeg >= 0 && segPara[activeSeg] != null) return segPara[activeSeg];
    var nodes = paraNodes();
    var top = 10;   // 화면 맨 위에 걸친 첫 문단 = 지금 읽는 곳 (짧은 대사 문단이 이어져도 건너뛰지 않게)
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getBoundingClientRect().bottom > top) return i;
    }
    return Math.max(0, nodes.length - 1);
  }
  function rememberLast() {
    if (!chapter || !paraNodes().length) return;
    bookMarks().last = { ch: chapter.id, para: currentPara(), at: Date.now() };
    saveMarks();
  }
  function markIndex(chId, p) {
    var list = bookMarks().list;
    for (var i = 0; i < list.length; i++) if (list[i].ch === chId && list[i].para === p) return i;
    return -1;
  }
  function paintMarks() {
    var nodes = paraNodes();
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('has-mark', markIndex(chapter.id, i) >= 0);
      nodes[i].classList.toggle('is-last', !!shownLast && shownLast.para === i);
    }
  }
  function flash(msg) {
    el.markStatus.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.markStatus.textContent = ''; }, 2500);
  }
  function toggleMark(p) {
    if (!chapter) { flash('챕터를 연 뒤에 꽂을 수 있습니다'); return; }
    if (p == null) p = currentPara();
    var list = bookMarks().list;
    var i = markIndex(chapter.id, p);
    if (i >= 0) {
      list.splice(i, 1);
      flash('책갈피를 뺐습니다');
    } else {
      list.push({ ch: chapter.id, para: p, at: Date.now(), text: snippet(chapter, p) });
      flash('🔖 ' + chapter.title + ' · 문단 ' + (p + 1) + '에 꽂았습니다');
    }
    saveMarks();
    paintMarks();
  }
  function jumpToPara(p) {
    var node = paraNodes()[p];
    if (!node) return;
    programmaticUntil = Date.now() + PROGRAMMATIC_SCROLL_MS;
    lastUserScrollAt = Date.now();   // 낭독 따라가기가 곧바로 다른 곳으로 끌고 가지 않게
    node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    node.classList.add('is-flash');
    setTimeout(function () { node.classList.remove('is-flash'); }, 1800);
  }
  function renderMarksSection() {
    var bm = bookMarks();
    var html = '';
    var last = bm.last && chapterById(bm.last.ch);
    if (last) {
      html += '<p class="ab-last-link">📖 읽던 곳: <a href="' + paraHref(last.id, bm.last.para) + '">' + esc(last.title) +
        ' · 문단 ' + (bm.last.para + 1) + '</a> <span class="ab-toc-meta">' + esc(snippet(last, bm.last.para)) + '</span></p>';
    }
    var list = bm.list.filter(function (m) { return chapterById(m.ch); }).sort(function (a, b) {
      return chapterById(a.ch).number - chapterById(b.ch).number || a.para - b.para;
    });
    if (list.length) {
      html += '<h3 class="ab-marks-head">🔖 책갈피 ' + list.length + '</h3><ul class="ab-marks">' + list.map(function (m) {
        var ch = chapterById(m.ch);
        return '<li><a href="' + paraHref(m.ch, m.para) + '"><strong>' + esc(ch.title) + '</strong> · ' +
          esc(snippet(ch, m.para) || m.text || '') + '</a>' +
          '<button type="button" class="tv-btn tv-btn--text" data-del-ch="' + esc(m.ch) + '" data-del-p="' + m.para +
          '" aria-label="책갈피 빼기">✕</button></li>';
      }).join('') + '</ul>';
    }
    return html;
  }

  /* ── 목차 ── */
  function renderToc() {
    var html = '<header class="tv-episode-head"><h2 class="tv-episode-title" id="ab-head">목차</h2>' +
      '<p class="tv-episode-meta">챕터를 누르면 본문과 낭독으로 이동합니다. 목차는 낭독하지 않습니다.</p></header>' +
      renderMarksSection();
    var epi = (book.front && book.front.epigraph) || [];
    if (epi.length) {
      html += '<blockquote class="ab-epigraph">' + epi.map(function (p) {
        return '<p class="' + (p.kind === 'attribution' ? 'ab-epi-attr' : '') + '">' +
          renderRange(p.text, 0, p.text.length, p.em || []) + '</p>';
      }).join('') + '</blockquote>';
    }
    html += '<ol class="ab-toc">' + book.chapters.map(function (c) {
      var pos = positions[posKey(c)];
      var meta = c.audio ? fmt(c.audio.durationSec) + (c.audio.partial ? ' <span class="ab-toc-pending">일부</span>' : '')
                         : '<span class="ab-toc-pending">준비 중</span>';
      var resume = c.audio && pos >= RESUME_MIN_SEC
        ? '<span class="ab-toc-resume">이어듣기 ' + fmt(pos) + '</span>' : '';
      return '<li><a href="#' + encodeURIComponent(book.id) + '/' + encodeURIComponent(c.id) + '">' +
        '<span class="ab-toc-title">' + esc(c.title) + '</span>' + resume +
        '<span class="ab-toc-meta">' + c.words.toLocaleString() + ' 단어 · ' + meta + '</span></a></li>';
    }).join('') + '</ol>';
    el.script.innerHTML = html;
  }

  /* ── 챕터 본문 ── */
  function renderChapter() {
    var c = chapter;
    var html = '<header class="tv-episode-head"><h2 class="tv-episode-title" id="ab-head">' + esc(c.title) + '</h2>' +
      '<p class="tv-episode-meta">' + c.words.toLocaleString() + ' 단어 · 문장 ' + c.sentenceCount +
      (c.audio ? ' · ' + fmt(c.audio.durationSec) : '') + '</p>';
    if (!c.audio) html += '<p class="tv-episode-note">이 챕터는 아직 낭독 음원이 없습니다. 본문만 볼 수 있습니다.</p>';
    else if (c.audio.partial) html += '<p class="tv-episode-note">낭독을 만드는 중입니다. 앞 ' + c.audio.rows.length + '문장(전체 ' +
      c.sentenceCount + '문장)까지만 음원이 있습니다.</p>';
    else if (c.audio.preview) html += '<p class="tv-episode-note">로컬 미리보기 음원입니다.</p>';
    if (c.audio && c.audio.engine && c.audio.engine !== wantedEngine(book)) {
      html += '<p class="tv-episode-note">' + (ENGINE_NAMES[wantedEngine(book)] || wantedEngine(book)) + ' 낭독이 아직 없어 ' +
        (ENGINE_NAMES[c.audio.engine] || c.audio.engine) + ' 낭독으로 재생합니다.</p>';
    }
    var bm = bookMarks();
    shownLast = bm.last && bm.last.ch === c.id ? { para: bm.last.para } : null;
    if (shownLast && shownLast.para > 0) {
      html += '<p class="ab-last-row"><button type="button" class="tv-btn tv-btn--text" id="ab-golast">📖 읽던 곳으로 · 문단 ' +
        (shownLast.para + 1) + '</button></p>';
    }
    html += '</header>';

    var g = 0;
    var firstProse = true;
    segText = [];
    segPara = [];
    c.paragraphs.forEach(function (p, pi) {
      var kind = p[0], text = p[1], em = p[2], spans = p[3];
      var cls = 'ab-para ab-para--' + kind;
      if (kind === 'p' && firstProse) { cls += ' ab-para--first'; firstProse = false; }
      if (kind !== 'p') firstProse = kind === 'attribution' || kind === 'title' ? true : firstProse;
      var inner = spans.map(function (s) {
        var i = g++;
        segText[i] = text.slice(s[0], s[1]).trim();
        segPara[i] = pi;
        var body = renderRange(text, s[0], s[1], em);
        return c.audio && i < c.audio.rows.length ? '<span class="tv-seg" role="button" tabindex="0" data-seg="' + i + '">' + body + '</span>' : body;
      }).join('');
      html += '<p class="' + cls + '" data-p="' + pi + '">' +
        '<button type="button" class="ab-ribbon" data-ribbon="' + pi + '" title="책갈피 빼기" aria-label="책갈피 빼기">🔖</button>' +
        inner + '</p>';
    });
    el.script.innerHTML = html;
    segNodes = [];
    var nodes = el.script.querySelectorAll('.tv-seg');
    for (var i = 0; i < nodes.length; i++) segNodes[+nodes[i].getAttribute('data-seg')] = nodes[i];
    paintMarks();
  }

  function applyFont() {
    el.script.style.setProperty('--tv-font-scale', FONT_STEPS[fontIndex]);
    el.fontValue.textContent = Math.round(FONT_STEPS[fontIndex] * 100) + '%';
    el.fontDown.disabled = fontIndex === 0;
    el.fontUp.disabled = fontIndex === FONT_STEPS.length - 1;
  }

  /* ── 스크롤 따라가기 ── */
  function needsScroll(node) {
    var box = node.getBoundingClientRect();
    return box.top < window.innerHeight * 0.15 || box.bottom > window.innerHeight * 0.68;
  }
  function scrollToNode(node) {
    programmaticUntil = Date.now() + PROGRAMMATIC_SCROLL_MS;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ── 문장 강조 ── */
  function findSegment(ms) {
    if (!rows.length) return -1;
    if (ms < rows[0][0]) return 0;
    var lo = 0, hi = rows.length - 1;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (rows[mid][0] <= ms) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  function setActive(i, allowScroll) {
    if (i === activeSeg) return;
    if (activeSeg >= 0 && segNodes[activeSeg]) {
      segNodes[activeSeg].classList.remove('is-active');
      segNodes[activeSeg].removeAttribute('aria-current');
    }
    activeSeg = i;
    if (i >= 0 && segNodes[i]) {
      segNodes[i].classList.add('is-active');
      segNodes[i].setAttribute('aria-current', 'true');
      if (allowScroll && follow && Date.now() - lastUserScrollAt > FOLLOW_PAUSE_MS && needsScroll(segNodes[i])) {
        scrollToNode(segNodes[i]);
      }
    }
    // 지금 문장은 본문 강조로 보인다. 플레이어 줄(el.now)에는 상태 메시지만 쓴다 — 바를 얇게 두려고
  }

  /* ── 재생 루프 ──
     timeupdate 는 초당 4번 정도라 문장 끝을 최대 0.25초 넘긴다. 반복·문장마다 멈춤은
     그 오차가 귀에 들리므로, 재생 중에는 rAF 로 매 프레임 확인한다. */
  function tick() {
    rafId = 0;
    if (!audioEl || audioEl.paused) return;
    var ms = audioEl.currentTime * 1000;
    var target = holdSeg >= 0 ? holdSeg : activeSeg;
    if ((loopOn || stepMode) && target >= 0 && rows[target] && ms >= rows[target][1] - END_EPSILON_MS) {
      if (loopOn) {
        audioEl.currentTime = rows[target][0] / 1000;
        ms = rows[target][0];
      } else {
        audioEl.pause();
        var next = Math.min(rows.length - 1, target + 1);
        audioEl.currentTime = rows[next][0] / 1000;
        holdSeg = next;
        setActive(next, true);
        updateProgress();
        return;
      }
    }
    var seg = findSegment(ms);
    if (!loopOn && !stepMode) holdSeg = -1;
    else if (holdSeg < 0) holdSeg = seg;
    setActive(holdSeg >= 0 ? holdSeg : seg, true);
    updateProgress();
    rafId = requestAnimationFrame(tick);
  }
  function startTick() { if (!rafId) rafId = requestAnimationFrame(tick); }

  function updateProgress() {
    el.seek.value = String(audioEl.currentTime);
    el.timeNow.textContent = fmt(audioEl.currentTime);
    if (chapter && chapter.audio && Date.now() - lastSaveAt > 3000) savePosition();
  }
  function savePosition() {
    lastSaveAt = Date.now();
    var t = audioEl.currentTime;
    var dur = chapter.audio.durationSec;
    if (dur - t < 5) delete positions[posKey(chapter)]; else positions[posKey(chapter)] = Math.round(t);
    writeStore(POS_KEY, positions);
  }

  function updatePlayButton() {
    var playing = audioEl && !audioEl.paused;
    el.play.textContent = playing ? '❚❚' : '▶';
    el.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
  }
  function syncToggles() {
    [[el.loop, loopOn], [el.stepmode, stepMode], [el.follow, follow]].forEach(function (pair) {
      pair[0].classList.toggle('is-on', pair[1]);
      pair[0].setAttribute('aria-pressed', String(pair[1]));
    });
  }

  /* GitHub Release 음원 주소는 30분짜리 서명 주소로 넘어간다. 오래 멈췄다가 누르면 403 이 나므로
     실패하면 한 번만 음원을 다시 열고 그 자리로 돌아간다 (tvshow.js 와 같은 이유). */
  var reviving = false;
  function requestPlay() {
    var p = audioEl.play();
    if (p && p.catch) p.catch(function () {
      if (reviving || !chapter || !chapter.audio || chapter.audio.enc) return;   // blob 음원은 만료되지 않는다
      reviving = true;
      var at = audioEl.currentTime, mine = chapter;
      el.now.textContent = '음원을 다시 엽니다…';
      audioEl.src = chapter.audio.file;
      audioEl.addEventListener('loadedmetadata', function back() {
        audioEl.removeEventListener('loadedmetadata', back);
        reviving = false;
        if (chapter !== mine) return;
        audioEl.playbackRate = rate;
        try { audioEl.currentTime = at; } catch (e) { /* 범위 밖이면 그대로 */ }
        audioEl.play().catch(function () { el.now.textContent = '음원을 재생할 수 없습니다. 새로고침해 주세요.'; });
      });
      audioEl.load();
    });
  }

  function seekToSegment(i, play) {
    if (!rows[i]) return;
    audioEl.currentTime = rows[i][0] / 1000;
    holdSeg = (loopOn || stepMode) ? i : -1;
    setActive(i, true);
    updateProgress();
    if (play && audioEl.paused) requestPlay();
  }
  function currentSeg() {
    return activeSeg >= 0 ? activeSeg : findSegment(audioEl.currentTime * 1000);
  }
  function stepSegment(d) {
    if (!rows.length) return;
    var next = Math.min(rows.length - 1, Math.max(0, currentSeg() + d));
    seekToSegment(next, !audioEl.paused);
  }
  function repeatSegment() { if (rows.length) seekToSegment(Math.max(0, currentSeg()), true); }
  function togglePlay() {
    if (!chapter || !chapter.audio) return;
    if (audioEl.paused) {
      // 멈춘 문장 위치에서 시작한다 (문장마다 멈춤 모드에서 '재생' = 다음 문장)
      if (holdSeg >= 0 && rows[holdSeg]) audioEl.currentTime = Math.max(audioEl.currentTime, rows[holdSeg][0] / 1000);
      requestPlay();
    } else {
      audioEl.pause();
    }
  }
  function skip(s) {
    audioEl.currentTime = Math.min(chapter.audio.durationSec, Math.max(0, audioEl.currentTime + s));
    holdSeg = -1;
    if (loopOn || stepMode) holdSeg = findSegment(audioEl.currentTime * 1000);
    setActive(findSegment(audioEl.currentTime * 1000), true);
    updateProgress();
  }

  function setupAudio() {
    audioEl.pause();
    reviving = false;
    holdSeg = -1;
    setActive(-1, false);
    var a = chapter && chapter.audio;
    el.resumeBar.hidden = true;
    if (!a) {
      rows = [];
      el.player.hidden = true;
      document.body.classList.remove('has-tv-player');
      audioEl.removeAttribute('src');
      audioEl.load();
      updatePlayButton();
      return;
    }
    rows = a.rows;
    el.player.hidden = false;
    document.body.classList.add('has-tv-player');
    var seq = ++audioSeq;
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    if (a.enc) {
      audioEl.removeAttribute('src');
      el.play.disabled = true;
      el.now.textContent = '음원을 받아 푸는 중…';
      openAudio(a.file).then(function (url) {
        if (seq !== audioSeq) { URL.revokeObjectURL(url); return; }   // 그 사이 챕터를 바꿨다
        blobUrl = url;
        audioEl.src = url;
        audioEl.playbackRate = rate;
        el.play.disabled = false;
        el.now.textContent = '';
        if (pendingAutoplay) { pendingAutoplay = false; requestPlay(); }
      }, function (err) {
        if (seq !== audioSeq) return;
        el.now.textContent = '음원을 열 수 없습니다 (' + err.message + ')';
      });
    } else {
      el.play.disabled = false;
      audioEl.src = a.file;
    }
    audioEl.playbackRate = rate;
    el.seek.max = String(a.durationSec);
    el.seek.value = '0';
    el.timeNow.textContent = '0:00';
    el.timeTotal.textContent = fmt(a.durationSec);
    var pos = positions[posKey(chapter)];
    if (pos >= RESUME_MIN_SEC) {
      el.resume.textContent = '↩ ' + fmt(pos) + '부터 이어듣기';
      el.resumeBar.hidden = false;
    }
    updatePlayButton();
    if (pendingAutoplay && !a.enc) {
      pendingAutoplay = false;
      requestPlay();
    }
  }

  /* ── 전환 ── */
  function show(bookId, chapterId, updateHash, para) {
    var b = books.filter(function (x) { return x.id === bookId; })[0] || books[0];
    var c = chapterId ? b.chapters.filter(function (x) { return x.id === chapterId; })[0] || null : null;
    if (audioEl && chapter && chapter.audio && audioEl.currentTime > 0) savePosition();
    if (chapter) rememberLast();
    book = b;
    chapter = c;
    renderOptions();
    renderEngineOptions();
    renderHero();
    if (chapter) renderChapter(); else renderToc();
    applyFont();
    updateChapterNav();
    setupAudio();
    if (updateHash) {
      var h = '#' + encodeURIComponent(book.id) + (chapter ? '/' + encodeURIComponent(chapter.id) : '');
      if (location.hash !== h) history.pushState(null, '', h);
    }
    if (chapter && para != null) setTimeout(function () { jumpToPara(para); }, 60);
    else window.scrollTo({ top: 0 });
  }
  function stepChapter(d) {
    var i = chapterIndex() + d;
    if (i < -1 || i >= book.chapters.length) return;
    show(book.id, i < 0 ? null : book.chapters[i].id, true);
  }
  function fromHash() {
    var raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    var parts = raw.split('/');
    var m = /^p(\d+)$/.exec(parts[2] || '');
    var para = m ? +m[1] : null;
    if (book && book.id === parts[0] && (chapter ? chapter.id : null) === (parts[1] || null)) {
      if (para != null) jumpToPara(para);
      return;
    }
    show(parts[0] || books[0].id, parts[1] || null, false, para);
  }

  /* ── 시작 ── */
  function init() {
    var node = document.getElementById('audiobook-data');
    var data = null;
    try { data = JSON.parse(node.textContent); } catch (e) { /* 아래에서 처리 */ }
    var ids = ['book-title', 'book-sub', 'stats', 'book-field', 'book', 'chapter', 'ch-prev', 'ch-next',
               'font-down', 'font-value', 'font-up', 'font-reset', 'top', 'player', 'resume-bar', 'resume',
               'now', 'time-now', 'seek', 'time-total', 'seg-prev', 'play', 'seg-next',
               'repeat', 'loop', 'stepmode', 'rate', 'follow', 'autonext', 'audio',
               'bookmark', 'bookmark-bar', 'mark-status', 'engine', 'engine-wrap'];
    var names = ['title', 'sub', 'stats', 'bookField', 'book', 'chapter', 'prev', 'next',
                 'fontDown', 'fontValue', 'fontUp', 'fontReset', 'top', 'player', 'resumeBar', 'resume',
                 'now', 'timeNow', 'seek', 'timeTotal', 'segPrev', 'play', 'segNext',
                 'repeat', 'loop', 'stepmode', 'rate', 'follow', 'autonext', 'audio',
                 'bookmark', 'bookmarkBar', 'markStatus', 'engine', 'engineWrap'];
    ids.forEach(function (id, i) { el[names[i]] = document.getElementById('ab-' + id); });
    el.script = document.getElementById('tv-script');
    el.toolbar = document.querySelector('.tv-toolbar');
    el.lock = document.getElementById('ab-lock');
    audioEl = el.audio;
    el.lock.addEventListener('click', function () { forgetPw(); location.reload(); });

    if (data && data.sealed) {
      if (!(window.crypto && crypto.subtle)) {
        el.script.innerHTML = '<div class="empty-state"><p>이 브라우저에서는 암호를 풀 수 없습니다 (https 로 열어 주세요).</p></div>';
        return;
      }
      unlock(data, start);
    } else {
      start(data);
    }
  }

  function start(data) {
    books = (data && data.books) || [];
    if (!books.length) {
      el.script.innerHTML = '<div class="empty-state"><p>아직 실린 책이 없습니다.</p></div>';
      return;
    }

    var prefs = readStore(PREFS_KEY, {});
    if (typeof prefs.font === 'number' && FONT_STEPS[prefs.font]) fontIndex = prefs.font;
    if (prefs.rate) rate = prefs.rate;
    if (typeof prefs.follow === 'boolean') follow = prefs.follow;
    if (typeof prefs.autoNext === 'boolean') autoNext = prefs.autoNext;
    if (typeof prefs.stepMode === 'boolean') stepMode = prefs.stepMode;
    positions = readStore(POS_KEY, {});
    if (prefs.engine) engine = prefs.engine;
    applyEngine();
    el.rate.value = String(rate);
    if (el.rate.value !== String(rate)) { rate = 1; el.rate.value = '1'; }
    el.autonext.checked = autoNext;
    syncToggles();

    el.book.addEventListener('change', function () { show(el.book.value, null, true); });
    el.chapter.addEventListener('change', function () { show(book.id, el.chapter.value || null, true); window.scrollTo({ top: 0 }); });
    el.prev.addEventListener('click', function () { stepChapter(-1); });
    el.next.addEventListener('click', function () { stepChapter(1); });
    window.addEventListener('hashchange', fromHash);

    el.fontDown.addEventListener('click', function () { if (fontIndex > 0) { fontIndex--; applyFont(); savePrefs(); } });
    el.fontUp.addEventListener('click', function () { if (fontIndex < FONT_STEPS.length - 1) { fontIndex++; applyFont(); savePrefs(); } });
    el.fontReset.addEventListener('click', function () { fontIndex = DEFAULT_FONT; applyFont(); savePrefs(); });

    el.script.addEventListener('click', function (e) {
      var seg = e.target.closest && e.target.closest('.tv-seg');
      if (seg) seekToSegment(+seg.getAttribute('data-seg'), true);
    });
    el.script.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tv-seg')) {
        e.preventDefault();
        seekToSegment(+e.target.getAttribute('data-seg'), true);
      }
    });

    el.play.addEventListener('click', togglePlay);
    el.segPrev.addEventListener('click', function () { stepSegment(-1); });
    el.segNext.addEventListener('click', function () { stepSegment(1); });
    el.repeat.addEventListener('click', repeatSegment);
    el.loop.addEventListener('click', function () {
      loopOn = !loopOn;
      holdSeg = loopOn || stepMode ? currentSeg() : -1;
      syncToggles();
    });
    marks = readStore(MARKS_KEY, {});
    el.engine.addEventListener('change', function () {
      engine = el.engine.value;
      savePrefs();
      applyEngine();
      show(book.id, chapter ? chapter.id : null, false);
    });
    el.bookmark.addEventListener('click', function () { toggleMark(); });
    el.bookmarkBar.addEventListener('click', function () { toggleMark(); });
    el.script.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var rib = t.closest('.ab-ribbon');
      if (rib) { e.stopPropagation(); toggleMark(+rib.getAttribute('data-ribbon')); return; }
      if (t.closest('#ab-golast') && shownLast) { jumpToPara(shownLast.para); return; }
      var del = t.closest('[data-del-ch]');
      if (del) {
        var i = markIndex(del.getAttribute('data-del-ch'), +del.getAttribute('data-del-p'));
        if (i >= 0) { bookMarks().list.splice(i, 1); saveMarks(); renderToc(); }
      }
    }, true);
    el.stepmode.addEventListener('click', function () {
      stepMode = !stepMode;
      holdSeg = loopOn || stepMode ? currentSeg() : -1;
      syncToggles();
      savePrefs();
    });
    el.resume.addEventListener('click', function () {
      var pos = positions[posKey(chapter)] || 0;
      // 문장 처음으로 맞춘다 — 문장 한가운데서 시작하면 듣기 어렵다
      var i = findSegment(pos * 1000);
      el.resumeBar.hidden = true;
      seekToSegment(Math.max(0, i), true);
    });
    el.rate.addEventListener('change', function () {
      rate = parseFloat(el.rate.value) || 1;
      audioEl.playbackRate = rate;
      savePrefs();
    });
    el.follow.addEventListener('click', function () {
      follow = !follow;
      if (follow) lastUserScrollAt = 0;   // 켜는 순간 지금 문장으로 돌아간다
      syncToggles();
      savePrefs();
      if (follow && activeSeg >= 0 && segNodes[activeSeg]) scrollToNode(segNodes[activeSeg]);
    });
    el.autonext.addEventListener('change', function () { autoNext = el.autonext.checked; savePrefs(); });
    el.seek.addEventListener('input', function () {
      audioEl.currentTime = parseFloat(el.seek.value) || 0;
      holdSeg = loopOn || stepMode ? findSegment(audioEl.currentTime * 1000) : -1;
      setActive(findSegment(audioEl.currentTime * 1000), true);
      el.timeNow.textContent = fmt(audioEl.currentTime);
    });

    audioEl.addEventListener('play', function () { updatePlayButton(); el.resumeBar.hidden = true; startTick(); });
    audioEl.addEventListener('pause', function () { updatePlayButton(); if (chapter && chapter.audio) savePosition(); rememberLast(); });
    audioEl.addEventListener('timeupdate', function () { if (audioEl.paused) updateProgress(); });
    audioEl.addEventListener('ended', function () {
      updatePlayButton();
      if (chapter) { delete positions[posKey(chapter)]; writeStore(POS_KEY, positions); }
      var i = chapterIndex();
      var nxt = book.chapters[i + 1];
      if (autoNext && nxt && nxt.audio && !loopOn) {
        pendingAutoplay = true;
        show(book.id, nxt.id, true);
        window.scrollTo({ top: 0 });
      }
    });

    window.addEventListener('scroll', function () {
      if (chapter) { clearTimeout(lastTimer); lastTimer = setTimeout(rememberLast, 900); }
      if (Date.now() > programmaticUntil) lastUserScrollAt = Date.now();
      el.top.hidden = window.scrollY < 400;
    }, { passive: true });
    el.top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    window.addEventListener('pagehide', function () { rememberLast(); });
    window.addEventListener('pagehide', function () { if (chapter && chapter.audio && audioEl.currentTime > 0) savePosition(); });

    document.addEventListener('keydown', function (e) {
      if (isFormField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'b' || e.key === 'B') && chapter) { toggleMark(); return; }
      var hasAudio = chapter && chapter.audio;
      if (e.key === '[' || e.key === ']') { e.preventDefault(); stepChapter(e.key === '[' ? -1 : 1); }
      else if (!hasAudio) return;
      else if (e.key === ' ' && !(e.target.classList && e.target.classList.contains('tv-seg'))) { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepSegment(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepSegment(1); }
      else if (e.key === 'a' || e.key === 'A') repeatSegment();
      else if (e.key === 'r' || e.key === 'R' || e.key === 'l' || e.key === 'L') el.loop.click();
      else if (e.key === 's' || e.key === 'S' || e.key === 'p' || e.key === 'P') el.stepmode.click();
      else if (e.key === 'f' || e.key === 'F') el.follow.click();
    });

    fromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
