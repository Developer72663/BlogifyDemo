/* Blogify live messaging bootstrap/fix */
(() => {
  'use strict';

  const socketUrl = window.__BLOGIFY_SOCKET_URL || window.location.origin;
  const socketToken = window.__BLOGIFY_SOCKET_TOKEN || '';

  // Make every chat-page io() call use the authenticated Render socket. This
  // also protects against massage.ejs creating a second default connection.
  if (window.io && !window.__blogifyIoPatched) {
    const originalIo = window.io;
    const patchedIo = function (url, opts) {
      const options = Object.assign({}, opts || {}, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 250,
        reconnectionDelayMax: 3000,
        timeout: 10000
      });
      if (socketToken) options.auth = Object.assign({}, options.auth || {}, { token: socketToken });
      return originalIo(socketUrl, options);
    };
    Object.keys(originalIo).forEach(key => { try { patchedIo[key] = originalIo[key]; } catch (_) {} });
    window.io = patchedIo;
    window.__blogifyIoPatched = true;
  }

  if (!window.io || window.__blogifyLiveSocket) return;

  const socket = window.io(socketUrl, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 3000,
    timeout: 10000,
    auth: socketToken ? { token: socketToken } : undefined
  });

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
    window.dispatchEvent(new CustomEvent('blogify:socket-disconnected', { detail: { reason } }));
  });
  socket.on('connect_error', error => {
    console.warn('[Blogify] live messaging connection error:', error?.message || error);
  });
})();
