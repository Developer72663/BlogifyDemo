(function () {
  'use strict';

  const defaultAvatar = '/imgs/default.png';

  function profileUrl(id) {
    return id ? '/profile/' + encodeURIComponent(String(id)) : '';
  }

  function getProfileId(card) {
    return card.getAttribute('data-profile-id') || card.getAttribute('data-user-id') || card.dataset.profileShareId || '';
  }

  function addRelationshipInfo(card, body) {
    if (body.querySelector('.blogify-profile-meta')) return;

    const meta = document.createElement('div');
    meta.className = 'blogify-profile-meta';

    const username = card.getAttribute('data-username') || card.dataset.username || '';
    const following = card.getAttribute('data-following') === 'true' || card.dataset.following === 'true';
    const followedBy = card.getAttribute('data-followed-by') === 'true' || card.dataset.followedBy === 'true';
    const mutual = card.getAttribute('data-mutual') === 'true' || card.dataset.mutual === 'true';

    if (username) {
      const handle = document.createElement('span');
      handle.className = 'blogify-profile-username';
      handle.textContent = username.startsWith('@') ? username : '@' + username;
      meta.appendChild(handle);
    }

    const status = document.createElement('span');
    status.className = 'blogify-follow-status';
    if (mutual) {
      status.innerHTML = '<i class="fas fa-user-group"></i> Mutual';
    } else if (following && followedBy) {
      status.innerHTML = '<i class="fas fa-user-group"></i> Mutual';
    } else if (following) {
      status.innerHTML = '<i class="fas fa-check"></i> Following';
    } else if (followedBy) {
      status.innerHTML = '<i class="fas fa-user-plus"></i> Follows you';
    } else {
      status.innerHTML = '<i class="fas fa-user"></i> Profile';
    }
    meta.appendChild(status);
    body.appendChild(meta);
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
        image.alt = 'Shared profile avatar';
        image.onerror = () => { image.src = defaultAvatar; };
      }

      const body = card.querySelector('.profile-card-body') || card;
      const name = body.querySelector('.profile-card-name');
      const bio = body.querySelector('.profile-card-bio');

      if (!body.querySelector('.blogify-profile-label')) {
        const label = document.createElement('div');
        label.className = 'blogify-profile-label';
        label.innerHTML = '<span class="blogify-profile-dot"></span><span>SHARED PROFILE</span>';
        body.insertBefore(label, body.firstChild);
      }

      if (bio && !bio.textContent.trim()) bio.textContent = 'View this profile';
      addRelationshipInfo(card, body);

      const id = getProfileId(card);
      if (id) {
        const href = profileUrl(id);
        card.dataset.profileUrl = href;
        card.setAttribute('role', 'link');
        card.setAttribute('tabindex', '0');
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
        const action = document.createElement('a');
        action.className = 'blogify-profile-action';
        action.href = profileUrl(id) || '#';
        action.innerHTML = '<span>View profile</span><i class="fas fa-chevron-right"></i>';
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
        position:relative!important;
        display:grid!important;
        grid-template-columns:56px minmax(0,1fr)!important;
        column-gap:12px!important;
        align-items:center!important;
        width:min(350px,84vw)!important;
        min-height:82px!important;
        padding:12px 12px 12px 13px!important;
        margin:4px 0!important;
        border:1px solid rgba(120,130,150,.22)!important;
        border-radius:18px!important;
        overflow:hidden!important;
        background:var(--surface,#fff)!important;
        box-shadow:0 5px 18px rgba(0,0,0,.08)!important;
        cursor:pointer!important;
        transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease!important;
      }
      .profile-card.blogify-shared-profile::before{
        content:"";position:absolute;inset:0 auto 0 0;width:3px;
        background:linear-gradient(180deg,#3797f0,#8b5cf6);
      }
      .profile-card.blogify-shared-profile:hover{transform:translateY(-1px)!important;box-shadow:0 9px 25px rgba(0,0,0,.12)!important;border-color:rgba(55,151,240,.35)!important}
      .profile-card.blogify-shared-profile:active{transform:scale(.985)!important}
      .profile-card.blogify-shared-profile > img,
      .profile-card.blogify-shared-profile .profile-card-image,
      .profile-card.blogify-shared-profile .profile-image{
        grid-column:1!important;grid-row:1!important;width:56px!important;height:56px!important;min-width:56px!important;
        border-radius:50%!important;object-fit:cover!important;background:var(--input,#f1f3f5)!important;
        border:2px solid var(--surface,#fff)!important;box-shadow:0 0 0 1.5px rgba(55,151,240,.35)!important;
      }
      .profile-card.blogify-shared-profile .profile-card-body{grid-column:2!important;grid-row:1!important;min-width:0!important;padding:0 82px 0 0!important}
      .blogify-profile-label{display:flex!important;align-items:center!important;gap:5px!important;margin:0 0 4px!important;color:#7b8794!important;font-size:8.5px!important;line-height:1!important;font-weight:800!important;letter-spacing:.65px!important}
      .blogify-profile-dot{width:5px!important;height:5px!important;flex:0 0 5px!important;border-radius:50%!important;background:#3797f0!important}
      .profile-card.blogify-shared-profile .profile-card-name{display:block!important;margin:0!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:var(--text,#111)!important;font-size:14px!important;line-height:1.2!important;font-weight:750!important}
      .profile-card.blogify-shared-profile .profile-card-bio{margin:3px 0 0!important;color:var(--muted,#737b87)!important;font-size:10.5px!important;line-height:1.25!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}
      .blogify-profile-meta{display:flex!important;align-items:center!important;gap:7px!important;margin-top:5px!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important}
      .blogify-profile-username{overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#737b87)!important;font-size:10px!important;max-width:105px!important}
      .blogify-follow-status{display:inline-flex!important;align-items:center!important;gap:4px!important;color:#3797f0!important;font-size:9.5px!important;font-weight:700!important}
      .blogify-follow-status i{font-size:8px!important}
      .blogify-profile-action{position:absolute!important;right:11px!important;bottom:11px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;height:27px!important;padding:0 10px!important;border:1px solid rgba(55,151,240,.22)!important;border-radius:999px!important;background:rgba(55,151,240,.08)!important;color:#3797f0!important;text-decoration:none!important;font-size:10px!important;font-weight:750!important;transition:background .15s ease,transform .15s ease!important}
      .blogify-profile-action:hover{background:rgba(55,151,240,.15)!important;transform:translateY(-1px)!important}
      .blogify-profile-action i{font-size:8px!important}
      @media(max-width:380px){.profile-card.blogify-shared-profile{width:min(320px,87vw)!important;grid-template-columns:50px minmax(0,1fr)!important;padding:10px 10px 10px 11px!important}.profile-card.blogify-shared-profile > img,.profile-card.blogify-shared-profile .profile-card-image,.profile-card.blogify-shared-profile .profile-image{width:50px!important;height:50px!important;min-width:50px!important}.profile-card.blogify-shared-profile .profile-card-body{padding-right:76px!important}}
    `;
    document.head.appendChild(style);
  }

  function preferredAudioMime() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4','audio/aac'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
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
    const response = await fetch('/messages/conversation', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify({userId}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.conversationId) throw new Error(data.message || 'Unable to open conversation.');
    return data.conversationId;
  }

  async function uploadVoice(blob, mime) {
    const form = new FormData();
    form.append('media', blob, `voice-message-${Date.now()}.${extensionForMime(mime)}`);
    const response = await fetch('/messages/upload', { method:'POST', credentials:'same-origin', body:form, headers:{Accept:'application/json'} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.mediaUrl) throw new Error(data.message || 'Voice upload failed.');
    return data.mediaUrl;
  }

  function bindReliableVoice() {
    const original = document.getElementById('voiceButton');
    if (!original || original.dataset.blogifyReliableVoice) return;
    const button = original.cloneNode(true);
    original.replaceWith(button);
    button.dataset.blogifyReliableVoice = '1';
    let recorder=null, stream=null, chunks=[], startedAt=0, timer=null, sending=false;
    const setUI=(active)=>{button.classList.toggle('recording',active);button.innerHTML=active?'<i class="fas fa-circle"></i>':'<i class="fas fa-microphone"></i>';button.setAttribute('aria-label',active?'Stop voice recording':'Record voice message');};
    const stopTracks=()=>{if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;};
    const stopTimer=()=>{if(timer)clearInterval(timer);timer=null;};
    const updateTime=()=>{const s=Math.max(0,Math.floor((Date.now()-startedAt)/1000)),t=document.getElementById('recordTime');if(t)t.textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
    const cleanup=()=>{stopTimer();stopTracks();recorder=null;chunks=[];startedAt=0;setUI(false);const b=document.getElementById('recordBar');if(b)b.classList.remove('show');};
    const send=async(blob,mime)=>{if(sending)return;sending=true;button.disabled=true;try{const mediaUrl=await uploadVoice(blob,mime),conversationId=await getConversationId();if(typeof window.io!=='function')throw new Error('Chat connection is unavailable.');const socket=window.io(window.__BLOGIFY_SOCKET_URL||undefined,{withCredentials:true,auth:{token:window.__BLOGIFY_SOCKET_TOKEN||undefined}});await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chat connection timed out.')),10000);socket.on('connect',()=>{socket.emit('conversation:join',conversationId);socket.emit('message:send',{conversationId,text:'',mediaUrl,mediaType:'audio'});clearTimeout(timeout);setTimeout(()=>{socket.disconnect();resolve();},250);});socket.on('connect_error',()=>{clearTimeout(timeout);reject(new Error('Unable to connect to chat.'));});});}catch(e){console.error('Blogify reliable voice:',e);const t=document.getElementById('toast');if(t){t.textContent=e.message||'Unable to send voice message.';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}}finally{sending=false;button.disabled=false;}};
    const finish=()=>{if(recorder&&recorder.state!=='inactive')recorder.stop();};
    button.addEventListener('click',async()=>{if(sending)return;if(recorder&&recorder.state!=='inactive'){finish();return;}if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){const t=document.getElementById('toast');if(t){t.textContent='Voice recording is not supported. Use HTTPS and allow microphone access.';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}return;}try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});const mimeType=preferredAudioMime();recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);chunks=[];startedAt=Date.now();recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};recorder.onerror=()=>{cleanup();};recorder.onstop=async()=>{stopTimer();stopTracks();const actualMime=recorder?.mimeType||mimeType||'audio/webm';const blob=new Blob(chunks,{type:actualMime});const duration=Date.now()-startedAt;recorder=null;chunks=[];startedAt=0;setUI(false);const b=document.getElementById('recordBar');if(b)b.classList.remove('show');if(blob.size>=512&&duration>=300)await send(blob,actualMime);};recorder.start(250);setUI(true);const b=document.getElementById('recordBar');if(b)b.classList.add('show');updateTime();timer=setInterval(updateTime,250);}catch(e){cleanup();console.error('Blogify microphone:',e);const t=document.getElementById('toast');if(t){t.textContent=e.name==='NotAllowedError'?'Microphone permission was denied. Allow microphone access and try again.':'Unable to start voice recording.';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}}});
    const stop=document.getElementById('stopRecord');if(stop)stop.onclick=e=>{e.preventDefault();finish();};
    const cancel=document.getElementById('cancelRecord');if(cancel)cancel.onclick=e=>{e.preventDefault();if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;try{recorder.stop();}catch(_){} }cleanup();};
  }

  function boot(){addProfileCardStyles();enhanceProfileCards(document);bindReliableVoice();const observer=new MutationObserver(()=>{enhanceProfileCards(document);bindReliableVoice();});observer.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
