(() => {
  'use strict';

  // Show the creator analytics shortcut only on the signed-in profile page.
  // The profile page already exposes its action buttons through .actions.
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

    // Put Analytics before the existing More (three-dot) action when possible.
    const moreButton = actions.querySelector('.more-btn');
    if (moreButton) actions.insertBefore(link, moreButton);
    else actions.appendChild(link);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addAnalyticsButton, { once: true });
  } else {
    addAnalyticsButton();
  }
})();
