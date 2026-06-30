/* posts/posts.json을 읽어 메인 페이지에 포스트 목록을 렌더링합니다 */

async function loadPosts() {
  const listEl = document.getElementById('post-list');
  if (!listEl) return;

  try {
    const res = await fetch('posts/posts.json');
    if (!res.ok) throw new Error('posts.json not found');
    const posts = await res.json();

    if (posts.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>아직 포스트가 없습니다.</p></div>';
      return;
    }

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
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state"><p>포스트를 불러올 수 없습니다.</p></div>';
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', loadPosts);
