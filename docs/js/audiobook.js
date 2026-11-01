/* 오디오북 페이지 — 책 · 챕터 선택, 목차, 문장 동기화 낭독 플레이어.

   데이터는 docs/audiobook.html 안의 #audiobook-data (scripts/build_audiobook.py 가 생성).
     books[].chapters[].paragraphs[] = [kind, text, emSpans, sentenceSpans]
     books[].chapters[].audio = { file, durationSec, rows: [[startMs, endMs], ...] }  (문장 번호 = 배열 순서)

   주소 해시: #<책 id>            → 목차
              #<책 id>/<챕터 id>  → 챕터

   '이전/다음 챕터'(상단)와 '이전/다음 문장'(하단 플레이어)은 다른 것이다 — tvshow 와 같은 원칙.

   플레이어 동작
     ↻ 다시         지금 문장을 처음부터 한 번 더
     문장 반복      켜 두면 지금 문장을 끝없이 되풀이 (L)
     문장마다 멈춤  문장 끝마다 멈추고, 재생을 누르면 다음 문장 (P) — 따라 말하기용
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
    writeStore(PREFS_KEY, { font: fontIndex, rate: rate, follow: follow, autoNext: autoNext, stepMode: stepMode });
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
  function posKey(ch) { return book.id + '/' + ch.id; }

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

  /* ── 목차 ── */
  function renderToc() {
    var html = '<header class="tv-episode-head"><h2 class="tv-episode-title" id="ab-head">목차</h2>' +
      '<p class="tv-episode-meta">챕터를 누르면 본문과 낭독으로 이동합니다. 목차는 낭독하지 않습니다.</p></header>';
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
    html += '</header>';

    var g = 0;
    var firstProse = true;
    segText = [];
    c.paragraphs.forEach(function (p) {
      var kind = p[0], text = p[1], em = p[2], spans = p[3];
      var cls = 'ab-para ab-para--' + kind;
      if (kind === 'p' && firstProse) { cls += ' ab-para--first'; firstProse = false; }
      if (kind !== 'p') firstProse = kind === 'attribution' || kind === 'title' ? true : firstProse;
      var inner = spans.map(function (s) {
        var i = g++;
        segText[i] = text.slice(s[0], s[1]).trim();
        var body = renderRange(text, s[0], s[1], em);
        return c.audio && i < c.audio.rows.length ? '<span class="tv-seg" role="button" tabindex="0" data-seg="' + i + '">' + body + '</span>' : body;
      }).join('');
      html += '<p class="' + cls + '">' + inner + '</p>';
    });
    el.script.innerHTML = html;
    segNodes = [];
    var nodes = el.script.querySelectorAll('.tv-seg');
    for (var i = 0; i < nodes.length; i++) segNodes[+nodes[i].getAttribute('data-seg')] = nodes[i];
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
    el.now.textContent = i >= 0 ? (i + 1) + '/' + rows.length + ' · ' + segText[i] : '—';
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
    el.play.textContent = playing ? '일시정지' : '재생';
    el.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
  }
  function syncToggles() {
    [[el.loop, loopOn], [el.stepmode, stepMode]].forEach(function (pair) {
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
        el.now.textContent = '—';
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
  function show(bookId, chapterId, updateHash) {
    var b = books.filter(function (x) { return x.id === bookId; })[0] || books[0];
    var c = chapterId ? b.chapters.filter(function (x) { return x.id === chapterId; })[0] || null : null;
    if (audioEl && chapter && chapter.audio && audioEl.currentTime > 0) savePosition();
    book = b;
    chapter = c;
    renderOptions();
    renderHero();
    if (chapter) renderChapter(); else renderToc();
    applyFont();
    updateChapterNav();
    setupAudio();
    if (updateHash) {
      var h = '#' + encodeURIComponent(book.id) + (chapter ? '/' + encodeURIComponent(chapter.id) : '');
      if (location.hash !== h) history.pushState(null, '', h);
    }
  }
  function stepChapter(d) {
    var i = chapterIndex() + d;
    if (i < -1 || i >= book.chapters.length) return;
    show(book.id, i < 0 ? null : book.chapters[i].id, true);
    window.scrollTo({ top: 0 });
  }
  function fromHash() {
    var raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    var parts = raw.split('/');
    if (book && book.id === parts[0] && (chapter ? chapter.id : null) === (parts[1] || null)) return;
    show(parts[0] || books[0].id, parts[1] || null, false);
  }

  /* ── 시작 ── */
  function init() {
    var node = document.getElementById('audiobook-data');
    var data = null;
    try { data = JSON.parse(node.textContent); } catch (e) { /* 아래에서 처리 */ }
    var ids = ['book-title', 'book-sub', 'stats', 'book-field', 'book', 'chapter', 'ch-prev', 'ch-next',
               'font-down', 'font-value', 'font-up', 'font-reset', 'top', 'player', 'resume-bar', 'resume',
               'now', 'time-now', 'seek', 'time-total', 'seg-prev', 'back10', 'play', 'fwd10', 'seg-next',
               'repeat', 'loop', 'stepmode', 'rate', 'follow', 'autonext', 'audio'];
    var names = ['title', 'sub', 'stats', 'bookField', 'book', 'chapter', 'prev', 'next',
                 'fontDown', 'fontValue', 'fontUp', 'fontReset', 'top', 'player', 'resumeBar', 'resume',
                 'now', 'timeNow', 'seek', 'timeTotal', 'segPrev', 'back10', 'play', 'fwd10', 'segNext',
                 'repeat', 'loop', 'stepmode', 'rate', 'follow', 'autonext', 'audio'];
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
    el.rate.value = String(rate);
    if (el.rate.value !== String(rate)) { rate = 1; el.rate.value = '1'; }
    el.follow.checked = follow;
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
    el.back10.addEventListener('click', function () { skip(-SKIP_SECONDS); });
    el.fwd10.addEventListener('click', function () { skip(SKIP_SECONDS); });
    el.repeat.addEventListener('click', repeatSegment);
    el.loop.addEventListener('click', function () {
      loopOn = !loopOn;
      holdSeg = loopOn || stepMode ? currentSeg() : -1;
      syncToggles();
    });
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
    el.follow.addEventListener('change', function () { follow = el.follow.checked; savePrefs(); });
    el.autonext.addEventListener('change', function () { autoNext = el.autonext.checked; savePrefs(); });
    el.seek.addEventListener('input', function () {
      audioEl.currentTime = parseFloat(el.seek.value) || 0;
      holdSeg = loopOn || stepMode ? findSegment(audioEl.currentTime * 1000) : -1;
      setActive(findSegment(audioEl.currentTime * 1000), true);
      el.timeNow.textContent = fmt(audioEl.currentTime);
    });

    audioEl.addEventListener('play', function () { updatePlayButton(); el.resumeBar.hidden = true; startTick(); });
    audioEl.addEventListener('pause', function () { updatePlayButton(); if (chapter && chapter.audio) savePosition(); });
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
      if (Date.now() > programmaticUntil) lastUserScrollAt = Date.now();
      el.top.hidden = window.scrollY < 400;
    }, { passive: true });
    el.top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    window.addEventListener('pagehide', function () { if (chapter && chapter.audio && audioEl.currentTime > 0) savePosition(); });

    document.addEventListener('keydown', function (e) {
      if (isFormField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      var hasAudio = chapter && chapter.audio;
      if (e.key === '[' || e.key === ']') { e.preventDefault(); stepChapter(e.key === '[' ? -1 : 1); }
      else if (!hasAudio) return;
      else if (e.key === ' ' && !(e.target.classList && e.target.classList.contains('tv-seg'))) { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepSegment(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepSegment(1); }
      else if (e.key === 'r' || e.key === 'R') repeatSegment();
      else if (e.key === 'l' || e.key === 'L') el.loop.click();
      else if (e.key === 'p' || e.key === 'P') el.stepmode.click();
    });

    fromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
