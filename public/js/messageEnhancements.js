(function () {
  'use strict';

  const defaultAvatar = '/imgs/default.png';

  function profileUrl(id) {
    return id ? '/profile/' + encodeURIComponent(String(id)) : '';
  }

  function enhanceProfileCards(root) {
    const cards = (root || document).querySelectorAll('.profile-card:not([data-blogify-enhanced])');

    cards.forEach((card) => {
      card.dataset.blogifyEnhanced = '1';
      card.classList.add('blogify-shared-profile');

      const image = card.querySelector('img');
      if (image) {
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = 'Shared profile';
        image.onerror = () => { image.src = defaultAvatar; };
      }

      const body = card.querySelector('.profile-card-body') || card;
      const name = body.querySelector('.profile-card-name');
      const bio = body.querySelector('.profile-card-bio');

      if (!body.querySelector('.blogify-profile-label')) {
        const label = document.createElement('div');
        label.className = 'blogify-profile-label';
        label.innerHTML = '<i class="fas fa-user-circle"></i><span>Shared profile</span>';
        body.insertBefore(label, body.firstChild);
      }

      if (bio && !bio.textContent.trim()) {
        bio.textContent = 'View this profile on Blogify';
      }

      // If a future renderer supplies an id, make the whole card keyboard accessible.
      const id = card.getAttribute('data-profile-id') || card.getAttribute('data-user-id') || card.dataset.profileShareId || '';
      if (id) {
        const href = profileUrl(id);
        card.dataset.profileUrl = href;
        card.setAttribute('role', 'link');
        card.setAttribute('tabindex', '0');
        card.style.cursor = 'pointer';
        const open = (event) => {
          if (event.target.closest('a,button')) return;
          window.location.href = href;
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.location.href = href;
          }
        });
      }

      if (!body.querySelector('.blogify-profile-action')) {
        const action = document.createElement('div');
        action.className = 'blogify-profile-action';
        action.innerHTML = '<span>Blogify profile</span><i class="fas fa-arrow-right"></i>';
        body.appendChild(action);
      }
    });
  }

  function addProfileCardStyles() {
    if (document.getElementById('blogify-message-enhancement-style')) return;

    const style = document.createElement('style');
    style.id = 'blogify-message-enhancement-style';
    style.textContent = `
      .profile-card.blogify-shared-profile{
        width:min(310px,78vw)!important;
        border:1px solid var(--line)!important;
        background:var(--surface)!important;
        border-radius:18px!important;
        overflow:hidden!important;
        box-shadow:0 8px 28px rgba(0,0,0,.10)!important;
        transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease!important;
      }
      .profile-card.blogify-shared-profile:hover{
        transform:translateY(-2px);
        box-shadow:0 14px 34px rgba(0,0,0,.16)!important;
        border-color:rgba(55,151,240,.45)!important;
      }
      .profile-card.blogify-shared-profile img{
        display:block;
        width:100%!important;
        height:150px!important;
        object-fit:cover!important;
        background:var(--input);
      }
      .profile-card.blogify-shared-profile .profile-card-body{
        padding:12px!important;
      }
      .blogify-profile-label{
        display:flex;
        align-items:center;
        gap:6px;
        color:#3797f0;
        font-size:10px;
        font-weight:800;
        letter-spacing:.2px;
        text-transform:uppercase;
        margin-bottom:8px;
      }
      .blogify-profile-label i{font-size:12px}
      .profile-card.blogify-shared-profile .profile-card-name{
        font-size:15px!important;
        line-height:1.25;
        font-weight:800!important;
      }
      .profile-card.blogify-shared-profile .profile-card-bio{
        margin-top:5px!important;
        font-size:11px!important;
        line-height:1.45;
        display:-webkit-box;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
        overflow:hidden;
      }
      .blogify-profile-action{
        display:flex;
        align-items:center;
        gap:8px;
        margin-top:11px;
        padding-top:9px;
        border-top:1px solid var(--line);
        color:var(--text);
        font-size:11px;
        font-weight:750;
      }
      .blogify-profile-action span{flex:1}
      .blogify-profile-action i{color:#3797f0;font-size:10px}
      @media(max-width:380px){
        .profile-card.blogify-shared-profile{width:min(290px,82vw)!important}
        .profile-card.blogify-shared-profile img{height:132px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function preferredAudioMime() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac'
    ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function extensionForMime(mime) {
    const value = String(mime || '').toLowerCase();
    if (value.includes('mp4')) return 'm4a';
    if (value.includes('aac')) return 'aac';
    if (value.includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function getConversationId() {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user');
    if (!userId) throw new Error('Conversation recipient is missing.');

    const response = await fetch('/messages/conversation', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.conversationId) {
      throw new Error(data.message || 'Unable to open conversation.');
    }
    return data.conversationId;
  }

  async function uploadVoice(blob, mime) {
    const extension = extensionForMime(mime);
    const form = new FormData();
    form.append('media', blob, `voice-message-${Date.now()}.${extension}`);

    const response = await fetch('/messages/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
      headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.mediaUrl) {
      throw new Error(data.message || 'Voice upload failed.');
    }
    return data.mediaUrl;
  }

  function bindReliableVoice() {
    const original = document.getElementById('voiceButton');
    if (!original || original.dataset.blogifyReliableVoice) return;

    // The inline message.ejs recorder can fail on browsers that do not support WebM.
    // Replace only this button so the rest of the existing composer remains untouched.
    const button = original.cloneNode(true);
    original.replaceWith(button);
    button.dataset.blogifyReliableVoice = '1';

    let recorder = null;
    let stream = null;
    let chunks = [];
    let startedAt = 0;
    let timer = null;
    let sending = false;

    const setRecordingUI = (active) => {
      button.classList.toggle('recording', active);
      button.innerHTML = active
        ? '<i class="fas fa-circle"></i>'
        : '<i class="fas fa-microphone"></i>';
      button.setAttribute('aria-label', active ? 'Stop voice recording' : 'Record voice message');
    };

    const stopTracks = () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const stopTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const updateRecordTime = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const target = document.getElementById('recordTime');
      if (target) target.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const cleanup = () => {
      stopTimer();
      stopTracks();
      recorder = null;
      chunks = [];
      startedAt = 0;
      setRecordingUI(false);
      const bar = document.getElementById('recordBar');
      if (bar) bar.classList.remove('show');
    };

    const sendVoice = async (blob, mime) => {
      if (sending) return;
      sending = true;
      button.disabled = true;
      try {
        const mediaUrl = await uploadVoice(blob, mime);
        const conversationId = await getConversationId();

        if (typeof window.io !== 'function') throw new Error('Chat connection is unavailable.');
        const socket = window.io(window.__BLOGIFY_SOCKET_URL || undefined, {
          withCredentials: true,
          auth: { token: window.__BLOGIFY_SOCKET_TOKEN || undefined }
        });

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Chat connection timed out.')), 10000);
          socket.on('connect', () => {
            socket.emit('conversation:join', conversationId);
            socket.emit('message:send', {
              conversationId,
              text: '',
              mediaUrl,
              mediaType: 'audio'
            });
            clearTimeout(timeout);
            setTimeout(() => { socket.disconnect(); resolve(); }, 250);
          });
          socket.on('connect_error', () => {
            clearTimeout(timeout);
            reject(new Error('Unable to connect to chat.'));
          });
        });
      } catch (error) {
        console.error('Blogify reliable voice:', error);
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = error.message || 'Unable to send voice message.';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2500);
        }
      } finally {
        sending = false;
        button.disabled = false;
      }
    };

    const finish = () => {
      if (!recorder || recorder.state === 'inactive') return;
      recorder.stop();
    };

    button.addEventListener('click', async () => {
      if (sending) return;
      if (recorder && recorder.state !== 'inactive') {
        finish();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = 'Voice recording is not supported. Use HTTPS and allow microphone access.';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2500);
        }
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        const mimeType = preferredAudioMime();
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        chunks = [];
        startedAt = Date.now();

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };

        recorder.onerror = () => {
          cleanup();
          const toast = document.getElementById('toast');
          if (toast) toast.textContent = 'Voice recording failed.';
        };

        recorder.onstop = async () => {
          stopTimer();
          stopTracks();
          const actualMime = recorder?.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: actualMime });
          const durationMs = Date.now() - startedAt;
          recorder = null;
          chunks = [];
          startedAt = 0;
          setRecordingUI(false);
          const bar = document.getElementById('recordBar');
          if (bar) bar.classList.remove('show');

          if (blob.size < 512 || durationMs < 300) return;
          await sendVoice(blob, actualMime);
        };

        recorder.start(250);
        setRecordingUI(true);
        const bar = document.getElementById('recordBar');
        if (bar) bar.classList.add('show');
        updateRecordTime();
        timer = setInterval(updateRecordTime, 250);
      } catch (error) {
        cleanup();
        console.error('Blogify microphone:', error);
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = error.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow microphone access and try again.'
            : 'Unable to start voice recording.';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2500);
        }
      }
    });

    // Make the existing Stop button work with the reliable recorder.
    const stop = document.getElementById('stopRecord');
    if (stop) {
      stop.onclick = (event) => {
        event.preventDefault();
        finish();
      };
    }

    const cancel = document.getElementById('cancelRecord');
    if (cancel) {
      cancel.onclick = (event) => {
        event.preventDefault();
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = null;
          try { recorder.stop(); } catch (_) {}
        }
        cleanup();
      };
    }
  }

  function boot() {
    addProfileCardStyles();
    enhanceProfileCards(document);
    bindReliableVoice();

    const observer = new MutationObserver(() => {
      enhanceProfileCards(document);
      // Do not rebind the voice button after it has been replaced.
      bindReliableVoice();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
