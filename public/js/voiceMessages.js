(function () {
  'use strict';

  const MAX_VOICE_MS = 120000;
  const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ];

  const $ = (id) => document.getElementById(id);

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._voiceToastTimer);
    el._voiceToastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function setTime(el, seconds) {
    if (!el) return;
    const s = Math.max(0, Math.floor(seconds));
    el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function getMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function uploadVoice(blob, type) {
    const mime = String(type || blob.type || 'audio/webm').split(';')[0].trim().toLowerCase();
    const extension = mime.includes('ogg') ? 'ogg'
      : mime.includes('mp4') || mime.includes('m4a') ? 'm4a'
      : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
      : 'webm';

    const file = new File([blob], 'voice-message.' + extension, { type: mime });
    const form = new FormData();
    form.append('media', file, file.name);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('/messages/upload', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || data.mediaType !== 'audio' || !data.mediaUrl) {
        throw new Error(data.message || 'Voice upload failed');
      }
      return data.mediaUrl;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Voice upload timed out. Please try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getConversationId() {
    const userId = new URLSearchParams(window.location.search).get('user');
    if (!userId) throw new Error('Conversation recipient is missing');

    const response = await fetch('/messages/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ userId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.conversationId) {
      throw new Error(data.message || 'Unable to prepare chat');
    }
    return String(data.conversationId);
  }

  function createSocket() {
    if (typeof window.io !== 'function') throw new Error('Chat connection is unavailable');
    return window.io(window.__BLOGIFY_SOCKET_URL || undefined, {
      withCredentials: true,
      auth: { token: window.__BLOGIFY_SOCKET_TOKEN || undefined }
    });
  }

  function sendVoice(socket, conversationId, mediaUrl) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer;

      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.off('connect_error', onConnectError);
        socket.off('message:error', onMessageError);
        socket.off('message:new', onMessageNew);
        fn(value);
      };

      const onConnectError = (error) => finish(reject, new Error(error?.message || 'Chat connection unavailable'));
      const onMessageError = (data) => finish(reject, new Error(data?.message || 'Voice message was rejected'));
      const onMessageNew = (message) => {
        if (
          String(message?.conversationId) === String(conversationId) &&
          message?.mediaType === 'audio' &&
          String(message?.mediaUrl || '') === String(mediaUrl)
        ) {
          finish(resolve, message);
        }
      };

      const emitMessage = () => {
        socket.emit('conversation:join', conversationId);
        setTimeout(() => {
          if (!finished) {
            socket.emit('message:send', {
              conversationId,
              text: '',
              mediaUrl,
              mediaType: 'audio',
              replyTo: null
            });
          }
        }, 300);
      };

      socket.on('connect_error', onConnectError);
      socket.on('message:error', onMessageError);
      socket.on('message:new', onMessageNew);
      timer = setTimeout(() => finish(reject, new Error('Voice message send timed out. Please try again.')), 30000);

      if (socket.connected) emitMessage();
      else socket.once('connect', emitMessage);
    });
  }

  function boot() {
    const voiceButton = $('voiceButton');
    const stopButton = $('stopRecord');
    const sendButton = $('sendRecord');
    const cancelButton = $('cancelRecord');
    const recordBar = $('recordBar');
    const recordTime = $('recordTime');
    const recordTitle = $('recordTitle');

    if (!voiceButton || !stopButton || !sendButton || !cancelButton || !recordBar || !recordTime || !recordTitle) return;
    if (voiceButton.dataset.voiceMessagesFixed === '1') return;
    voiceButton.dataset.voiceMessagesFixed = '1';

    // Replace the buttons so any older recorder handler from messageEnhancements.js
    // is detached before this implementation takes control.
    const voice = voiceButton.cloneNode(true);
    const stop = stopButton.cloneNode(true);
    const send = sendButton.cloneNode(true);
    const cancel = cancelButton.cloneNode(true);
    voice.type = stop.type = send.type = cancel.type = 'button';
    voiceButton.replaceWith(voice);
    stopButton.replaceWith(stop);
    sendButton.replaceWith(send);
    cancelButton.replaceWith(cancel);

    let recorder = null;
    let stream = null;
    let chunks = [];
    let startedAt = 0;
    let timer = null;
    let ready = null;
    let sending = false;

    const cleanupStream = () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      recorder = null;
      clearInterval(timer);
      timer = null;
      voice.classList.remove('recording', 'blogify-recording-pulse');
      voice.innerHTML = '<i class="fas fa-microphone"></i>';
    };

    const reset = () => {
      ready = null;
      cleanupStream();
      recordBar.classList.remove('show');
      stop.style.display = 'inline-block';
      send.style.display = 'none';
      send.disabled = false;
      setTime(recordTime, 0);
      recordTitle.innerHTML = '<i class="fas fa-microphone"></i> Recording voice message';
    };

    const stopRecording = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };

    voice.addEventListener('click', async (event) => {
      event.preventDefault();
      if (recorder) return stopRecording();
      if (ready) return;

      if (!window.isSecureContext) {
        toast('Voice recording requires HTTPS.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        toast('Voice recording is not supported by this browser.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        const mimeType = getMimeType();
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        chunks = [];
        startedAt = Date.now();

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = () => {
          cleanupStream();
          reset();
          toast('Voice recording failed. Please try again.');
        };

        recorder.onstop = () => {
          const actualType = recorder?.mimeType || mimeType || stream?.getAudioTracks?.()[0]?.kind && 'audio/webm' || 'audio/webm';
          const blob = new Blob(chunks, { type: actualType });
          const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          cleanupStream();

          if (!blob.size) {
            reset();
            toast('No voice data was recorded.');
            return;
          }

          ready = { blob, type: actualType, duration };
          recordBar.classList.add('show');
          stop.style.display = 'none';
          send.style.display = 'inline-block';
          recordTitle.innerHTML = '<i class="fas fa-check-circle"></i> Voice message ready';
          setTime(recordTime, duration);
        };

        recorder.start(250);
        recordBar.classList.add('show');
        recordTitle.innerHTML = '<i class="fas fa-microphone"></i> Recording voice message';
        voice.classList.add('recording', 'blogify-recording-pulse');
        voice.innerHTML = '<i class="fas fa-circle"></i>';
        timer = setInterval(() => {
          const elapsed = Date.now() - startedAt;
          setTime(recordTime, elapsed / 1000);
          if (elapsed >= MAX_VOICE_MS) stopRecording();
        }, 250);
      } catch (error) {
        cleanupStream();
        if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
          toast('Microphone permission was denied. Allow microphone access and try again.');
        } else if (error?.name === 'NotFoundError') {
          toast('No microphone was found on this device.');
        } else {
          toast(error?.message || 'Unable to start voice recording.');
        }
      }
    });

    stop.addEventListener('click', (event) => {
      event.preventDefault();
      stopRecording();
    });

    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = null;
          recorder.stop();
        }
      } catch (_) {}
      reset();
    });

    send.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!ready || sending) return;

      sending = true;
      send.disabled = true;
      let socket = null;

      try {
        recordTitle.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading voice message…';
        const conversationId = await getConversationId();
        const mediaUrl = await uploadVoice(ready.blob, ready.type);
        recordTitle.innerHTML = '<i class="fas fa-paper-plane"></i> Sending voice message…';
        socket = createSocket();
        await sendVoice(socket, conversationId, mediaUrl);
        toast('Voice message sent');
        reset();
      } catch (error) {
        toast(error?.message || 'Unable to send voice message');
        recordTitle.innerHTML = '<i class="fas fa-exclamation-circle"></i> Voice message failed — try again';
      } finally {
        if (socket) socket.disconnect();
        sending = false;
        send.disabled = false;
      }
    });

    window.addEventListener('beforeunload', () => {
      try {
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = null;
          recorder.stop();
        }
      } catch (_) {}
      cleanupStream();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
