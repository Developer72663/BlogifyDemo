(function(){
'use strict';
const DEFAULT_AVATAR='/imgs/default.png';
const HOLD_MS=1400;
const profileUrl=id=>id?'/profile/'+encodeURIComponent(String(id)):'';

function profileId(card){
  const direct=card.getAttribute('data-profile-id')||card.getAttribute('data-user-id')||card.getAttribute('data-profile-share-id')||card.dataset.profileShareId;
  if(direct)return direct;
  const link=card.querySelector('a[href*="/profile/"]');
  return link?link.getAttribute('href'):'';
}

function normalizeProfileUrl(value){
  if(!value)return '';
  const raw=String(value).trim();
  if(raw.startsWith('/'))return raw;
  if(/^https?:\/\//i.test(raw))return raw;
  return profileUrl(raw);
}

function styles(){
 if(document.getElementById('blogify-message-enhancement-style'))return;
 const s=document.createElement('style');s.id='blogify-message-enhancement-style';s.textContent=`
.profile-card.blogify-shared-profile{position:relative!important;display:flex!important;align-items:center!important;gap:12px!important;width:min(370px,86vw)!important;min-height:86px!important;box-sizing:border-box!important;padding:13px 13px 13px 14px!important;margin:5px 0!important;border:1px solid color-mix(in srgb,var(--line,#e3e3e6) 80%,#3797f0 20%)!important;border-radius:22px!important;overflow:hidden!important;background:linear-gradient(135deg,var(--surface,#fff),color-mix(in srgb,var(--surface,#fff) 90%,#3797f0 10%))!important;box-shadow:0 8px 26px rgba(0,0,0,.10)!important;cursor:pointer!important;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease!important;-webkit-tap-highlight-color:transparent!important}.profile-card.blogify-shared-profile:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(180deg,#3797f0,#8b5cf6)}.profile-card.blogify-shared-profile:after{content:"";position:absolute;right:-34px;top:-42px;width:105px;height:105px;border-radius:50%;background:rgba(55,151,240,.08);pointer-events:none}.profile-card.blogify-shared-profile:active{transform:scale(.975)!important;box-shadow:0 4px 15px rgba(0,0,0,.12)!important}.profile-card.blogify-shared-profile>img{flex:0 0 58px!important;width:58px!important;height:58px!important;border-radius:50%!important;object-fit:cover!important;background:var(--input,#f1f3f5)!important;border:3px solid var(--surface,#fff)!important;box-shadow:0 0 0 2px rgba(55,151,240,.30)!important;position:relative!important;z-index:1!important}.profile-card.blogify-shared-profile .profile-card-body{flex:1 1 auto!important;min-width:0!important;padding:0 91px 0 0!important;position:relative!important;z-index:1!important}.profile-card.blogify-shared-profile .profile-card-name{display:block!important;margin:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:var(--text,#111)!important;font-size:14px!important;line-height:1.25!important;font-weight:800!important;letter-spacing:-.1px!important}.profile-card.blogify-shared-profile .profile-card-bio{margin:4px 0 0!important;color:var(--muted,#737b87)!important;font-size:10.5px!important;line-height:1.25!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}.blogify-profile-meta{display:flex!important;align-items:center!important;gap:7px!important;margin-top:6px!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important}.blogify-profile-username{overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#737b87)!important;font-size:10px!important;max-width:100px!important}.blogify-follow-status{display:inline-flex!important;align-items:center!important;gap:4px!important;flex:0 0 auto!important;color:#3797f0!important;font-size:9.5px!important;font-weight:750!important}.blogify-follow-status i{font-size:8px!important}.blogify-profile-action{position:absolute!important;right:11px!important;bottom:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;height:29px!important;padding:0 11px!important;border:0!important;border-radius:999px!important;background:linear-gradient(135deg,#3797f0,#6d5dfc)!important;color:#fff!important;text-decoration:none!important;font-size:10px!important;font-weight:800!important;box-shadow:0 5px 12px rgba(55,151,240,.24)!important;z-index:2!important}.blogify-profile-action:hover{filter:brightness(1.04)!important}.blogify-longpress{animation:blogifyHold .18s ease-out}@keyframes blogifyHold{from{transform:scale(.985)}to{transform:scale(1)}}.blogify-recording-pulse{animation:blogifyRecordPulse 1s ease-in-out infinite}@keyframes blogifyRecordPulse{50%{transform:scale(1.06)}}
@media(max-width:380px){.profile-card.blogify-shared-profile{width:min(330px,88vw)!important;min-height:80px!important;padding:11px 10px 11px 12px!important;gap:10px!important}.profile-card.blogify-shared-profile>img{flex-basis:52px!important;width:52px!important;height:52px!important}.profile-card.blogify-shared-profile .profile-card-body{padding-right:82px!important}.blogify-profile-action{right:9px!important;bottom:10px!important;height:27px!important;padding:0 9px!important}}
`;document.head.appendChild(s);
}

function profiles(root){
 (root||document).querySelectorAll('.profile-card:not([data-blogify-enhanced])').forEach(card=>{
  card.dataset.blogifyEnhanced='1';card.classList.add('blogify-shared-profile');
  const img=card.querySelector('img');
  if(img){img.loading='lazy';img.decoding='async';img.alt='Shared profile avatar';img.onerror=()=>{img.onerror=null;img.src=DEFAULT_AVATAR;};}
  const body=card.querySelector('.profile-card-body')||card;
  const username=card.dataset.username||card.getAttribute('data-username')||'';
  const following=card.dataset.following==='true'||card.getAttribute('data-following')==='true';
  const followedBy=card.dataset.followedBy==='true'||card.getAttribute('data-followed-by')==='true';
  const mutual=card.dataset.mutual==='true'||card.getAttribute('data-mutual')==='true';
  if(!body.querySelector('.blogify-profile-meta')){
   const meta=document.createElement('div');meta.className='blogify-profile-meta';
   if(username){const h=document.createElement('span');h.className='blogify-profile-username';h.textContent=username.startsWith('@')?username:'@'+username;meta.appendChild(h);}
   const st=document.createElement('span');st.className='blogify-follow-status';
   if(mutual||(following&&followedBy))st.innerHTML='<i class="fas fa-user-group"></i> Mutual';
   else if(following)st.innerHTML='<i class="fas fa-check"></i> Following';
   else if(followedBy)st.innerHTML='<i class="fas fa-user-plus"></i> Follows you';
   else st.innerHTML='<i class="fas fa-user"></i> Profile';
   meta.appendChild(st);body.appendChild(meta);
  }
  const href=normalizeProfileUrl(profileId(card));
  if(!href)return;
  card.dataset.profileUrl=href;card.setAttribute('role','link');card.setAttribute('tabindex','0');card.setAttribute('aria-label','View shared profile');
  let action=body.querySelector('.blogify-profile-action');
  if(!action){action=document.createElement('a');action.className='blogify-profile-action';action.innerHTML='<span>View profile</span><i class="fas fa-chevron-right"></i>';body.appendChild(action);}
  action.href=href;
  if(!card.dataset.profileNavigationBound){
    card.dataset.profileNavigationBound='1';
    card.addEventListener('click',e=>{
      const clickedAction=e.target.closest('.blogify-profile-action');
      const clickedOtherLink=e.target.closest('a,button');
      if(clickedAction||clickedOtherLink)return;
      e.preventDefault();e.stopPropagation();window.location.assign(href);
    });
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.location.assign(href)}});
  }
 });
}

function longPress(){
 document.querySelectorAll('.message-bubble[data-message-id]:not([data-blogify-hold])').forEach(b=>{
  b.dataset.blogifyHold='1';let timer=null,fired=false,x=0,y=0;
  const clear=()=>{if(timer)clearTimeout(timer);timer=null};
  b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;fired=false;x=e.clientX;y=e.clientY;clear();timer=setTimeout(()=>{timer=null;fired=true;b.classList.add('blogify-longpress');setTimeout(()=>b.classList.remove('blogify-longpress'),220);b.click();},HOLD_MS);},{passive:true});
  b.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-x,e.clientY-y)>12)clear()},{passive:true});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,clear,{passive:true}));
  b.addEventListener('click',e=>{if(!fired){e.preventDefault();e.stopImmediatePropagation()}fired=false},true);
 });
}

function voiceGuard(){
 const b=document.getElementById('voiceButton');if(!b||b.dataset.blogifyVoiceGuard)return;b.dataset.blogifyVoiceGuard='1';
 b.addEventListener('pointerdown',()=>b.classList.add('blogify-recording-pulse'),{passive:true});
 ['pointerup','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>b.classList.remove('blogify-recording-pulse'),{passive:true}));
}

function boot(){styles();profiles(document);longPress();voiceGuard();const o=new MutationObserver(()=>{profiles(document);longPress();voiceGuard()});o.observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
