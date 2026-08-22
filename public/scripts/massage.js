/* Blogify live messaging bootstrap/fix */
(() => {
  'use strict';

  // Create exactly one authenticated Socket.IO connection for the chat UI.
  const config = {
    url: window.__BLOGIFY_SOCKET_URL || window.location.origin,
    token: window.__BLOGIFY_SOCKET_TOKEN || ''
  };

  if (!window.io || window.__blogifyLiveSocket) return;

  const options = {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 3000,
    timeout: 10000
  };

  if (config.token) options.auth = { token: config.token };

  const socket = window.io(config.url, options);
  window.__blogifyLiveSocket = socket;
  window.BlogifyLiveChat = {
    socket,
    connected: () => socket.connected,
    send: (event, payload, ack) => socket.emit(event, payload, ack),
    on: (event, handler) => socket.on(event, handler),
    off: (event, handler) => socket.off(event, handler)
  };

  socket.on('connect', () => {
    window.dispatchEvent(new CustomEvent('blogify:socket-connected', {
      detail: { socketId: socket.id }
    }));
  });

  socket.on('disconnect', reason => {
    window.dispatchEvent(new CustomEvent('blogify:socket-disconnected', {
      detail: { reason }
    }));
  });

  socket.on('connect_error', error => {
    console.warn('[Blogify] live messaging connection error:', error?.message || error);
  });
})();
