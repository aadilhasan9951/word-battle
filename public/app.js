(() => {
  'use strict';
  let you='',code='',room=null,version=-1,deadline=0,timer=null,submitted=false,roundKey='',toastTimer=null;
  const $=id=>document.getElementById(id);
  const show=id=>$(id).hidden=false, hide=id=>$(id).hidden=true;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function err(msg){
    const t=$('toast');
    if(!msg){t.hidden=true;t.textContent='';clearTimeout(toastTimer);return}
    t.textContent=msg;t.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{t.hidden=true},5000);
  }

  async function api(path,data={}){
    const r=await fetch('/api/'+path,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({code,playerId:you,...data})
    });
    const d=await r.json().catch(()=>({error:'Invalid server response.'}));
    if(!r.ok && !d.error) d.error=`Request failed (${r.status})`;
    return d;
  }

  $('showJoin').addEventListener('click',()=>{err('');show('joinBox');$('code').focus()});

  $('create').addEventListener('click', async (e)=>{
    e.preventDefault();
    err('');
    const btn=$('create');
    const name=$('name').value.trim()||'Player';
    btn.disabled=true;
    btn.textContent='Creating…';
    try{
      const r=await api('create',{name});
      if(r.ok){
        you=r.you; code=r.room.code; room=r.room; version=r.room.version??0;
        showLobby();
      }else err(r.error||'Could not create the game.');
    }catch(ex){
      console.error('Create Game failed:',ex);
      err('Could not connect to the game server. Make sure node server.js is running.');
    }finally{
      btn.disabled=false;
      btn.textContent='Create Game';
    }
  });

  $('join').addEventListener('click',async()=>{
    err('');
    code=$('code').value.trim().toUpperCase();
    if(code.length!==4){err('Enter the 4-character room code.');return}
    const name=$('name').value.trim()||'Player';
    const btn=$('join'); btn.disabled=true; btn.textContent='Joining…';
    try{
      const r=await api('join',{name});
      if(r.ok){you=r.you;room=r.room;version=r.room.version??0;showLobby()}else err(r.error||'Could not join the room.');
    }catch(ex){console.error('Join failed:',ex);err('Could not connect to the game server.')}finally{btn.disabled=false;btn.textContent='Join Room'}
  });

  $('rounds').addEventListener('change',async()=>{
    const r=await api('setRounds',{rounds:+$('rounds').value});
    if(!r.ok) err(r.error||'Could not change rounds.');
    await refreshState();
  });

  $('start').addEventListener('click',async()=>{
    err('');
    if(!room)return;
    if(room.players.length<2){err('Need at least 2 players to start.');return}
    const btn=$('start');btn.disabled=true;btn.textContent='Starting…';
    try{
      const r=await api('start');
      if(!r.ok) err(r.error||'Could not start the game.');
      await refreshState();
    }catch(ex){console.error('Start failed:',ex);err('Could not connect to the game server.')}
    finally{btn.textContent='Start Game';if(room)renderRoom()}
  });

  $('submit').addEventListener('click',()=>submit(false));
  $('risk').addEventListener('click',()=>submit(true));
  $('answer').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit(false)}});
  $('gridBox').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitGrid()}});

  function showLobby(){hide('home');hide('game');hide('over');show('lobby');roundKey='';renderRoom()}
  function renderRoom(){
    if(!room)return;
    $('roomCode').textContent=room.code;
    $('rounds').value=room.rounds;
    $('rounds').disabled=room.hostId!==you;
    $('start').hidden=room.hostId!==you;
    const waiting=room.players.length<2;
    $('start').disabled=waiting;
    $('waiting').hidden=!waiting;
    $('players').innerHTML=room.players.map(p=>`<div class="player ${p.connected?'':'offline'}"><span>${esc(p.name)} ${p.host?' <span class="host">★ Host</span>':''}</span><b>${p.score}</b></div>`).join('');
  }

  async function refreshState(){
    if(!code)return;
    try{
      const r=await fetch('/api/state?code='+encodeURIComponent(code)+'&playerId='+encodeURIComponent(you),{cache:'no-store'});
      const d=await r.json();
      if(d.ok){room=d.room;version=d.version;renderState()}
      else{code='';room=null;err('Room not found. It may have expired.');show('home');hide('lobby');hide('game');hide('over')}
    }catch(ex){console.error('State refresh failed:',ex)}
  }
  async function poll(){
    if(code){
      try{
        const r=await fetch('/api/state?code='+encodeURIComponent(code)+'&playerId='+encodeURIComponent(you),{cache:'no-store'});
        const d=await r.json();
        if(d.ok&&d.version!==version){version=d.version;room=d.room;renderState()}
        else if(!d.ok&&room){code='';room=null;err('Room not found. It may have expired.');show('home');hide('lobby');hide('game');hide('over')}
      }catch(ex){/* retry */}
    }
    setTimeout(poll,350);
  }

  function renderState(){
    if(!room)return;
    if(room.phase==='lobby'){showLobby();return}
    if(room.phase==='playing'||room.phase==='sudden'){showGame();renderRound();return}
    if(room.phase==='results'){showGame();renderResults();return}
    if(room.phase==='finished'){showOver()}
  }
  function showGame(){hide('home');hide('lobby');hide('over');show('game')}
  function renderRound(){
    const kind=room.phase==='sudden'?'Sudden Death':({normal:'Speed Battle',grid:'Grid Round',risk:'Risk Round',lastChance:'Last Chance'}[room.kind]||room.kind);
    $('progress').textContent=room.phase==='sudden'?'Sudden Death':`Round ${room.round} / ${room.rounds}`;
    $('score').textContent='Score: '+(room.players.find(p=>p.id===you)?.score||0);
    $('kind').textContent=kind;$('prompt').textContent=room.category+' — '+room.letter;
    const key=room.phase+':'+room.round+':'+room.kind+':'+room.category+':'+room.letter+':'+room.endsAt;
    const fresh=key!==roundKey;
    if(fresh){
      roundKey=key;submitted=false;
      $('answer').value='';
      $('submit').disabled=false;
      $('risk').disabled=false;
      show('answerBox');hide('gridBox');hide('results');
      $('risk').hidden=!(room.kind==='risk'&&room.phase==='playing');
      if(room.kind==='grid'&&room.phase==='playing'){
        hide('answerBox');show('gridBox');
        $('gridBox').innerHTML=['Animals','Food','Countries'].map(c=>`<div class="gridrow"><label>${c}</label><input autocomplete="off" data-cat="${c}"></div>`).join('');
      }
      tick();
    }else{
      if(submitted){$('submit').disabled=true;$('risk').disabled=true}
    }
    deadline=room.endsAt;
    $('score').textContent='Score: '+(room.players.find(p=>p.id===you)?.score||0);
  }
  function tick(){
    clearInterval(timer);
    const update=()=>{
      if(!room||(room.phase!=='playing'&&room.phase!=='sudden')){clearInterval(timer);return}
      const s=Math.max(0,Math.ceil((deadline-Date.now())/1000));
      $('timer').textContent=s+'s';
      if(s===0){clearInterval(timer);if(room.kind==='grid'&&room.phase==='playing')submitGrid()}
    };
    update();timer=setInterval(update,100);
  }
  async function submit(risk){
    if(submitted)return;
    submitted=true;$('submit').disabled=true;$('risk').disabled=true;
    try{
      const r=await api('answer',{answer:$('answer').value,risk});
      if(!r.ok){submitted=false;$('submit').disabled=false;err(r.error||'Could not submit answer.')}
      else err('Answer submitted!');
    }catch(ex){console.error(ex);submitted=false;$('submit').disabled=false;err('Could not submit answer.')}
  }
  async function submitGrid(){
    try{
      for(const el of document.querySelectorAll('#gridBox input'))await api('grid',{category:el.dataset.cat,answer:el.value});
    }catch(ex){console.error(ex)}
  }
  function renderResults(){
    clearInterval(timer);hide('answerBox');hide('gridBox');show('results');
    $('score').textContent='Score: '+(room.players.find(p=>p.id===you)?.score||0);
    const me=room.players.find(p=>p.id===you);
    const list=room.players.map(p=>`<div class="scoreline"><span>${esc(p.name)}: ${p.answer?esc(p.answer):'—'} ${p.valid?'✓':'✕'}${p.challenged?' ⚠':''}</span><span>${p.score} ${p.id!==you&&p.answer&&me&&!me.challenged?`<button class="challenge" data-target="${esc(p.id)}">Challenge</button>`:''}</span></div>`).join('');
    $('results').innerHTML='<h3>Round complete</h3>'+list+'<p>Next round…</p>';
    $('results').querySelectorAll('.challenge').forEach(b=>b.addEventListener('click',()=>challenge(b.dataset.target)));
  }
  async function challenge(id){
    try{
      const r=await api('challenge',{targetId:id});
      if(!r.ok)err(r.error||'Could not challenge.');
      await refreshState();
    }catch(ex){console.error(ex);err('Could not challenge.')}
  }
  function showOver(){hide('game');hide('lobby');show('over');roundKey='';const w=room.players.find(p=>p.id===room.winner);$('winner').textContent=w?esc(w.name)+' wins!':'Game over';$('final').innerHTML=[...room.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="scoreline"><span>${esc(p.name)}</span><b>${p.score}</b></div>`).join('')}

  poll();
})();
