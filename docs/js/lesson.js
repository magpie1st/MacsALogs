// 전화영어 페이지 — 암호화된 목록 · 수업 페이지 · 녹음을 브라우저에서 푼다.
// 데이터는 scripts/build_lesson.py 가 만든다 (PBKDF2-SHA256 → AES-256-GCM). 방식은 mom.js 와 같다.
// 암호는 이번 탭(sessionStorage)에만 두고, '이 기기에 기억'을 고르면 localStorage 에도 둔다.
(function () {
  const KEY = 'lesson-pw';

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  async function openBox(pw) {
    const box = JSON.parse(document.getElementById('lesson-data').textContent);
    const key = await deriveKey(pw, b64(box.salt), box.iter);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct));
    return new TextDecoder().decode(plain);
  }

  function stored() {
    try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(pw, persist) {
    try { sessionStorage.setItem(KEY, pw); if (persist) localStorage.setItem(KEY, pw); } catch (e) {}
  }
  function forget() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (e) {}
  }

  // 저장된 암호로 먼저 풀어 보고, 없거나 틀리면 입력 창을 띄운다 (mom.js 의 입력 창 스타일을 같이 쓴다)
  async function unlock(onPlain) {
    const saved = stored();
    if (saved) {
      try { return onPlain(await openBox(saved)); } catch (e) { forget(); }
    }
    const host = document.getElementById('lesson-lock');
    host.innerHTML =
      '<form class="mom-lock">' +
      '<label class="mom-lock-label" for="lesson-pw">암호</label>' +
      '<div class="mom-lock-row">' +
      '<input class="mom-lock-input" id="lesson-pw" type="password" autocomplete="current-password" required />' +
      '<button class="mom-lock-btn" type="submit">열기</button></div>' +
      '<label class="mom-lock-remember"><input type="checkbox" id="lesson-persist" /> 이 기기에 기억</label>' +
      '<p class="mom-lock-msg" id="lesson-msg" role="status" aria-live="polite"></p></form>';
    const form = host.querySelector('form');
    const msg = host.querySelector('#lesson-msg');
    host.querySelector('#lesson-pw').focus();
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const pw = form.querySelector('#lesson-pw').value;
      msg.textContent = '푸는 중…';
      try {
        const plain = await openBox(pw);
        remember(pw, form.querySelector('#lesson-persist').checked);
        host.innerHTML = '';
        onPlain(plain);
      } catch (e) {
        msg.textContent = '암호가 맞지 않습니다.';
      }
    });
  }

  function openList() {
    unlock(plain => {
      document.getElementById('lesson-body').innerHTML = plain;
      const out = document.getElementById('lesson-logout');
      out.hidden = false;
      out.addEventListener('click', () => { forget(); location.reload(); });
    });
  }

  // 수업 페이지는 그 자체로 완결된 문서라 통째로 바꿔 쓴다. 녹음은 그 문서가 sealedAudio 로 따로 푼다
  function openDetail() {
    unlock(plain => { document.open(); document.write(plain); document.close(); });
  }

  // 잠근 녹음(.bin = iv 12바이트 + 암호문)을 받아 풀고 <audio> 에 붙인다
  async function sealedAudio(url, salt, iter) {
    const audio = document.getElementById('audio');
    const now = document.getElementById('now');
    const pw = stored();
    if (!audio || !pw) return;
    const was = now ? now.textContent : '';
    if (now) now.textContent = '녹음을 푸는 중…';
    try {
      const [key, res] = await Promise.all([deriveKey(pw, b64(salt), iter), fetch(url)]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
      audio.src = URL.createObjectURL(new Blob([plain], { type: 'audio/mpeg' }));
      if (now) now.textContent = was;
    } catch (e) {
      if (now) now.textContent = '녹음을 풀지 못했습니다 (' + e.message + ')';
    }
  }

  window.LESSON = { openList, openDetail, sealedAudio, forget };
})();
