/* MacsALogs 섹션 공통(Lang-Studio · Work) — 머리 메뉴 · 섹션 암호(입구에서 한 번, 기기에 기억) · 사이트 뿌리 기준 주소.
   VoiceLang web/lang-studio/assets/ls.js 가 원본이다(빌더가 docs/lang-studio/assets/ · docs/work/assets/ 로 복사). 손으로 고치지 않는다.

   - 이 스크립트가 놓인 폴더(docs/<섹션>/assets/)로 섹션을 안다 — 메뉴 · 암호 열쇠가 섹션마다 다르다(2026-11-24)
   - 페이지 데이터의 상대 주소(audio/comm/…)는 docs/ 기준이다 → LS.url() 로 푼다
   - 암호는 섹션마다 localStorage 하나: Lang-Studio 'ls-pw'(전화영어 · 오디오북 · 회의대본) · Work 'work-pw'(회의록 · Harman-Plus)
   - 암호문 형식은 빌더(publish/builders/secret.py)와 같다: {v, iter, salt, iv, ct} · PBKDF2-SHA256 → AES-256-GCM */
(function () {
  'use strict';
  var me = document.currentScript;
  var ROOT = new URL('../../', me.src);           // docs/
  var HOME = new URL('../', me.src);              // docs/<섹션>/

  /* 섹션 → 이름 · 꼬리말 · 암호 열쇠 · 메뉴(키, 폴더, 이름) — publish/sites/macsalogs.py SECTIONS 와 같은 순서 */
  var SECTIONS = {
    'lang-studio': {
      title: 'Lang-Studio', tagline: '의 영어 학습', pwKey: 'ls-pw',
      oldKeys: ['mom-pw', 'lesson-pw', 'audiobook-pw'],   // 옛 페이지별 열쇠(옛 암호) — 지운다
      pages: [['lesson', 'lesson', '전화영어'], ['audiobook', 'audiobook', '오디오북'], ['drama', 'drama', '미디어'],
              ['talk', 'talk', '일상대화'], ['review', 'review', '표현카드'], ['opic', 'opic', 'OPIc'],
              ['meeting', 'meeting', '회의대본']]
    },
    'work': {
      title: 'Work', tagline: '의 업무 기록', pwKey: 'work-pw', oldKeys: [],
      pages: [['harman', 'harman-plus', 'Harman-Plus'], ['minutes', 'minutes', '회의록']]
    }
  };
  var SECTION = HOME.pathname.replace(/\/$/, '').split('/').pop();
  var SEC = SECTIONS[SECTION] || SECTIONS['lang-studio'];
  var PW_KEY = SEC.pwKey;
  var PAGES = SEC.pages;
  function pageHref(p) { return new URL(p[1] + '/', HOME).href; }

  function url(p) {
    if (!p) return p;
    if (/^(https?:|data:|blob:|\/\/)/.test(p)) return p;
    return new URL(p, ROOT).href;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /* ── 머리 메뉴 ── <header id="ls-header" data-page="talk"></header> */
  function nav() {
    var h = document.getElementById('ls-header');
    if (!h) return;
    var cur = h.getAttribute('data-page') || '';
    var links = PAGES.map(function (p) {
      var on = p[0] === cur ? ' aria-current="page"' : '';
      return '<a href="' + pageHref(p) + '"' + on + '>' + esc(p[2]) + '</a>';
    }).join('');
    h.className = 'site-header ls-header';
    h.innerHTML =
      '<div class="container">' +
      '<div class="site-brand"><h1 class="site-title"><a href="' + HOME.href + '"' + (cur ? '' : ' aria-current="page"') + '>' + esc(SEC.title) + '</a></h1>' +
      '<p class="site-tagline"><a href="' + new URL('index.html', ROOT).href + '">MacsALogs</a> ' + esc(SEC.tagline) + '</p></div>' +
      '<nav class="site-nav ls-nav">' + links + '</nav></div>';
  }

  /* ── 암호 ── */
  var pw = {
    get: function () { try { return localStorage.getItem(PW_KEY) || sessionStorage.getItem(PW_KEY); } catch (e) { return null; } },
    set: function (v, persist) {
      try {
        sessionStorage.setItem(PW_KEY, v);
        if (persist) localStorage.setItem(PW_KEY, v); else localStorage.removeItem(PW_KEY);
        SEC.oldKeys.forEach(function (k) { localStorage.removeItem(k); sessionStorage.removeItem(k); });
      } catch (e) {}
    },
    forget: function () { try { localStorage.removeItem(PW_KEY); sessionStorage.removeItem(PW_KEY); } catch (e) {} }
  };

  function b64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }

  var keys = {};   // (암호, salt, iter) → CryptoKey — PBKDF2 60만 회는 한 번만
  function deriveKey(password, saltB64, iter) {
    var id = saltB64 + ':' + iter + ':' + password.length;
    if (keys[id] && keys[id].pw === password) return keys[id].key;
    var key = crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(saltB64), iterations: iter },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      });
    keys[id] = { pw: password, key: key };
    return key;
  }

  /* 봉인 상자({iter, salt, iv, ct}) → 평문 */
  function decrypt(box, password) {
    if (typeof box === 'string') box = JSON.parse(box);
    return deriveKey(password, box.salt, box.iter).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
  }

  /* 봉인 파일(iv 12바이트 + 암호문) → ArrayBuffer. salt · iter 는 그 페이지의 설정에서 */
  function decryptBytes(buf, password, saltB64, iter) {
    var u = new Uint8Array(buf);
    return deriveKey(password, saltB64, iter).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
    });
  }

  /* 저장된 암호로 먼저 열어 보고(open(pw) 가 Promise), 없거나 틀리면 host 에 입력 창을 띄운다.
     「기기에 기억」은 기본으로 켜 둔다(2026-11-19 사용자 결정) */
  function unlock(host, open, opts) {
    opts = opts || {};
    var saved = pw.get();
    var tried = saved ? open(saved).then(function (r) { return r; }, function () { pw.forget(); return Promise.reject(); })
                      : Promise.reject();
    return tried.catch(function () {
      return new Promise(function (resolve) {
        host.innerHTML =
          '<form class="ls-lock">' +
          '<p class="ls-lock-lead">' + esc(opts.lead || SEC.title + ' 암호를 넣으면 이 기기에서는 다시 묻지 않습니다.') + '</p>' +
          '<div class="ls-lock-row"><input class="ls-lock-input" type="password" autocomplete="current-password" aria-label="암호" required />' +
          '<button class="ls-lock-btn" type="submit">열기</button></div>' +
          '<label class="ls-lock-remember"><input type="checkbox" checked /> 이 기기에 기억</label>' +
          '<p class="ls-lock-msg" role="status" aria-live="polite"></p></form>';
        var form = host.querySelector('form'), input = form.querySelector('input[type=password]'),
            msg = form.querySelector('.ls-lock-msg');
        input.focus();
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var v = input.value;
          msg.textContent = '푸는 중…';
          open(v).then(function (r) {
            pw.set(v, form.querySelector('input[type=checkbox]').checked);
            host.innerHTML = '';
            resolve(r);
          }, function () { msg.textContent = '암호가 맞지 않습니다.'; });
        });
      });
    });
  }

  /* 잠금 해제 버튼(「이 기기에서 잊기」) */
  function forgetButton(el) {
    if (!el) return;
    el.hidden = false;
    el.addEventListener('click', function () { pw.forget(); location.reload(); });
  }

  /* ── 봉인 페이지(전화영어 · 회의록 · Harman-Plus) ──
     목록: <div id="ls-lock"></div><section id="ls-body"></section><script id="ls-data" type="application/json">{봉인}</script>
     상세: 같은 자리 + LS.sealedDetail() — 풀린 문서로 통째로 바꾼다(그 문서가 녹음을 LS.sealedAudio 로 푼다) */
  function box(id) { var el = document.getElementById(id || 'ls-data'); return el ? el.textContent.trim() : ''; }
  function sealedList(onPlain) {
    var b = box();
    return unlock(document.getElementById('ls-lock'), function (p) { return decrypt(b, p); }).then(function (plain) {
      if (onPlain) onPlain(plain); else document.getElementById('ls-body').innerHTML = plain;
      forgetButton(document.getElementById('ls-forget'));
    });
  }
  function sealedDetail() {
    var b = box();
    return unlock(document.getElementById('ls-lock'), function (p) { return decrypt(b, p); }).then(function (plain) {
      document.open(); document.write(plain); document.close();
    });
  }
  /* 잠근 녹음(.bin = iv 12바이트 + 암호문)을 받아 풀고 <audio id="audio"> 에 붙인다 */
  function sealedAudio(src, saltB64, iter, mime) {
    var audio = document.getElementById('audio'), now = document.getElementById('now'), p = pw.get();
    if (!audio || !p) return Promise.resolve();
    var was = now ? now.textContent : '';
    if (now) now.textContent = '녹음을 푸는 중…';
    return fetch(src).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) { return decryptBytes(buf, p, saltB64, iter); }).then(function (plain) {
      audio.src = URL.createObjectURL(new Blob([plain], { type: mime || 'audio/mpeg' }));
      if (now) now.textContent = was;
    }).catch(function (e) { if (now) now.textContent = '녹음을 풀지 못했습니다 (' + e.message + ')'; });
  }

  window.LS = { root: ROOT.href, home: HOME.href, section: SECTION, title: SEC.title, pages: PAGES, pageHref: pageHref, url: url, esc: esc, nav: nav, pw: pw,
                decrypt: decrypt, decryptBytes: decryptBytes, unlock: unlock, forgetButton: forgetButton,
                sealedList: sealedList, sealedDetail: sealedDetail, sealedAudio: sealedAudio };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nav); else nav();
})();
