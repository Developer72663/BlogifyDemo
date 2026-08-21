(() => {
  'use strict';

  const path = window.location.pathname.replace(/\/+$/, '');
  if (path !== '/user/profile') return;

  const addAnalyticsButton = () => {
    const actions = document.querySelector('.actions');
    if (!actions || actions.querySelector('[data-profile-analytics]')) return;
    const link = document.createElement('a');
    link.href = '/analytics';
    link.className = 'btn secondary';
    link.dataset.profileAnalytics = 'true';
    link.innerHTML = '<i class="fas fa-chart-line" aria-hidden="true"></i><span>Analytics</span>';
    link.setAttribute('aria-label', 'Open analytics dashboard');
    const moreButton = actions.querySelector('.more-btn');
    if (moreButton) actions.insertBefore(link, moreButton);
    else actions.appendChild(link);
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
    const old = document.getElementById('profileReportModal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.id = 'profileReportModal';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
        <div class="modal-head"><h3 id="reportTitle">Report profile</h3><button class="modal-close" type="button" data-report-close><i class="fas fa-times"></i></button></div>
        <p class="mt-3">Choose a reason for reporting this profile.</p>
        <select id="profileReportReason" class="form-select" style="margin-top:12px">
          <option value="spam">Spam</option><option value="harassment">Harassment</option><option value="hate">Hate or abusive content</option><option value="scam">Scam or fraud</option><option value="inappropriate">Inappropriate content</option><option value="impersonation">Impersonation</option><option value="other">Other</option>
        </select>
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
        const profileUserId = window.__BLOGIFY_PROFILE_USER_ID;
        if (!profileUserId) throw new Error('Profile user ID is unavailable');
        await jsonFetch(`/safety/${encodeURIComponent(profileUserId)}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: modal.querySelector('#profileReportReason').value,
            description: modal.querySelector('#profileReportDescription').value.trim()
          })
        });
        close();
        toast('Report submitted');
      } catch (error) {
        toast(error.message || 'Unable to submit report');
      } finally { button.disabled = false; }
    });
  };

  const fixProfileSafetyMenu = () => {
    const menu = document.getElementById('profileMenu');
    const more = document.getElementById('profileMore');
    if (!menu || !more || menu.dataset.safetyFix === '1') return;
    menu.dataset.safetyFix = '1';

    // The profile template previously called /messages/block and treated Report as a placeholder.
    // The real safety router is mounted at /safety and owns both operations.
    menu.addEventListener('click', async event => {
      const actionButton = event.target.closest('button[data-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.action;
      if (action !== 'block' && action !== 'report') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();

      const profileUserId = window.__BLOGIFY_PROFILE_USER_ID;
      if (!profileUserId) return toast('Profile user ID is unavailable');

      if (action === 'report') return openReport();

      if (!confirm('Block this user? They will no longer be able to message, follow, or interact with you.')) return;
      actionButton.disabled = true;
      try {
        await jsonFetch(`/safety/${encodeURIComponent(profileUserId)}/block`, { method: 'POST' });
        toast('User blocked');
        setTimeout(() => window.location.href = '/', 500);
      } catch (error) {
        toast(error.message || 'Unable to block user');
      } finally { actionButton.disabled = false; }
    }, true);
  };

  const boot = () => {
    // Inline profile.ejs exposes the ID through this small, non-sensitive DOM value.
    const avatar = document.querySelector('.avatar');
    if (avatar && !window.__BLOGIFY_PROFILE_USER_ID) {
      const match = document.querySelector('a[href*="/user/profile/"]');
      if (match) window.__BLOGIFY_PROFILE_USER_ID = match.getAttribute('href').split('/').pop();
    }
    addAnalyticsButton();
    fixProfileSafetyMenu();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
