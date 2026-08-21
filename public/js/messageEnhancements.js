(function(){
'use strict';
const DEFAULT_AVATAR='/imgs/default.png';
const HOLD_MS=1400;
const MAX_VOICE_MS=120000;
const $=id=>document.getElementById(id);
const profileUrl=id=>id?'/profile/'+encodeURIComponent(String(id)):'';

function normalizeProfileUrl(value){
  if(!value)return '';
  const raw=String(value).trim();
  if(raw.startsWith('/'))return raw;
  if(/^https?:\/\//i.test(raw))return raw;
  return profileUrl(raw);
}

function profileId(card){
  return card.getAttribute('data-profile-id')||card.getAttribute('data-user-id')||card.getAttribute('data-profile-share-id')||card.dataset.profileShareId||'';
}

function styles(){
 if($('blogify-message-enhancement-style'))return;
 const s=document.createElement('style');s.id='blogify-message-enhancement-style';s.textContent=`
.profile-card.blogify-shared-profile{position:relative!important;display:flex!important;align-items:center!important;gap:12px!important;width:min(370px,86vw)!important;min-height:86px!important;box-sizing:border-box!important;padding:13px 13px 13px 14px!important;margin:5px 0!important;border:1px solid color-mix(in srgb,var(--line,#e3e3e6) 80%,#3797f0 20%)!important;border-radius:22px!important;overflow:hidden!important;background:linear-gradient(135deg,var(--surface,#fff),color-mix(in srgb,var(--surface,#fff) 90%,#3797f0 10%))!important;box-shadow:0 8px 26px rgba(0,0,0,.10)!important;cursor:pointer!important;-webkit-tap-highlight-color:transparent!important;transition:transform .16s ease,box-shadow .16s ease}.profile-card.blogify-shared-profile:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(180deg,#3797f0,#8b5cf6)}.profile-card.blogify-shared-profile:active{transform:scale(.975)!important}.profile-card.blogify-shared-profile>img{flex:0 0 58px!important;width:58px!important;height:58px!important;border-radius:50%!important;object-fit:cover!important;background:var(--input,#f1f3f5)!important;border:3px solid var(--surface,#fff)!important;box-shadow:0 0 0 2px rgba(55,151,240,.30)!important;z-index:1!important}.profile-card.blogify-shared-profile .profile-card-body{flex:1 1 auto!important;min-width:0!important;padding:0 91px 0 0!important;position:relative!important;z-index:1!important}.profile-card.blogify-shared-profile .profile-card-name{display:block!important;margin:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:var(--text,#111)!important;font-size:14px!important;font-weight:800!important}.profile-card.blogify-shared-profile .profile-card-bio{margin:4px 0 0!important;color:var(--muted,#737b87)!important;font-size:10.5px!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}.blogify-profile-meta{display:flex!important;align-items:center!important;gap:7px!important;margin-top:6px!important;white-space:nowrap!important;overflow:hidden!important}.blogify-profile-username{overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#737b87)!important;font-size:10px!important;max-width:100px!important}.blogify-follow-status{display:inline-flex!important;align-items:center!important;gap:4px!important;color:#3797f0!important;font-size:9.5px!important;font-weight:750!important}.blogify-profile-action{position:absolute!important;right:11px!important;bottom:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;height:29px!important;padding:0 11px!important;border:0!important;border-radius:999px!important;background:linear-gradient(135deg,#3797f0,#6d5dfc)!important;color:#fff!important;text-decoration:none!important;font-size:10px!important;font-weight:800!important;z-index:2!important}.blogify-longpress{animation:blogifyHold .18s ease-out}@keyframes blogifyHold{from{transform:scale(.985)}to{transform:scale(1)}}.blogify-recording-pulse{animation:blogifyRecordPulse 1s ease-in-out infinite}@keyframes blogifyRecordPulse{50%{transform:scale(1.06)}}
`;document.head.appendChild(s);
}

function profiles(root){
 (root||document).querySelectorAll('.profile-card:not([data-blogify-enhanced])').forEach(card=>{
  card.dataset.blogifyEnhanced='1';card.classList.add('blogify-shared-profile');
  const img=card.querySelector('img');
  if(img){img.loading='lazy';img.decoding='async';img.alt='Shared profile avatar';img.onerror=()=>{img.onerror=null;img.src=DEFAULT_AVATAR;};}
  const body=card.querySelector('.profile-card-body')||card;
  const username=card.dataset.username||'';
  const following=card.dataset.following==='true';
  const followedBy=card.dataset.followedBy==='true';
  const mutual=card.dataset.mutual==='true';
  if(!body.querySelector('.blogify-profile-meta')){
   const meta=document.createElement('div');meta.className='blogify-profile-meta';
   if(username){const u=document.createElement('span');u.className='blogify-profile-username';u.textContent=username.startsWith('@')?username:'@'+username;meta.appendChild(u);}
   const st=document.createElement('span');st.className='blogify-follow-status';
   st.textContent=mutual||(following&&followedBy)?'● Mutual':following?'✓ Following':followedBy?'↗ Follows you':'● Profile';meta.appendChild(st);body.appendChild(meta);
  }
  const row=card.closest('.message-row');
  const direct=normalizeProfileUrl(profileId(card));
  const action=body.querySelector('.blogify-profile-action')||document.createElement('a');
  if(!action.classList.contains('blogify-profile-action')){action.className='blogify-profile-action';action.innerHTML='<span>View profile</span><span aria-hidden="true">›</span>';body.appendChild(action);}
  if(direct)action.href=direct;else action.removeAttribute('href');
  card.setAttribute('role','link');card.setAttribute('tabindex','0');card.setAttribute('aria-label','View shared profile');
  if(card.dataset.profileNavigationBound)return;
  card.dataset.profileNavigationBound='1';
  const open=async e=>{
   if(e){e.preventDefault();e.stopPropagation();}
   const href=direct||card.dataset.profileUrl||'';
   if(href)return window.location.assign(href);
   const messageId=row?.dataset.id;
   if(!messageId){return;}
   try{
    const r=await fetch('/messages/profile-share/'+encodeURIComponent(messageId),{credentials:'same-origin'});
    const d=await r.json();
    if(!r.ok||!d.success||!d.url)throw new Error(d.message||'Profile unavailable');
    card.dataset.profileUrl=d.url;
    window.location.assign(d.url);
   }catch(err){
    const t=$('toast');if(t){t.textContent=err.message||'Unable to open profile';t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200);}
   }
  };
  card.addEventListener('click',e=>{if(e.target.closest('.blogify-profile-action'))return;open(e);});
  action.addEventListener('click',e=>open(e));
  card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){open(e);}});
 });
}

function longPress(){
 document.querySelectorAll('.message-bubble[data-message-id]:not([data-blogify-hold])').forEach(b=>{
  b.dataset.blogifyHold='1';let timer=null,fired=false,x=0,y=0;
  const clear=()=>{if(timer)clearTimeout(timer);timer=null;};
  b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;fired=false;x=e.clientX;y=e.clientY;clear();timer=setTimeout(()=>{timer=null;fired=true;b.classList.add('blogify-longpress');setTimeout(()=>b.classList.remove('blogify-longpress'),220);b.click();},HOLD_MS);},{passive:true});
  b.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-x,e.clientY-y)>12)clear();},{passive:true});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,clear,{passive:true}));
  b.addEventListener('click',e=>{if(!fired){e.preventDefault();e.stopImmediatePropagation();}fired=false;},true);
 });
}

function getVoiceSocket(){
 if(typeof window.io!=='function')throw new Error('Chat connection is unavailable');
 return window.io(window.__BLOGIFY_SOCKET_URL||undefined,{withCredentials:true,auth:{token:window.__BLOGIFY_SOCKET_TOKEN||undefined}});
}

async function getConversationId(){
 const params=new URLSearchParams(location.search);const userId=params.get('user');
 if(!userId)throw new Error('Conversation recipient is missing');
 const r=await fetch('/messages/conversation',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({userId})});
 const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Unable to prepare chat');return String(d.conversationId);
}

async function uploadVoice(blob,type){
 const ext=type.includes('ogg')?'ogg':type.includes('mp4')||type.includes('m4a')?'m4a':type.includes('mpeg')||type.includes('mp3')?'mp3':'webm';
 const file=new File([blob],'voice-message.'+ext,{type:type||'audio/webm'});const fd=new FormData();fd.append('media',file,file.name);
 const r=await fetch('/messages/upload',{method:'POST',body:fd,credentials:'same-origin'});const d=await r.json();if(!r.ok||!d.success||d.mediaType!=='audio')throw new Error(d.message||'Voice upload failed');return d.mediaUrl;
}

function voiceRecorder(){
 const voice=$('voiceButton'),stop=$('stopRecord'),send=$('sendRecord'),cancel=$('cancelRecord'),bar=$('recordBar'),time=$('recordTime'),title=$('recordTitle');
 if(!voice||!stop||!send||!cancel||!bar||voice.dataset.blogifyVoiceFixed)return;voice.dataset.blogifyVoiceFixed='1';
 const replace=el=>el.cloneNode(true);const nv=replace(voice),ns=replace(stop),nd=replace(send),nc=replace(cancel);voice.replaceWith(nv);stop.replaceWith(ns);send.replaceWith(nd);cancel.replaceWith(nc);
 let rec=null,stream=null,chunks=[],started=0,timer=null,ready=null,sending=false;
 const setTime=s=>time.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
 const cleanup=()=>{clearInterval(timer);timer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}rec=null;nv.classList.remove('recording','blogify-recording-pulse');nv.innerHTML='<i class="fas fa-microphone"></i>';};
 const reset=()=>{ready=null;cleanup();bar.classList.remove('show');setTime(0);ns.style.display='inline-block';nd.style.display='none';title.innerHTML='<i class="fas fa-microphone"></i> Recording voice message';};
 const stopNow=()=>{if(rec&&rec.state!=='inactive')rec.stop();};
 nv.addEventListener('click',async()=>{if(rec){stopNow();return;}if(ready)return;try{if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Voice recording is not supported on this browser');stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});const candidates=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'];const mime=candidates.find(x=>MediaRecorder.isTypeSupported(x))||'';rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunks=[];started=Date.now();rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};rec.onerror=()=>{cleanup();reset();showToast('Voice recording failed');};rec.onstop=()=>{const type=rec?.mimeType||mime||'audio/webm';const blob=new Blob(chunks,{type});const duration=Math.max(1,Math.round((Date.now()-started)/1000));ready=blob.size?{blob,type,duration}:null;cleanup();if(ready){bar.classList.add('show');ns.style.display='none';nd.style.display='inline-block';title.innerHTML='<i class="fas fa-check-circle"></i> Voice message ready';setTime(duration);}else reset();};rec.start(250);bar.classList.add('show');title.innerHTML='<i class="fas fa-microphone"></i> Recording voice message';nv.classList.add('recording','blogify-recording-pulse');nv.innerHTML='<i class="fas fa-circle"></i>';timer=setInterval(()=>{const elapsed=Date.now()-started;setTime(Math.floor(elapsed/1000));if(elapsed>=MAX_VOICE_MS)stopNow();},250);}catch(e){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}showToast(e.message||'Microphone permission is required');}});
 ns.addEventListener('click',stopNow);
 nc.addEventListener('click',()=>{if(rec){try{rec.onstop=null;rec.stop();}catch(_){} }reset();});
 nd.addEventListener('click',async()=>{if(!ready||sending)return;sending=true;nd.disabled=true;try{const conversationId=await getConversationId();const socket=getVoiceSocket();await new Promise((resolve,reject)=>{const fail=d=>reject(new Error(d?.message||'Chat connection unavailable'));socket.once('connect_error',fail);socket.once('connect',resolve);setTimeout(()=>reject(new Error('Chat connection timed out')),10000);});const mediaUrl=await uploadVoice(ready.blob,ready.type);socket.emit('conversation:join',conversationId);socket.emit('message:send',{conversationId,text:'',mediaUrl,mediaType:'audio',replyTo:null});showToast('Voice message sent');socket.disconnect();reset();}catch(e){showToast(e.message||'Unable to send voice message');}finally{sending=false;nd.disabled=false;}});
 window.addEventListener('beforeunload',()=>{try{if(rec){rec.onstop=null;rec.stop();}}catch(_){}cleanup();});
}

function showToast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2400);}

function boot(){styles();profiles(document);longPress();voiceRecorder();const observer=new MutationObserver(()=>{profiles(document);longPress();});observer.observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
