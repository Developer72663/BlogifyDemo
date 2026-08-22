(() => {
  'use strict';
  if (window.BlogifySocket) return;

  const socketUrl = window.__BLOGIFY_SOCKET_URL || window.location.origin;
  let socket = null;
  let refreshing = false;
  let hasConnected = false;
  let lastConversationId = null;

  const debug = (...args) => {
    if (window.__BLOGIFY_DEBUG) console.debug('[BlogifySocket]', ...args);
  };

  async function refreshToken() {
    if (refreshing) return;
    refreshing = true;
    try {
      const response = await fetch('/messages/socket-token', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`socket token refresh failed (${response.status})`);
      const data = await response.json();
      if (!data.success || !data.token) throw new Error('socket token refresh returned no token');
      if (socket) socket.auth = { ...(socket.auth || {}), token: data.token };
      debug('SOCKET_AUTH_REFRESHED');
    } finally {
      refreshing = false;
    }
  }

  async function syncMissedMessages() {
    const conversationId = lastConversationId;
    const render = window.BlogifyRenderMessage;
    if (!conversationId || typeof render !== 'function') return;
    try {
      const response = await fetch(`/messages/${encodeURIComponent(conversationId)}?limit=100`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.success || !Array.isArray(data.messages)) return;
      let lastDate = '';
      let added = 0;
      for (const message of data.messages) {
        const id = String(message?._id || '');
        if (!id) continue;
        const exists = [...document.querySelectorAll('[data-id]')].some(el => el.getAttribute('data-id') === id);
        if (exists) continue;
        lastDate = render(message, true, lastDate) || lastDate;
        added += 1;
      }
      if (added) {
        const area = document.getElementById('messagesArea');
        if (area) area.scrollTop = area.scrollHeight;
        debug('MISSED_MESSAGES_SYNCED', { conversationId, count: added });
      }
    } catch (error) {
      debug('MISSED_MESSAGE_SYNC_FAILED', error?.message || error);
    }
  }

  function createSocket() {
    const token = window.__BLOGIFY_SOCKET_TOKEN || '';
    socket = window.io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: token ? { token } : {}
    });

    const originalEmit = socket.emit.bind(socket);
    socket.emit = (event, payload, ...rest) => {
      if ((event === 'conversation:join' || event === 'conversation:active') && payload) {
        const id = typeof payload === 'string' ? payload : payload.conversationId;
        if (id) lastConversationId = String(id);
      }
      return originalEmit(event, payload, ...rest);
    };

    socket.on('connect', async () => {
      debug(hasConnected ? 'SOCKET_RECONNECTED' : 'SOCKET_CONNECTED', socket.id, socketUrl);
      if (hasConnected) await syncMissedMessages();
      hasConnected = true;
    });

    socket.on('disconnect', reason => debug('SOCKET_DISCONNECTED', reason));

    socket.on('connect_error', async error => {
      debug('SOCKET_AUTH_FAILED', error?.message || error);
      try {
        await refreshToken();
        if (socket && !socket.connected) socket.connect();
      } catch (refreshError) {
        debug('SOCKET_AUTH_REFRESH_FAILED', refreshError?.message || refreshError);
      }
    });

    return socket;
  }

  window.BlogifySocket = {
    getSocket() {
      if (typeof window.io !== 'function') throw new Error('Socket.IO client is unavailable');
      if (!socket) createSocket();
      return socket;
    },
    get socket() { return socket; },
    url: socketUrl
  };
})();
