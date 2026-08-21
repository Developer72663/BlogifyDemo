(() => {
  'use strict';

  const path = window.location.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/user/profile')) return;

  const addAnalyticsButton = () => {
    if (path !== '/user/profile') return;
    const actions = document.querySelector('.actions');
    if (!actions || actions.querySelector('[data-profile-analytics]')) return;
    const link = document.createElement('a');
    link.href = '/analytics';
    link.className = 'btn secondary';
    link.dataset.profileAnalytics = 'true';
    link.innerHTML = '<i class="fas fa-chart-line" aria-hidden="true"></i><span>Analytics</span>';
    link.setAttribute('aria-label', 'Open analytics dashboard');
    const moreButton = actions.querySelector('.more-btn');
    if (moreButton) actions.insertBefore(link, moreButton); else actions.appendChild(link);
  };

  const getProfileUserId = () => {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'user' && parts[1] === 'profile') return parts[2];
    // /user/profile is the signed-in user's profile. app.js already injects a short-lived
    // socket JWT into the page; its payload contains the authenticated user's _id.
    try {
      const token = window.__BLOGIFY_SOCKET_TOKEN || '';
      const payload = token.split('.')[1];
      if (payload) {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(atob(normalized).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        const data = JSON.parse(json);
        if (data && data._id) return String(data._id);
      }
    } catch (_) {}
    return '';
  };

  const jsonFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.message || `Request failed (${response.status})`);
    return data;
  };

  const toast = message => {
    if (typeof window.toast === 'function') return window.toast(message);
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(window.__profileFixToast);
    window.__profileFixToast = setTimeout(() => { el.style.display = 'none'; }, 2800);
  };

  const closeMenu = () => {
    const menu = document.getElementById('profileMenu');
    const button = document.getElementById('profileMore');
    menu?.classList.remove('open');
    button?.setAttribute('aria-expanded', 'false');
  };

  const openReport = () => {
    document.getElementById('profileReportModal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.id = 'profileReportModal';
    modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
      <div class="modal-head"><h3 id="reportTitle">Report profile</h3><button class="modal-close" type="button" data-report-close><i class="fas fa-times"></i></button></div>
      <p class="mt-3">Choose a reason for reporting this profile.</p>
      <select id="profileReportReason" class="form-select" style="margin-top:12px"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="hate">Hate or abusive content</option><option value="scam">Scam or fraud</option><option value="inappropriate">Inappropriate content</option><option value="impersonation">Impersonation</option><option value="other">Other</option></select>
      <textarea id="profileReportDescription" class="form-control" maxlength="1000" rows="3" placeholder="Optional details" style="margin-top:10px"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn secondary" type="button" data-report-close>Cancel</button><button class="btn" id="submitProfileReport" type="button" style="background:var(--danger);color:#fff">Report</button></div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-report-close]')) close(); });
    modal.querySelector('#submitProfileReport').addEventListener('click', async () => {
      const button = modal.querySelector('#submitProfileReport');
      button.disabled = true;
      try {
        const id = getProfileUserId();
        if (!id) throw new Error('Profile user ID is unavailable');
        await jsonFetch(`/safety/${encodeURIComponent(id)}/report`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ reason:modal.querySelector('#profileReportReason').value, description:modal.querySelector('#profileReportDescription').value.trim() }) });
        close();
        toast('Report submitted');
      } catch (error) { toast(error.message || 'Unable to submit report'); }
      finally { button.disabled = false; }
    });
  };

  const fixProfileSafetyMenu = () => {
    const menu = document.getElementById('profileMenu');
    const more = document.getElementById('profileMore');
    if (!menu || !more || menu.dataset.safetyFix === '1') return;
    menu.dataset.safetyFix = '1';
    menu.addEventListener('click', async event => {
      const actionButton = event.target.closest('button[data-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.action;
      if (action !== 'block' && action !== 'report') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();
      const id = getProfileUserId();
      if (!id) return toast('Profile user ID is unavailable');
      if (action === 'report') return openReport();
      if (!confirm('Block this user? They will no longer be able to message, follow, or interact with you.')) return;
      actionButton.disabled = true;
      try {
        await jsonFetch(`/safety/${encodeURIComponent(id)}/block`, { method:'POST' });
        toast('User blocked');
        setTimeout(() => { window.location.href = '/'; }, 500);
      } catch (error) { toast(error.message || 'Unable to block user'); }
      finally { actionButton.disabled = false; }
    }, true);
  };

  const boot = () => {
    window.__BLOGIFY_PROFILE_USER_ID = getProfileUserId();
    addAnalyticsButton();
    fixProfileSafetyMenu();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
