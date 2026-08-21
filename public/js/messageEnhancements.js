(function(){
'use strict';
const DEFAULT_AVATAR='/imgs/default.png';
const HOLD_MS=1000;
const profileUrl=id=>id?'/profile/'+encodeURIComponent(String(id)):'';

function profileId(card){
  return card.getAttribute('data-profile-id')||
    card.getAttribute('data-user-id')||
    card.getAttribute('data-profile-share-id')||
    card.dataset.profileShareId||
    card.querySelector('a[href]')?.getAttribute('href')||'';
}

function normalizeProfileUrl(value){
  if(!value)return '';
  const raw=String(value).trim();
  if(raw.startsWith('/'))return raw;
  if(/^https?:\\/\\//i.test(raw))return raw;
  return profileUrl(raw);
}

function styles(){
 if(document.getElementById('blogify-message-enhancement-style'))return;
 const s=document.createElement('style');s.id='blogify-message-enhancement-style';s.textContent=`
.profile-card.blogify-shared-profile{position:relative!important;display:grid!important;grid-template-columns:56px minmax(0,1fr)!important;gap:12px!important;align-items:center!important;width:min(350px,84vw)!important;min-height:82px!important;padding:12px 12px 12px 13px!important;margin:4px 0!important;border:1px solid rgba(120,130,150,.22)!important;border-radius:18px!important;overflow:hidden!important;background:var(--surface,#fff)!important;box-shadow:0 5px 18px rgba(0,0,0,.08)!important;cursor:pointer!important;transition:.16s ease!important}.profile-card.blogify-shared-profile:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(180deg,#3797f0,#8b5cf6)}.profile-card.blogify-shared-profile:active{transform:scale(.985)!important}.profile-card.blogify-shared-profile>img{grid-column:1!important;width:56px!important;height:56px!important;border-radius:50%!important;object-fit:cover!important;background:var(--input,#f1f3f5)!important;border:2px solid var(--surface,#fff)!important;box-shadow:0 0 0 1.5px rgba(55,151,240,.35)!important}.profile-card.blogify-shared-profile .profile-card-body{grid-column:2!important;min-width:0!important;padding:0 88px 0 0!important}.profile-card.blogify-shared-profile .profile-card-name{display:block!important;margin:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:var(--text,#111)!important;font-size:14px!important;line-height:1.2!important;font-weight:750!important}.profile-card.blogify-shared-profile .profile-card-bio{margin:3px 0 0!important;color:var(--muted,#737b87)!important;font-size:10.5px!important;line-height:1.25!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}.blogify-profile-meta{display:flex!important;gap:7px!important;align-items:center!important;margin-top:5px!important;white-space:nowrap!important;overflow:hidden!important}.blogify-profile-username{overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#737b87)!important;font-size:10px!important;max-width:105px!important}.blogify-follow-status{display:inline-flex!important;gap:4px!important;align-items:center!important;color:#3797f0!important;font-size:9.5px!important;font-weight:700!important}.blogify-follow-status i{font-size:8px!important}.blogify-profile-action{position:absolute!important;right:11px!important;bottom:11px!important;display:inline-flex!important;align-items:center!important;gap:5px!important;height:27px!important;padding:0 10px!important;border:1px solid rgba(55,151,240,.22)!important;border-radius:999px!important;background:rgba(55,151,240,.08)!important;color:#3797f0!important;text-decoration:none!important;font-size:10px!important;font-weight:750!important}.blogify-profile-action:hover{background:rgba(55,151,240,.15)!important}.blogify-longpress{animation:blogifyHold .18s ease-out}@keyframes blogifyHold{from{transform:scale(.985)}to{transform:scale(1)}}.blogify-recording-pulse{animation:blogifyRecordPulse 1s ease-in-out infinite}@keyframes blogifyRecordPulse{50%{transform:scale(1.06)}}
@media(max-width:380px){.profile-card.blogify-shared-profile{width:min(320px,87vw)!important;grid-template-columns:50px minmax(0,1fr)!important}.profile-card.blogify-shared-profile>img{width:50px!important;height:50px!important}.profile-card.blogify-shared-profile .profile-card-body{padding-right:76px!important}}
`;document.head.appendChild(s);
}

function profiles(root){
 (root||document).querySelectorAll('.profile-card:not([data-blogify-enhanced])').forEach(card=>{
  card.dataset.blogifyEnhanced='1';card.classList.add('blogify-shared-profile');
  const img=card.querySelector('img');if(img){img.loading='lazy';img.decoding='async';img.alt='Shared profile avatar';img.onerror=()=>img.src=DEFAULT_AVATAR;}
  const body=card.querySelector('.profile-card-body')||card;
  const username=card.dataset.username||card.getAttribute('data-username')||'';
  const following=card.dataset.following==='true'||card.getAttribute('data-following')==='true';
  const followedBy=card.dataset.followedBy==='true'||card.getAttribute('data-followed-by')==='true';
  const mutual=card.dataset.mutual==='true'||card.getAttribute('data-mutual')==='true';
  if(!body.querySelector('.blogify-profile-meta')){
   const meta=document.createElement('div');meta.className='blogify-profile-meta';
   if(username){const h=document.createElement('span');h.className='blogify-profile-username';h.textContent=username.startsWith('@')?username:'@'+username;meta.appendChild(h);}
   const st=document.createElement('span');st.className='blogify-follow-status';st.innerHTML=mutual||(following&&followedBy)?'<i class="fas fa-user-group"></i> Mutual':following?'<i class="fas fa-check"></i> Following':followedBy?'<i class="fas fa-user-plus"></i> Follows you':'<i class="fas fa-user"></i> Profile';meta.appendChild(st);body.appendChild(meta);
  }
  const rawId=profileId(card);
  const href=normalizeProfileUrl(rawId);
  if(!href)return;
  card.dataset.profileUrl=href;card.setAttribute('role','link');card.setAttribute('tabindex','0');
  if(!body.querySelector('.blogify-profile-action')){const a=document.createElement('a');a.className='blogify-profile-action';a.href=href;a.innerHTML='<span>View profile</span><i class="fas fa-chevron-right"></i>';body.appendChild(a);}
  if(!card.dataset.profileNavigationBound){
    card.dataset.profileNavigationBound='1';
    card.addEventListener('click',e=>{if(e.target.closest('a,button'))return;window.location.assign(href)});
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.location.assign(href)}});
  }
 });
}

function longPress(){
 document.querySelectorAll('.message-bubble[data-message-id]:not([data-blogify-hold])').forEach(b=>{
  b.dataset.blogifyHold='1';let timer=null,fired=false,x=0,y=0;
  const clear=()=>{if(timer)clearTimeout(timer);timer=null};
  b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;fired=false;x=e.clientX;y=e.clientY;clear();timer=setTimeout(()=>{timer=null;fired=true;b.classList.add('blogify-longpress');setTimeout(()=>b.classList.remove('blogify-longpress'),220);b.click()},HOLD_MS);},{passive:true});
  b.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-x,e.clientY-y)>12)clear()},{passive:true});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,clear,{passive:true}));
  b.addEventListener('click',e=>{if(!fired){e.preventDefault();e.stopImmediatePropagation()}fired=false},true);
 });
}

function voiceGuard(){
 const b=document.getElementById('voiceButton');if(!b||b.dataset.blogifyVoiceGuard)return;b.dataset.blogifyVoiceGuard='1';
 ['pointerdown'].forEach(ev=>b.addEventListener(ev,()=>b.classList.add('blogify-recording-pulse'),{passive:true}));
 ['pointerup','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>b.classList.remove('blogify-recording-pulse'),{passive:true}));
}

function boot(){styles();profiles(document);longPress();voiceGuard();const o=new MutationObserver(()=>{profiles(document);longPress();voiceGuard()});o.observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();