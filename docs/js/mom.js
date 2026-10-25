// MOM(회의록) 페이지 — 암호화된 목록 · 대본을 브라우저에서 푼다.
// 데이터는 scripts/build_mom.py 가 만든다 (PBKDF2-SHA256 → AES-256-GCM).
// 암호는 이번 탭(sessionStorage)에만 두고, '이 기기에 기억'을 고르면 localStorage 에도 둔다.
(function () {
  const KEY = 'mom-pw';

  function b64(s) {
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  }

  async function decrypt(pw) {
    const box = JSON.parse(document.getElementById('mom-data').textContent);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64(box.salt), iterations: box.iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct));
    return new TextDecoder().decode(plain);
  }

  function stored() {
    try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function remember(pw, persist) {
    try {
      sessionStorage.setItem(KEY, pw);
      if (persist) localStorage.setItem(KEY, pw);
    } catch (e) {}
  }

  function forget() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (e) {}
  }

  // 저장된 암호로 먼저 풀어 보고, 없거나 틀리면 입력 창을 띄운다
  async function unlock(onPlain) {
    const saved = stored();
    if (saved) {
      try { return onPlain(await decrypt(saved)); } catch (e) { forget(); }
    }
    const host = document.getElementById('mom-lock');
    host.innerHTML =
      '<form class="mom-lock">' +
      '<label class="mom-lock-label" for="mom-pw">암호</label>' +
      '<div class="mom-lock-row">' +
      '<input class="mom-lock-input" id="mom-pw" type="password" autocomplete="current-password" required />' +
      '<button class="mom-lock-btn" type="submit">열기</button></div>' +
      '<label class="mom-lock-remember"><input type="checkbox" id="mom-persist" /> 이 기기에 기억</label>' +
      '<p class="mom-lock-msg" id="mom-msg" role="status" aria-live="polite"></p></form>';
    const form = host.querySelector('form');
    const msg = host.querySelector('#mom-msg');
    host.querySelector('#mom-pw').focus();
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const pw = form.querySelector('#mom-pw').value;
      msg.textContent = '푸는 중…';
      try {
        const plain = await decrypt(pw);
        remember(pw, form.querySelector('#mom-persist').checked);
        host.innerHTML = '';
        onPlain(plain);
      } catch (e) {
        msg.textContent = '암호가 맞지 않습니다.';
      }
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function openList() {
    unlock(plain => {
      const list = JSON.parse(plain);
      document.getElementById('mom-count').textContent = `${list.length}건`;
      document.getElementById('mom-list').innerHTML = list.map(m => `
        <a class="mom-card" href="mom/${m.id}.html">
          <p class="mom-card-meta">${esc(m.date)}${m.place ? ' · ' + esc(m.place) : ''}</p>
          <h2 class="mom-card-title">${esc(m.title)}</h2>
          <p class="mom-card-stats">${m.minutes}분 · 대사 ${m.turns} · 회의록 항목 ${m.items}</p>
          <p class="mom-card-speakers">${m.speakers.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</p>
        </a>`).join('');
      document.getElementById('mom-body').hidden = false;
      document.getElementById('mom-logout').hidden = false;
    });
    document.getElementById('mom-logout').addEventListener('click', () => { forget(); location.reload(); });
  }

  // 대본 페이지는 그 자체로 완결된 문서라 통째로 바꿔 쓴다
  function openDetail() {
    unlock(plain => {
      document.open();
      document.write(plain);
      document.close();
    });
  }

  window.MOM = { openList, openDetail };
})();
