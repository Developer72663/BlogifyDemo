/* Blogify live messaging bootstrap/fix */
(() => {
  'use strict';

  // massage.ejs owns the detailed message UI. This bootstrap guarantees that
  // the page uses the authenticated Socket.IO endpoint/token injected by app.js
  // instead of opening an unauthenticated default connection.
  const getSocketConfig = () => ({
    url: window.__BLOGIFY_SOCKET_URL || window.location.origin,
    token: window.__BLOGIFY_SOCKET_TOKEN || ''
  });

  const config = getSocketConfig();
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

  // Expose a tiny stable API for massage.ejs. The page can use this instead of
  // creating a second socket, which was the source of refresh-only delivery.
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
