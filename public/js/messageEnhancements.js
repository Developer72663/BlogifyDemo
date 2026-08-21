(function(){
'use strict';
const DEFAULT_AVATAR='/imgs/default.png';
const HOLD_MS=1400;
const $=id=>document.getElementById(id);

function styles(){
 if($('blogify-message-enhancement-style'))return;
 const s=document.createElement('style');s.id='blogify-message-enhancement-style';s.textContent=`
.profile-card.blogify-shared-profile{position:relative!important;display:flex!important;align-items:center!important;gap:12px!important;width:min(380px,88vw)!important;min-height:88px!important;box-sizing:border-box!important;padding:14px 14px 14px 15px!important;margin:5px 0!important;border:1px solid color-mix(in srgb,var(--line,#e3e3e6) 76%,#3797f0 24%)!important;border-radius:22px!important;overflow:hidden!important;background:linear-gradient(135deg,var(--surface,#fff),color-mix(in srgb,var(--surface,#fff) 88%,#3797f0 12%))!important;box-shadow:0 9px 28px rgba(0,0,0,.11)!important;cursor:pointer!important;-webkit-tap-highlight-color:transparent!important;transition:transform .16s ease,box-shadow .16s ease!important}.profile-card.blogify-shared-profile:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(180deg,#3797f0,#8b5cf6)}.profile-card.blogify-shared-profile:active{transform:scale(.975)!important;box-shadow:0 5px 18px rgba(0,0,0,.10)!important}.profile-card.blogify-shared-profile>img{flex:0 0 58px!important;width:58px!important;height:58px!important;border-radius:50%!important;object-fit:cover!important;background:var(--input,#f1f3f5)!important;border:3px solid var(--surface,#fff)!important;box-shadow:0 0 0 2px rgba(55,151,240,.30)!important;z-index:1!important}.profile-card.blogify-shared-profile .profile-card-body{flex:1 1 auto!important;min-width:0!important;padding:0 112px 0 0!important;position:relative!important;z-index:1!important}.profile-card.blogify-shared-profile .profile-card-name{display:block!important;margin:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:var(--text,#111)!important;font-size:14px!important;font-weight:800!important}.profile-card.blogify-shared-profile .profile-card-bio{margin:4px 0 0!important;color:var(--muted,#737b87)!important;font-size:10.5px!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}.blogify-profile-meta{display:flex!important;align-items:center!important;gap:7px!important;margin-top:6px!important;white-space:nowrap!important;overflow:hidden!important}.blogify-profile-username{overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#737b87)!important;font-size:10px!important;max-width:100px!important}.blogify-follow-status{display:inline-flex!important;align-items:center!important;gap:4px!important;color:#3797f0!important;font-size:9.5px!important;font-weight:750!important}.blogify-profile-action{position:absolute!important;right:11px!important;bottom:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;height:30px!important;padding:0 12px!important;border:0!important;border-radius:999px!important;background:linear-gradient(135deg,#3797f0,#6d5dfc)!important;color:#fff!important;text-decoration:none!important;font-size:10px!important;font-weight:800!important;z-index:2!important;box-shadow:0 5px 14px rgba(55,151,240,.22)!important}.blogify-longpress{animation:blogifyHold .18s ease-out}@keyframes blogifyHold{from{transform:scale(.985)}to{transform:scale(1)}}
`;document.head.appendChild(s);
}

function showToast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2400);}

async function resolveSharedProfile(messageId){
 const params=new URLSearchParams(location.search);const userId=params.get('user');
 if(!userId||!messageId)throw new Error('Shared profile information is unavailable');
 const c=await fetch('/messages/conversation',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({userId})});
 const cd=await c.json();
 if(!c.ok||!cd.success||!cd.conversationId)throw new Error(cd.message||'Unable to open conversation');
 let before=null;
 for(let page=0;page<20;page++){
  const url='/messages/'+encodeURIComponent(cd.conversationId)+'?limit=100'+(before?'&before='+encodeURIComponent(before):'');
  const r=await fetch(url,{credentials:'same-origin'});const d=await r.json();
  if(!r.ok||!d.success)throw new Error(d.message||'Unable to load shared profile');
  const found=(d.messages||[]).find(m=>String(m._id)===String(messageId));
  if(found&&found.profileShareId){const id=typeof found.profileShareId==='object'?found.profileShareId._id:found.profileShareId;if(id)return '/profile/'+encodeURIComponent(String(id));}
  if(!d.hasMore||!d.messages?.length)break;
  before=d.messages[0].createdAt;
 }
 throw new Error('Shared profile is no longer available');
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
   const st=document.createElement('span');st.className='blogify-follow-status';st.textContent=mutual||(following&&followedBy)?'● Mutual':following?'✓ Following':followedBy?'↗ Follows you':'● Profile';meta.appendChild(st);body.appendChild(meta);
  }
  let action=body.querySelector('.blogify-profile-action');
  if(!action){action=document.createElement('a');action.className='blogify-profile-action';action.innerHTML='<span>View profile</span><span aria-hidden="true">›</span>';body.appendChild(action);}
  action.removeAttribute('href');
  card.setAttribute('role','link');card.setAttribute('tabindex','0');card.setAttribute('aria-label','View shared profile');
  if(card.dataset.profileNavigationBound)return;
  card.dataset.profileNavigationBound='1';
  const row=card.closest('.message-row');
  const open=async e=>{
   if(e){e.preventDefault();e.stopPropagation();}
   if(card.dataset.opening==='1')return;card.dataset.opening='1';
   try{const href=await resolveSharedProfile(row?.dataset.id);window.location.assign(href);}catch(err){showToast(err.message||'Unable to open profile');}finally{card.dataset.opening='0';}
  };
  card.addEventListener('click',e=>{open(e);});
  action.addEventListener('click',open);
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

function boot(){styles();profiles(document);longPress();const observer=new MutationObserver(()=>{profiles(document);longPress();});observer.observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();