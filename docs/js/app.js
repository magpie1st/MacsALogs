function renderPosts(posts) {
  const listEl = document.getElementById('post-list');
  if (!listEl) return;

  if (!posts || posts.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>아직 포스트가 없습니다.</p></div>';
    return;
  }

  // 데이터 순서와 무관하게 항상 최신순으로 표시
  posts = [...posts].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (b.slug || '').localeCompare(a.slug || ''));

  listEl.innerHTML = posts.map(post => `
    <article class="post-card${post.thumbnail ? ' post-card--has-thumb' : ''}">
      ${post.thumbnail ? `<a href="posts/${post.slug}.html" class="post-card-thumb-link"><img class="post-card-thumb" src="${post.thumbnail}" alt="${post.title}" loading="lazy" /></a>` : ''}
      <div class="post-card-body">
        <div class="post-card-meta">
          <span>${post.date}</span>
          ${post.readTime ? `<span>· ${post.readTime}</span>` : ''}
        </div>
        <h2 class="post-card-title"><a href="posts/${post.slug}.html">${post.title}</a></h2>
        <p class="post-card-excerpt">${post.excerpt}</p>
        ${post.tags?.length ? `<div class="tags">${post.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
      </div>
    </article>
  `).join('');
}

function loadPosts() {
  const listEl = document.getElementById('post-list');
  if (!listEl) return;

  // 인라인 JSON 우선 사용 (fetch 불필요 — GitHub Pages 환경 호환)
  const inlineEl = document.getElementById('posts-data');
  if (inlineEl) {
    try {
      renderPosts(JSON.parse(inlineEl.textContent));
    } catch (e) {
      listEl.innerHTML = '<div class="empty-state"><p>포스트 데이터를 불러올 수 없습니다.</p></div>';
      console.error(e);
    }
    return;
  }

  // 인라인 데이터가 없을 때만 fetch 시도 (로컬 개발 fallback)
  fetch('posts/posts.json')
    .then(res => { if (!res.ok) throw new Error('posts.json not found'); return res.json(); })
    .then(renderPosts)
    .catch(e => {
      listEl.innerHTML = '<div class="empty-state"><p>포스트를 불러올 수 없습니다.</p></div>';
      console.error(e);
    });
}

document.addEventListener('DOMContentLoaded', loadPosts);
