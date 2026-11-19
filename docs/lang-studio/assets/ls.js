/* Lang-Studio 공통 — 머리 메뉴 · 암호 하나(입구에서 한 번, 기기에 기억) · 사이트 뿌리 기준 주소.
   VoiceLang web/lang-studio/assets/ls.js 가 원본이다(빌더가 docs/lang-studio/assets/ 로 복사). 손으로 고치지 않는다.

   - 페이지 데이터의 상대 주소(audio/comm/…)는 docs/ 기준이다 → LS.url() 로 푼다
   - 암호는 localStorage 'ls-pw' 하나. 회의록 · 전화영어 · 오디오북이 같이 쓴다
   - 암호문 형식은 빌더(publish/builders/secret.py)와 같다: {v, iter, salt, iv, ct} · PBKDF2-SHA256 → AES-256-GCM */
(function () {
  'use strict';
  var me = document.currentScript;
  var ROOT = new URL('../../', me.src);           // docs/
  var HOME = new URL('../', me.src);              // docs/lang-studio/
  var PW_KEY = 'ls-pw';
  var OLD_KEYS = ['mom-pw', 'lesson-pw', 'audiobook-pw'];   // 옛 페이지별 열쇠(옛 암호) — 지운다

  /* 키, 폴더, 이름, 옛 주소 — publish/sites/macsalogs.py STUDIO_PAGES 와 같은 순서 */
  var PAGES = [
    ['talk', 'talk', '일상대화', 'comm.html'], ['drama', 'drama', '드라마', 'tvshow.html'], ['opic', 'opic', 'OPIc', 'opic.html'],
    ['review', 'review', '표현 복습', 'english.html'], ['lesson', 'lesson', '전화영어', 'lesson.html'],
    ['minutes', 'minutes', '회의록', 'mom.html'], ['audiobook', 'audiobook', '오디오북', 'audiobook.html']
  ];
  /* 새 폴더로 옮긴 페이지 — 입구 빌더(hub.py)가 복사할 때 채운다. 아직 안 옮긴 페이지는 옛 주소로 잇는다 */
  var MOVED = ["review", "talk", "opic", "drama"];
  function pageHref(p) {
    return MOVED.indexOf(p[0]) >= 0 ? new URL(p[1] + '/', HOME).href : new URL(p[3], ROOT).href;
  }

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
      '<div class="site-brand"><h1 class="site-title"><a href="' + HOME.href + '"' + (cur ? '' : ' aria-current="page"') + '>Lang-Studio</a></h1>' +
      '<p class="site-tagline"><a href="' + new URL('index.html', ROOT).href + '">MacsALogs</a> 의 영어 학습</p></div>' +
      '<nav class="site-nav ls-nav">' + links + '</nav></div>';
  }

  /* ── 암호 ── */
  var pw = {
    get: function () { try { return localStorage.getItem(PW_KEY) || sessionStorage.getItem(PW_KEY); } catch (e) { return null; } },
    set: function (v, persist) {
      try {
        sessionStorage.setItem(PW_KEY, v);
        if (persist) localStorage.setItem(PW_KEY, v); else localStorage.removeItem(PW_KEY);
        OLD_KEYS.forEach(function (k) { localStorage.removeItem(k); sessionStorage.removeItem(k); });
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
          '<p class="ls-lock-lead">' + esc(opts.lead || 'Lang-Studio 암호를 넣으면 이 기기에서는 다시 묻지 않습니다.') + '</p>' +
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

  window.LS = { root: ROOT.href, home: HOME.href, pages: PAGES, pageHref: pageHref, url: url, esc: esc, nav: nav, pw: pw,
                decrypt: decrypt, decryptBytes: decryptBytes, unlock: unlock, forgetButton: forgetButton };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nav); else nav();
})();
