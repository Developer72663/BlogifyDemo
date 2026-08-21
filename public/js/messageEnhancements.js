(function () {
  'use strict';
  const profileUrl = (id) => id ? '/user/profile/' + encodeURIComponent(String(id)) : '';

  function enhanceProfileCards(root) {
    const cards = (root || document).querySelectorAll('.profile-card:not([data-blogify-enhanced])');
    cards.forEach((card) => {
      card.dataset.blogifyEnhanced = '1';
      card.setAttribute('role', 'link');
      card.setAttribute('tabindex', '0');
      let href = card.getAttribute('data-profile-url') || '';
      const id = card.getAttribute('data-profile-id') || card.getAttribute('data-user-id') || card.dataset.profileShareId || '';
      if (!href && id) href = profileUrl(id);
      if (!href) {
        const existing = card.querySelector('a[href*="/profile/"],a[href*="/user/profile/"]');
        if (existing) href = existing.href;
      }
      if (!href) return;
      card.dataset.profileUrl = href;
      card.style.cursor = 'pointer';
      card.addEventListener('click', (event) => {
        if (event.target.closest('a,button')) return;
        window.location.href = href;
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = href;
        }
      });
      if (!card.querySelector('.blogify-view-profile')) {
        const body = card.querySelector('.profile-card-body') || card;
        const button = document.createElement('a');
        button.className = 'blogify-view-profile';
        button.href = href;
        button.innerHTML = '<i class="fas fa-user"></i><span>View Profile</span><i class="fas fa-arrow-right"></i>';
        body.appendChild(button);
      }
    });
  }

  function addProfileCardStyles() {
    if (document.getElementById('blogify-message-enhancement-style')) return;
    const style = document.createElement('style');
    style.id = 'blogify-message-enhancement-style';
    style.textContent = '.profile-card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease!important}.profile-card[data-profile-url]:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(0,0,0,.14);border-color:rgba(55,151,240,.45)}.blogify-view-profile{display:flex;align-items:center;gap:7px;margin-top:10px;padding:9px 11px;border-radius:11px;background:#3797f0;color:#fff!important;text-decoration:none!important;font-size:11px;font-weight:750}.blogify-view-profile span{flex:1}.blogify-view-profile:hover{filter:brightness(.96)}';
    document.head.appendChild(style);
  }

  async function voiceFallback(button) {
    if (button.dataset.blogifyVoiceFallback === 'busy') return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      alert('Voice recording is not supported by this browser. Please use HTTPS and allow microphone access.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      const chunks = [];
      const started = Date.now();
      button.dataset.blogifyVoiceFallback = 'busy';
      button.classList.add('recording');
      const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      const stopTimer = setTimeout(stop, 120000);
      recorder.addEventListener('dataavailable', e => { if (e.data?.size) chunks.push(e.data); });
      recorder.addEventListener('stop', async () => {
        clearTimeout(stopTimer);
        stream.getTracks().forEach(t => t.stop());
        button.classList.remove('recording');
        button.dataset.blogifyVoiceFallback = '';
        if (!chunks.length || Date.now() - started < 300) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
        const form = new FormData();
        form.append('media', blob, 'voice-' + Date.now() + '.' + ext);
        try {
          const upload = await fetch('/messages/upload', { method:'POST', credentials:'same-origin', body:form, headers:{Accept:'application/json'} });
          const data = await upload.json().catch(() => ({}));
          if (!upload.ok || !data.success || !data.mediaUrl) throw new Error(data.message || 'Voice upload failed');
          const socket = window.messageSocket || window.chatSocket || window.socket;
          const conversationId = window.currentConversationId || window.conversationId || document.querySelector('[data-conversation-id]')?.dataset.conversationId || '';
          if (!socket || !conversationId) throw new Error('Chat connection is not ready. Reopen this conversation and try again.');
          socket.emit('message:send', { conversationId, text:'', mediaUrl:data.mediaUrl, mediaType:'audio' });
        } catch (err) {
          console.error('Blogify voice fallback:', err);
          document.dispatchEvent(new CustomEvent('blogify:voice-error', { detail:{message:err.message} }));
        }
      });
      recorder.start(250);
      button.onclick = stop;
    } catch (err) {
      stream?.getTracks().forEach(t => t.stop());
      button.dataset.blogifyVoiceFallback = '';
      button.classList.remove('recording');
      console.error('Blogify microphone:', err);
      alert(err.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access and try again.' : 'Unable to start voice recording.');
    }
  }

  function bindVoiceFallback() {
    const selectors = ['#recordButton','#voiceButton','#recordVoice','[data-action="voice"]','[data-action="record"]','[aria-label*="voice" i]','[aria-label*="record" i]'];
    document.querySelectorAll(selectors.join(',')).forEach(button => {
      if (button.dataset.blogifyVoiceBound) return;
      button.dataset.blogifyVoiceBound = '1';
      button.addEventListener('click', function (event) {
        if (button.dataset.blogifyVoiceFallback === 'busy') return;
        if (button.classList.contains('recording') || document.querySelector('.record-bar.show')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        voiceFallback(button);
      }, true);
    });
  }

  function boot() {
    addProfileCardStyles();
    enhanceProfileCards(document);
    bindVoiceFallback();
    const observer = new MutationObserver(() => { enhanceProfileCards(document); bindVoiceFallback(); });
    observer.observe(document.body, { childList:true, subtree:true });
    document.addEventListener('blogify:voice-error', e => {
      const message = e.detail?.message || 'Unable to send voice message.';
      if (typeof window.showToast === 'function') window.showToast(message); else console.error(message);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
