(function(){
  'use strict';

  const profileMap = new Map();
  const metaLoaded = new Set();
  window.__BLOGIFY_PROFILE_MAP = profileMap;

  function rememberMessage(message){
    const p = message && message.profileShareId;
    if(!p || !p._id) return;
    const key = String(p.fullName || '').trim().toLowerCase();
    if(key) profileMap.set(key, p);
  }

  function rememberPayload(payload){
    if(!payload) return;
    if(Array.isArray(payload.messages)) payload.messages.forEach(rememberMessage);
    if(payload.message) rememberMessage(payload.message);
    if(payload._id) rememberMessage(payload);
  }

  const nativeFetch = window.fetch;
  if(typeof nativeFetch === 'function'){
    window.fetch = async function(){
      const response = await nativeFetch.apply(this, arguments);
      try{
        const url = String(arguments[0]?.url || arguments[0] || '');
        if(url.includes('/messages/') && !url.includes('/profile-meta/')){
          const clone = response.clone();
          clone.json().then(rememberPayload).catch(()=>{});
        }
      }catch(_){ }
      return response;
    };
  }

  const nativeIo = window.io;
  if(typeof nativeIo === 'function'){
    window.io = function(){
      const socket = nativeIo.apply(this, arguments);
      try{
        const nativeOn = socket.on.bind(socket);
        socket.on = function(event, handler){
          if(event === 'message:new' && typeof handler === 'function'){
            return nativeOn(event, function(message){ rememberMessage(message); return handler.apply(this, arguments); });
          }
          return nativeOn(event, handler);
        };
      }catch(_){ }
      return socket;
    };
    Object.keys(nativeIo).forEach(k=>{ try{ window.io[k]=nativeIo[k]; }catch(_){} });
  }

  // The original message page owns the recording pipeline. This wrapper only
  // fixes cancellation/format edge cases without creating a second recorder.
  const NativeRecorder = window.MediaRecorder;
  if(NativeRecorder && !window.__BLOGIFY_MEDIA_RECORDER_PATCHED){
    window.__BLOGIFY_MEDIA_RECORDER_PATCHED = true;
    const Recorder = function(stream, options){
      const recorder = options ? new NativeRecorder(stream, options) : new NativeRecorder(stream);
      let userDataHandler = null;
      const originalStop = recorder.stop.bind(recorder);
      const proxy = new Proxy(recorder, {
        get(target, prop){
          if(prop === 'stop'){
            return function(){
              if(window.__BLOGIFY_CANCEL_RECORDING){
                window.__BLOGIFY_SUPPRESS_VOICE_DATA = true;
                setTimeout(()=>{ window.__BLOGIFY_SUPPRESS_VOICE_DATA = false; }, 1500);
              }
              return originalStop();
            };
          }
          if(prop === 'ondataavailable') return userDataHandler;
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, prop, value){
          if(prop === 'ondataavailable'){
            userDataHandler = typeof value === 'function' ? function(event){
              if(window.__BLOGIFY_SUPPRESS_VOICE_DATA) return;
              return value.call(proxy, event);
            } : value;
            target[prop] = userDataHandler;
            return true;
          }
          target[prop] = value;
          return true;
        }
      });
      window.__BLOGIFY_ACTIVE_RECORDER = proxy;
      const autoStop = setTimeout(()=>{ try{ if(proxy.state === 'recording') proxy.stop(); }catch(_){} },120000);
      proxy.addEventListener('stop',()=>{
        clearTimeout(autoStop);
        if(window.__BLOGIFY_ACTIVE_RECORDER === proxy) window.__BLOGIFY_ACTIVE_RECORDER = null;
        window.__BLOGIFY_CANCEL_RECORDING = false;
      },{once:true});
      return proxy;
    };
    Recorder.isTypeSupported = NativeRecorder.isTypeSupported.bind(NativeRecorder);
    Recorder.prototype = NativeRecorder.prototype;
    try{ Object.setPrototypeOf(Recorder,NativeRecorder); }catch(_){}
    window.MediaRecorder = Recorder;
  }

  document.addEventListener('click',function(event){
    const cancel = event.target.closest && event.target.closest('#cancelRecord');
    if(cancel){
      window.__BLOGIFY_CANCEL_RECORDING = true;
      setTimeout(()=>{ window.__BLOGIFY_CANCEL_RECORDING = false; },1600);
    }
  },true);

  async function loadMeta(card, profile){
    const id=String(profile?._id||'');
    if(!id || metaLoaded.has(id)) return;
    metaLoaded.add(id);
    try{
      const r=await nativeFetch('/messages/profile-meta/'+encodeURIComponent(id),{credentials:'same-origin'});
      if(!r.ok) return;
      const d=await r.json();
      if(!d.success) return;
      card.dataset.following=String(Boolean(d.profile.isFollowing));
      card.dataset.followedBy=String(Boolean(d.profile.followsYou));
      card.dataset.mutual=String(Boolean(d.profile.isMutual));
      card.dispatchEvent(new CustomEvent('blogify:profile-meta',{bubbles:true}));
    }catch(_){ }
  }

  function enrichProfileCards(){
    document.querySelectorAll('.profile-card').forEach(card=>{
      if(!card.dataset.profileId){
        const name=card.querySelector('.profile-card-name')?.textContent?.trim().toLowerCase();
        const profile=name?profileMap.get(name):null;
        if(!profile?._id) return;
        card.dataset.profileId=String(profile._id);
        card.__blogifyProfile=profile;
      }
      const profile=card.__blogifyProfile||profileMap.get(card.querySelector('.profile-card-name')?.textContent?.trim().toLowerCase());
      if(profile) loadMeta(card,profile);
    });
  }

  function boot(){
    enrichProfileCards();
    new MutationObserver(enrichProfileCards).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();