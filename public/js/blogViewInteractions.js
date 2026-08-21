/* Blogify view interactions: comments + likes. Kept separate from view.ejs to avoid disturbing page UI. */
(() => {
  'use strict';

  const state = {
    comments: [],
    page: 1,
    hasMore: true,
    loading: false,
    submitting: false,
    likedComments: new Set()
  };

  const getBlogId = () => document.body?.dataset?.blogId || window.blogId || document.querySelector('[data-blog-id]')?.dataset.blogId;
  const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

  async function request(url, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const message = data?.message || (response.status === 401 ? 'Please sign in first.' : response.status === 429 ? 'Too many requests. Please try again later.' : 'Something went wrong.');
      const error = new Error(message); error.status = response.status; error.data = data; throw error;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function notify(message) {
    if (typeof window.showToast === 'function') return window.showToast(message);
    if (typeof window.showNotification === 'function') return window.showNotification(message);
    console.warn(message);
  }

  function findCommentContainer() {
    return document.querySelector('[data-comments], #commentsList, #comments-container, .comments-list');
  }

  function renderComments() {
    const container = findCommentContainer();
    if (!container) return;
    if (!state.comments.length) {
      container.innerHTML = '<div class="comments-empty">No comments yet. Be the first to comment.</div>';
      return;
    }
    container.innerHTML = state.comments.map(renderComment).join('');
    bindCommentActions(container);
  }

  function renderComment(comment) {
    const id = comment._id || comment.id;
    const author = comment.author || comment.user || {};
    const name = author.username || author.name || author.fullName || 'User';
    const content = comment.content || comment.comment || '';
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    const likes = Number(comment.likeCount ?? comment.likes?.length ?? 0);
    const liked = Boolean(comment.liked || state.likedComments.has(String(id)));
    return `<article class="comment-item" data-comment-id="${escapeHtml(id)}">
      <div class="comment-author">${escapeHtml(name)}</div>
      <div class="comment-content">${escapeHtml(content)}</div>
      <div class="comment-actions">
        <button type="button" data-comment-like="${escapeHtml(id)}" aria-pressed="${liked}">${liked ? 'Unlike' : 'Like'} <span>${likes}</span></button>
        <button type="button" data-comment-reply="${escapeHtml(id)}">Reply</button>
      </div>
      <div class="comment-replies">${replies.map(renderComment).join('')}</div>
    </article>`;
  }

  function bindCommentActions(root) {
    root.querySelectorAll('[data-comment-like]').forEach(button => {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', async () => {
        const id = button.dataset.commentLike;
        button.disabled = true;
        try {
          const data = await request(`/comments/${encodeURIComponent(id)}/like`, { method: 'POST' });
          const count = Number(data.likeCount ?? data.likesCount ?? 0);
          const span = button.querySelector('span'); if (span) span.textContent = count;
          const liked = Boolean(data.liked);
          button.setAttribute('aria-pressed', String(liked));
          button.firstChild.textContent = liked ? 'Unlike ' : 'Like ';
          if (liked) state.likedComments.add(String(id)); else state.likedComments.delete(String(id));
        } catch (error) { notify(error.message); }
        finally { button.disabled = false; }
      });
    });
  }

  async function loadComments({ append = false } = {}) {
    const blogId = getBlogId();
    if (!blogId || state.loading || (!state.hasMore && append)) return;
    state.loading = true;
    try {
      const data = await request(`/comments/blog/${encodeURIComponent(blogId)}?page=${state.page}&limit=20`);
      const incoming = Array.isArray(data.comments) ? data.comments : Array.isArray(data.data) ? data.data : [];
      state.comments = append ? [...state.comments, ...incoming] : incoming;
      state.hasMore = Boolean(data.hasMore ?? incoming.length >= 20);
      renderComments();
    } catch (error) {
      notify(error.message);
    } finally { state.loading = false; }
  }

  async function submitComment(content, parentComment = null) {
    const blogId = getBlogId();
    const text = String(content || '').trim();
    if (!blogId) throw new Error('Blog ID is missing.');
    if (!text) throw new Error('Comment cannot be empty.');
    if (text.length > 2000) throw new Error('Comment is too long.');
    if (state.submitting) return;
    state.submitting = true;
    try {
      const body = { content: text };
      if (parentComment) body.parentComment = parentComment;
      const data = await request(`/comments/blog/${encodeURIComponent(blogId)}`, { method: 'POST', body: JSON.stringify(body) });
      const created = data.comment || data.data || data;
      if (created && (created._id || created.id)) state.comments.unshift(created);
      renderComments();
      return created;
    } finally { state.submitting = false; }
  }

  async function toggleBlogLike() {
    const blogId = getBlogId();
    if (!blogId) return;
    const buttons = document.querySelectorAll('[data-blog-like], #blogLikeButton, .blog-like-btn');
    buttons.forEach(b => { b.disabled = true; });
    try {
      const data = await request(`/blogs/${encodeURIComponent(blogId)}/like`, { method: 'POST' });
      buttons.forEach(button => {
        const liked = Boolean(data.liked);
        button.setAttribute('aria-pressed', String(liked));
        button.classList.toggle('liked', liked);
        const count = button.querySelector('[data-like-count], .like-count, span');
        if (count && data.likeCount != null) count.textContent = data.likeCount;
      });
    } catch (error) { notify(error.message); }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  }

  function bind() {
    const form = document.querySelector('[data-comment-form], #commentForm, form[action*="/comments"]');
    if (form && !form.dataset.blogInteractionsBound) {
      form.dataset.blogInteractionsBound = '1';
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const input = form.querySelector('textarea[name="content"], textarea[name="comment"], input[name="content"], input[name="comment"]');
        const button = form.querySelector('button[type="submit"]');
        try {
          if (button) button.disabled = true;
          await submitComment(input?.value, form.dataset.parentComment || null);
          if (input) input.value = '';
        } catch (error) { notify(error.message); }
        finally { if (button) button.disabled = false; }
      });
    }
    document.querySelectorAll('[data-blog-like], #blogLikeButton, .blog-like-btn').forEach(button => {
      if (button.dataset.blogLikeBound) return;
      button.dataset.blogLikeBound = '1';
      button.addEventListener('click', toggleBlogLike);
    });
    loadComments();
  }

  window.BlogifyComments = { loadComments, submitComment, toggleBlogLike };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
