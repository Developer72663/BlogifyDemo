(function(){
  'use strict';

  const HOLD_MS=1300;
  const MOVE_PX=12;
  const EDIT_MS=60*1000;
  let editingMessageId=null;
  const $=id=>document.getElementById(id);
  const toast=message=>{const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(el.__blogifyToastTimer);el.__blogifyToastTimer=setTimeout(()=>el.classList.remove('show'),2400)};
  const sameId=(a,b)=>String(a||'')===String(b||'');

  function styles(){
    if($('blogify-message-actions-style'))return;
    const s=document.createElement('style');
    s.id='blogify-message-actions-style';
    s.textContent=`
      .message-bubble.blogify-hold-active{animation:blogifyHoldPulse .18s ease-out;box-shadow:0 0 0 3px rgba(55,151,240,.24)!important}
      @keyframes blogifyHoldPulse{from{transform:scale(.985)}to{transform:scale(1)}}
      .message-bubble.blogify-media-tap{animation:blogifyMediaTap .22s ease-out}
      @keyframes blogifyMediaTap{0%{transform:scale(.985);filter:brightness(.92)}100%{transform:scale(1);filter:brightness(1)}}
      .blogify-media-viewer{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:22px;animation:blogifyViewerIn .18s ease-out}
      @keyframes blogifyViewerIn{from{opacity:0}to{opacity:1}}
      .blogify-media-viewer img,.blogify-media-viewer video{max-width:96vw;max-height:90vh;object-fit:contain;border-radius:14px;box-shadow:0 20px 70px rgba(0,0,0,.45)}
      .blogify-media-viewer button{position:absolute;top:14px;right:14px;width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:24px;cursor:pointer}
    `;
    document.head.appendChild(s);
  }

  function findSocket(){
    try{
      const managers=window.io&&window.io.managers;
      if(!managers)return null;
      for(const key of Object.keys(managers)){
        const socket=managers[key]?.nsps?.['/'];
        if(socket&&socket.connected)return socket;
      }
    }catch(_){ }
    return null;
  }

  function emit(event,payload){
    const socket=findSocket();
    if(!socket){toast('Chat connection is unavailable');return false;}
    socket.emit(event,payload);
    return true;
  }

  function showMedia(message){
    if(!message?.mediaUrl)return;
    document.querySelector('.blogify-media-viewer')?.remove();
    const viewer=document.createElement('div');
    viewer.className='blogify-media-viewer';
    const close=document.createElement('button');
    close.type='button';
    close.setAttribute('aria-label','Close media viewer');
    close.textContent='×';
    viewer.appendChild(close);
    const media=message.mediaType==='video'?document.createElement('video'):document.createElement('img');
    media.src=message.mediaUrl;
    media.alt=message.mediaType==='video'?'Video message':'Photo message';
    if(message.mediaType==='video'){media.controls=true;media.playsInline=true;media.autoplay=true;}
    viewer.appendChild(media);
    const done=()=>viewer.remove();
    close.addEventListener('click',done);
    viewer.addEventListener('click',e=>{if(e.target===viewer)done()});
    document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){done();document.removeEventListener('keydown',esc)}});
    document.body.appendChild(viewer);
  }

  function downloadMedia(url,filename){
    if(!/^https:\/\//i.test(String(url||'')))return toast('Media URL is unavailable');
    const a=document.createElement('a');
    a.href=url;a.download=filename;a.rel='noopener';a.target='_blank';
    document.body.appendChild(a);a.click();a.remove();toast('Download started');
  }

  function messageType(m){return m?.mediaType||'text';}
  function isMine(m){
    const row=m?._id?document.querySelector('[data-id="'+CSS.escape(String(m._id))+'"]'):null;
    if(row)return row.classList.contains('sent');
    return sameId(m?.senderId?._id||m?.senderId,window.__BLOGIFY_MY_ID||'');
  }
  function canEdit(m){return isMine(m)&&!m?.mediaType&&!m?.deleted&&Date.now()-new Date(m.createdAt).getTime()<EDIT_MS;}

  function ensureButton(id,label,icon,after){
    let b=$(id);if(b)return b;
    b=document.createElement('button');b.className='sheet-btn';b.id=id;b.type='button';
    b.innerHTML='<i class="'+icon+'" aria-hidden="true"></i><span>'+label+'</span>';
    if(after?.parentNode)after.parentNode.insertBefore(b,after);else $('actionSheet')?.appendChild(b);
    return b;
  }

  function setupSheet(){
    const sheet=$('actionSheet');if(!sheet||sheet.dataset.blogifyEnhanced)return;
    sheet.dataset.blogifyEnhanced='1';
    const reply=$('replyAction');
    const deleteForMe=ensureButton('deleteForMeAction','Delete for me','fas fa-trash-alt',$('unsendAction'));
    const save=ensureButton('saveAction','Save','fas fa-bookmark',$('closeSheet'));
    const view=ensureButton('viewMediaAction','View photo','fas fa-image',reply);
    const playVideo=ensureButton('playVideoAction','Play video','fas fa-play',reply);
    const playAudio=ensureButton('playAudioAction','Play','fas fa-play',reply);
    const download=ensureButton('downloadMediaAction','Download','fas fa-download',reply);
    const openProfile=ensureButton('openProfileAction','Open profile','fas fa-user',reply);
    const copyProfile=ensureButton('copyProfileAction','Copy profile link','fas fa-link',reply);
    const unsend=$('unsendAction');
    if(unsend)unsend.innerHTML='<i class="fas fa-trash" aria-hidden="true"></i><span>Unsend for everyone</span>';
    ['replyAction','copyAction','editAction','unsendAction','closeSheet','deleteForMeAction','saveAction'].forEach(id=>$(id)?.setAttribute('aria-label',$(id).textContent.trim()));

    const bind=(id,fn)=>{
      const b=$(id);if(!b||b.dataset.blogifyBound)return;b.dataset.blogifyBound='1';
      b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn()});
    };
    bind('deleteForMeAction',()=>{const m=window.__BLOGIFY_SELECTED_MESSAGE;if(m&&window.__BLOGIFY_CONVERSATION_ID&&emit('message:deleteForMe',{conversationId:window.__BLOGIFY_CONVERSATION_ID,messageId:m._id}))closeSheet()});
    bind('saveAction',()=>{const m=window.__BLOGIFY_SELECTED_MESSAGE;if(m&&window.__BLOGIFY_CONVERSATION_ID&&emit('message:save',{conversationId:window.__BLOGIFY_CONVERSATION_ID,messageId:m._id}))closeSheet()});
    bind('viewMediaAction',()=>{showMedia(window.__BLOGIFY_SELECTED_MESSAGE);closeSheet()});
    bind('playVideoAction',()=>{showMedia(window.__BLOGIFY_SELECTED_MESSAGE);closeSheet()});
    bind('playAudioAction',()=>{const m=window.__BLOGIFY_SELECTED_MESSAGE;const row=document.querySelector('[data-id="'+CSS.escape(String(m?._id||''))+'"]');const a=row?.querySelector('audio');if(a)a.paused?a.play().catch(()=>{}):a.pause();closeSheet()});
    bind('downloadMediaAction',()=>{const m=window.__BLOGIFY_SELECTED_MESSAGE;const type=messageType(m);const ext=type==='image'?'jpg':type==='video'?'mp4':'webm';downloadMedia(m?.mediaUrl,'blogify-'+type+'-'+String(m?._id||'message')+'.'+ext);closeSheet()});
    bind('openProfileAction',()=>{const m=window.__BLOGIFY_SELECTED_MESSAGE;const id=typeof m?.profileShareId==='object'?m.profileShareId?._id:m?.profileShareId;if(id)location.href='/profile/'+encodeURIComponent(id)});
    bind('copyProfileAction',async()=>{const m=window.__BLOGIFY_SELECTED_MESSAGE;const id=typeof m?.profileShareId==='object'?m.profileShareId?._id:m?.profileShareId;if(!id)return toast('Profile unavailable');try{await navigator.clipboard.writeText(location.origin+'/profile/'+id);toast('Profile link copied')}catch(_){toast('Unable to copy profile link')}closeSheet()});

    window.__BLOGIFY_CONFIGURE_MESSAGE_SHEET=m=>{
      window.__BLOGIFY_SELECTED_MESSAGE=m;
      const type=messageType(m),mine=isMine(m);
      if($('copyAction'))$('copyAction').style.display=m?.text?'flex':'none';
      if(reply)reply.style.display=m?.deleted?'none':'flex';
      if($('editAction'))$('editAction').style.display=canEdit(m)?'flex':'none';
      if(unsend)unsend.style.display=mine&&!m?.deleted?'flex':'none';
      if(deleteForMe)deleteForMe.style.display=m?.deleted?'none':'flex';
      if(save)save.style.display=m?.deleted?'none':'flex';
      view.style.display=type==='image'?'flex':'none';
      playVideo.style.display=type==='video'?'flex':'none';
      playAudio.style.display=type==='audio'?'flex':'none';
      download.style.display=['image','video','audio'].includes(type)?'flex':'none';
      openProfile.style.display=type==='profile'?'flex':'none';
      copyProfile.style.display=type==='profile'?'flex':'none';
      if(canEdit(m)){clearTimeout(m.__blogifyEditTimer);m.__blogifyEditTimer=setTimeout(()=>{if(window.__BLOGIFY_SELECTED_MESSAGE?._id===m._id&&$('editAction'))$('editAction').style.display='none'},Math.max(0,EDIT_MS-(Date.now()-new Date(m.createdAt).getTime()))+50)}
    };

    const edit=$('editAction');
    if(edit&&!edit.dataset.blogifyEnhancedEdit){
      edit.dataset.blogifyEnhancedEdit='1';
      edit.addEventListener('click',e=>{
        const m=window.__BLOGIFY_SELECTED_MESSAGE;e.preventDefault();e.stopImmediatePropagation();
        if(!canEdit(m))return toast('Edit is available for only 1 minute.');
        editingMessageId=String(m._id);$('messageInput').value=m.text||'';$('messageInput').focus();window.__BLOGIFY_RESIZE_INPUT?.();closeSheet();toast('Editing message — send to save changes');
      },true);
    }
  }

  function closeSheet(){$('overlay')?.classList.remove('open');$('actionSheet')?.classList.remove('open');window.__BLOGIFY_SELECTED_MESSAGE=null;}

  async function getMessageById(id){
    if(!id)throw Error('Message unavailable');
    let cid=window.__BLOGIFY_CONVERSATION_ID;
    if(!cid){
      const user=new URLSearchParams(location.search).get('user');
      const c=await fetch('/messages/conversation',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({userId:user})});
      const cd=await c.json();if(!c.ok||!cd.success)throw Error(cd.message||'Unable to load conversation');cid=String(cd.conversationId);window.__BLOGIFY_CONVERSATION_ID=cid;
    }
    const r=await fetch('/messages/'+encodeURIComponent(cid)+'?limit=100',{credentials:'same-origin'});const d=await r.json();if(!r.ok||!d.success)throw Error(d.message||'Unable to load message');
    const m=(d.messages||[]).find(x=>sameId(x._id,id));if(!m)throw Error('Message is no longer available');return m;
  }

  function configureOpenSheet(m){window.__BLOGIFY_SELECTED_MESSAGE=m;setupSheet();window.__BLOGIFY_CONFIGURE_MESSAGE_SHEET?.(m)}
  function openSheetFromBubble(b){b.dataset.blogifyForceOpen='1';b.click();getMessageById(b.dataset.messageId).then(configureOpenSheet).catch(e=>toast(e.message))}

  function installEditSubmit(){
    const form=$('composer'),input=$('messageInput');if(!form||form.dataset.blogifyEditSubmit)return;form.dataset.blogifyEditSubmit='1';
    form.addEventListener('submit',e=>{if(!editingMessageId)return;e.preventDefault();e.stopImmediatePropagation();const text=input.value.trim();if(!text)return toast('Enter a message');if(!window.__BLOGIFY_CONVERSATION_ID){toast('Chat connection is unavailable');return;}if(emit('message:edit',{conversationId:window.__BLOGIFY_CONVERSATION_ID,messageId:editingMessageId,text})){editingMessageId=null;input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));toast('Message updated')}},true);
    window.__BLOGIFY_RESIZE_INPUT=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,110)+'px'};
  }

  function attachInteractions(){
    const area=$('messagesArea');if(!area)return;
    area.querySelectorAll('.message-bubble[data-message-id]').forEach(b=>{
      if(b.dataset.blogifyInteraction)return;b.dataset.blogifyInteraction='1';let timer=null,x=0,y=0,longPressed=false;
      const cancel=()=>{if(timer)clearTimeout(timer);timer=null};
      b.addEventListener('contextmenu',e=>e.preventDefault(),true);
      b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;x=e.clientX;y=e.clientY;longPressed=false;cancel();timer=setTimeout(()=>{timer=null;longPressed=true;b.classList.add('blogify-hold-active');navigator.vibrate?.(12);openSheetFromBubble(b);setTimeout(()=>b.classList.remove('blogify-hold-active'),260)},HOLD_MS)},{passive:true});
      b.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-x,e.clientY-y)>MOVE_PX)cancel()},{passive:true});
      ['pointerup','pointercancel','pointerleave'].forEach(t=>b.addEventListener(t,cancel,{passive:true}));
      b.addEventListener('click',e=>{
        if(b.dataset.blogifyForceOpen==='1'){b.dataset.blogifyForceOpen='';return}
        if(e.target.closest('audio,video')){cancel();e.stopImmediatePropagation();return}
        const img=e.target.closest('img.message-media');
        if(img){if(longPressed){longPressed=false;e.preventDefault();e.stopImmediatePropagation();return}e.stopImmediatePropagation();b.classList.add('blogify-media-tap');getMessageById(b.dataset.messageId).then(showMedia).catch(err=>toast(err.message));setTimeout(()=>b.classList.remove('blogify-media-tap'),250);return}
        if(longPressed){e.preventDefault();e.stopImmediatePropagation();longPressed=false;return}
        getMessageById(b.dataset.messageId).then(configureOpenSheet).catch(()=>{});
      },true);
    });
  }

  function removeMessageRow(messageId){
    const id=String(messageId||'');
    if(!id)return false;
    let removed=false;
    document.querySelectorAll('.message-row[data-id]').forEach(row=>{if(String(row.dataset.id)===id){row.remove();removed=true}});
    document.querySelectorAll('.message-bubble[data-message-id]').forEach(b=>{if(String(b.dataset.messageId)===id){b.closest('.message-row')?.remove();removed=true}});
    if(window.__BLOGIFY_SELECTED_MESSAGE&&sameId(window.__BLOGIFY_SELECTED_MESSAGE._id,id))closeSheet();
    return removed;
  }

  function applyEditedMessage(m){
    if(!m?._id)return;
    const row=document.querySelector('.message-row[data-id="'+CSS.escape(String(m._id))+'"]');
    if(!row)return;
    const bubble=row.querySelector('.message-bubble');
    if(!bubble)return;
    bubble.classList.remove('deleted');
    bubble.innerHTML='';
    bubble.textContent=m.text||'';
    const meta=row.querySelector('.message-meta');
    if(meta){
      const time=meta.querySelector('span:first-child');
      if(time)time.textContent=new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      let edited=meta.querySelector('.edited');
      if(!edited){edited=document.createElement('span');edited.className='edited';meta.insertBefore(edited,meta.querySelector('.read-status')||null)}
      edited.textContent='· edited';
    }
  }

  function installRealtime(){
    const managers=window.io?.managers;if(!managers||window.__BLOGIFY_MESSAGE_ACTION_EVENTS)return;window.__BLOGIFY_MESSAGE_ACTION_EVENTS=true;
    for(const key of Object.keys(managers)){
      const s=managers[key]?.nsps?.['/'];if(!s)continue;
      s.on('message:deletedForMe',d=>removeMessageRow(d?.messageId));
      s.on('message:edited',m=>applyEditedMessage(m));
      s.on('message:unsent',d=>removeMessageRow(d?.messageId));
      s.on('message:saved',d=>toast(d?.saved?'Message saved':'Removed from saved messages'));
      s.on('message:action:error',d=>toast(d?.message||'Action failed'));
    }
  }

  function exposeConversation(){
    if(window.__BLOGIFY_FETCH_WRAPPED)return;window.__BLOGIFY_FETCH_WRAPPED=true;const original=window.fetch;
    window.fetch=function(input,init){return original.apply(this,arguments).then(response=>{try{const url=typeof input==='string'?input:input?.url||'';if(url.includes('/messages/conversation')&&response.ok)response.clone().json().then(d=>{if(d?.conversationId)window.__BLOGIFY_CONVERSATION_ID=String(d.conversationId)}).catch(()=>{})}catch(_){ }return response})};
  }

  function dedupe(){const area=$('messagesArea');if(!area)return;const seen=new Set();area.querySelectorAll('.message-row[data-id]').forEach(r=>{const id=String(r.dataset.id||'');if(id){if(seen.has(id))r.remove();else seen.add(id)}})}

  function boot(){
    styles();setupSheet();installEditSubmit();exposeConversation();attachInteractions();installRealtime();dedupe();
    const area=$('messagesArea');if(area&&!area.__blogifyObserver){area.__blogifyObserver=true;new MutationObserver(()=>{setupSheet();attachInteractions();dedupe()}).observe(area,{childList:true,subtree:true})}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();