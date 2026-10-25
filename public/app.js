const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  crew:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
  radio:'<path d="M5 8a10 10 0 0 0 0 8M2 5a15 15 0 0 0 0 14M19 8a10 10 0 0 1 0 8M22 5a15 15 0 0 1 0 14"/><circle cx="12" cy="12" r="3"/>',
  arrow:'<path d="M4 12h16M14 6l6 6-6 6"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  key:'<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  eye:'<path d="M2 12S6 5 12 5s10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  blueprint:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3v2m-1 3h.01"/>',
  volume:'<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
  mute:'<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="m8 4 12 8-12 8V4Z"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  terminal:'<path d="m4 6 5 6-5 6m8 0h8"/>',
  link:'<path d="m10 14 4-4m-6 5-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 1 2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0"/>',
  reset:'<path d="M3 10a9 9 0 1 1 0 5M3 4v6h6"/>',
  broadcast:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-5-10h3l2-4 2 6 2-3h2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const roleInfo = {cipher:{name:'Cipher',detail:'Codes & intercepted signals',icon:'key'},architect:{name:'Architect',detail:'Blueprints & hidden routes',icon:'blueprint'},lookout:{name:'Lookout',detail:'Eyes on the inside',icon:'eye'}};
const initialState = {
  roomId:null,phase:'briefing',stageIndex:0,stageCount:3,paused:false,
  stage:{id:'lock',title:'The outer lock',kicker:'01 / BREACH',kind:'keypad',digits:4,description:'A four-digit cipher guards the vault. Your crew intercepted different pieces of its key.',instruction:'Combine the symbol order with both intercepted digit mappings. Enter all four digits.',options:[]},
  clock:{durationSeconds:480,remainingSeconds:480,endsAt:null},alarm:{value:0,max:3},
  crew:{total:0,roles:Object.entries(roleInfo).map(([id,r])=>({id,name:r.name,count:0}))},members:[],comms:[],events:[],votes:[],result:null,
};
let state = structuredClone(initialState), roomId = null, view = 'host', tab = 'mission', token = '', isHost = false, playerRole = '', subscription = null;
let selectedAnswer = '', codeAnswer = '', chatDraft = '', joinName = '', joinRole = '', twitchStatus = null, soundOn = false, audioContext = null, lastSignature = '', busy = false, connection = 'local', toastTimeout;
let lastStage = '', lastPhase = '', frame = 0;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=>$('#toast').classList.remove('show'),4200);
}
async function api(path, {method='GET',body,auth=token} = {}) {
  const response = await fetch(path,{method,headers:{...(body ? {'Content-Type':'application/json'}:{}),...(auth ? {Authorization:`Bearer ${auth}`}:{})},body:body ? JSON.stringify(body):undefined});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'The mission link could not be reached.'); error.status = response.status; throw error; }
  return data;
}
function storeGet(key, storage=localStorage){ try{return storage.getItem(key)||'';}catch{return '';} }
function storeSet(key,value,storage=localStorage){ try{storage.setItem(key,value);}catch{/* Memory-only sessions remain usable. */} }
function formatTime(seconds) {const n=Math.max(0,Math.ceil(seconds));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function remaining(){return state.clock.endsAt && state.phase==='active' && !state.paused ? Math.max(0,(state.clock.endsAt-Date.now())/1000):state.clock.remainingSeconds;}
function updateTimers(){document.querySelectorAll('[data-clock]').forEach(el=>{el.textContent=formatTime(remaining());el.classList.toggle('danger',remaining()<60&&state.phase==='active');});}
function statusLabel(){if(state.phase==='escaped')return 'EXTRACTION COMPLETE';if(state.phase==='caught')return 'MISSION COMPROMISED';if(state.paused)return 'MISSION PAUSED';if(state.phase==='active')return 'MISSION IN PROGRESS';return 'AWAITING YOUR SIGNAL';}
function setState(next) {
  const previous=state;
  state=next;
  if(lastStage!==state.stage.id){selectedAnswer='';codeAnswer='';lastStage=state.stage.id;}
  if(lastPhase!==state.phase){lastPhase=state.phase; if(previous.phase==='active'&&state.phase==='escaped')beep('win');else if(state.phase==='caught')beep('lose');}
  if(previous.alarm.value<state.alarm.value)beep('alarm');
  if(previous.stageIndex<state.stageIndex)beep('stage');
  const {clock,...rest}=state;
  const signature=JSON.stringify(rest)+`${clock.endsAt!==null}`;
  if(signature!==lastSignature){lastSignature=signature;render();}
  updateTimers();
}
function subscribe(){
  subscription?.close();
  subscription=new EventSource(`/api/rooms/${roomId}/events${token?`?token=${encodeURIComponent(token)}`:''}`);
  subscription.onmessage=event=>{connection='connected';try{setState(JSON.parse(event.data));}catch{toast('An update could not be read. Reconnecting…');}};
  subscription.onerror=()=>{connection='reconnecting'; const el=$('[data-connection]');if(el)el.textContent='Reconnecting…';};
  subscription.onopen=()=>{connection='connected';const el=$('[data-connection]');if(el)el.textContent='Mission link connected';};
}
async function createMission(start=false){
  if(roomId)return;
  const data=await api('/api/rooms',{method:'POST',body:{durationSeconds:480},auth:''});
  roomId=data.roomId;token=data.hostToken;isHost=true;
  storeSet(`heist:host:${roomId}`,token,sessionStorage);
  history.pushState({},'',`/play/${roomId}`);
  setState(data.state);subscribe();
  if(start)await hostAction('start');
}
async function hostAction(action,answer){
  if(!roomId)await createMission(false);
  if(!isHost)throw new Error('This control belongs to the mission operator. Join the crew to help.');
  const next=await api(`/api/rooms/${roomId}/action`,{method:'POST',body:{action,...(answer!==undefined?{answer}:{})}});
  setState(next);
}
function brand(){return `<a class="brand" href="/" aria-label="HEIST home"><div class="brand-mark">H</div><div><div class="brand-word">HEIST</div><div class="brand-sub">TRUST YOUR CREW.</div></div></a>`;}
function objectives(){return `<div class="objectives">${['Breach the vault','Silence the alarm','Make your escape'].map((title,i)=>{const done=state.phase==='escaped'||i<state.stageIndex;const current=i===state.stageIndex&&state.phase!=='escaped';return `<div class="objective ${done?'done':current?'current':'locked'}"><span class="step-number">${done?icon('check'):String(i+1).padStart(2,'0')}</span><div><strong>${title}</strong><small>${done?'COMPLETE':current?(state.phase==='briefing'?'FIRST OBJECTIVE':'CURRENT OBJECTIVE'):'LOCKED'}</small></div></div>`;}).join('')}</div>`;}
function shell(){
  const live=twitchStatus?.connected;
  return `<div class="shell"><aside class="sidebar">${brand()}<div class="workspace-label">OPERATION CENTER</div><nav aria-label="Mission navigation">
    <button class="nav-button ${tab==='mission'?'active':''}" data-action="tab" data-tab="mission" aria-label="Mission control">${icon('grid')}<span>Mission control</span><span class="mini">01</span></button>
    <button class="nav-button ${tab==='intelligence'?'active':''}" data-action="tab" data-tab="intelligence" aria-label="Crew intelligence">${icon('crew')}<span>Crew intelligence</span></button>
    <button class="nav-button ${tab==='broadcast'?'active':''}" data-action="tab" data-tab="broadcast" aria-label="Broadcast setup">${icon('broadcast')}<span>Broadcast setup</span></button>
    </nav><div class="sidebar-mission"><div class="eyebrow">CURRENT OPERATION</div><strong>The Meridian job</strong><p>One vault. One crew. One shot.</p><div class="mission-id"><span>OP–001</span><span>LVL 03</span></div></div>
    <div class="sidebar-bottom"><div class="connection-card"><span class="dot ${live?'':'off'}"></span>${live?'Twitch connected':'Local rehearsal'}<small>${live?escape(twitchStatus.channel):'Live connection optional'}</small></div><div class="operator"><div class="avatar">${icon('terminal')}</div><div><strong>${roomId&&!isHost?'Observer':'You, the operator'}</strong><span>${roomId&&!isHost?'PUBLIC FEED':'FIELD ACCESS / 01'}</span></div>${icon('chevron')}</div></div></aside>
    <main class="main"><header class="topbar"><div class="breadcrumb"><span class="mobile-brand">HEIST</span>${icon('shield')}<span>Operations</span>${icon('chevron')}<strong>The Meridian job</strong></div><div class="top-actions"><span class="status-pill"><span class="dot ${state.phase==='active'?'':'off'}"></span>${state.phase==='active'?'OPERATION LIVE':'PRIVATE CHANNEL'}</span><button class="icon-button" data-action="sound" aria-label="${soundOn?'Mute':'Enable'} mission audio" title="${soundOn?'Mute':'Enable'} mission audio">${icon(soundOn?'volume':'mute')}</button><button class="icon-button" data-action="help" aria-label="How to play" title="How to play">${icon('help')}</button></div></header>
    <nav class="mobile-tabs" aria-label="Mobile mission navigation"><button data-action="tab" data-tab="mission">${icon('grid')} Mission</button><button data-action="tab" data-tab="intelligence">${icon('crew')} Crew</button><button data-action="tab" data-tab="broadcast">${icon('broadcast')} Broadcast</button></nav><div class="content"><div class="mission-heading"><div><div class="eyebrow"><span class="orange">OPERATION 001</span> &nbsp;/&nbsp; MERIDIAN RESERVE</div><h1>The Meridian job<span class="orange">.</span></h1><p>You have the hands. Chat has the blueprints.</p></div><div class="countdown">${state.phase==='active'&&isHost?`<button class="icon-button" data-action="pause" aria-label="${state.paused?'Resume':'Pause'} mission" title="${state.paused?'Resume':'Pause'} mission">${icon(state.paused?'play':'pause')}</button>`:''}<div class="timer-box"><div class="eyebrow">${state.phase==='briefing'?'EXTRACTION WINDOW':state.paused?'CLOCK PAUSED':'TIME TO LOCKDOWN'}</div><div class="timer" data-clock>${formatTime(remaining())}</div><div class="timer-caption">${state.phase==='briefing'?'THE CLOCK STARTS WITH YOU':statusLabel()}</div><div class="alarm-dots" aria-label="${state.alarm.value} of 3 security strikes">${Array.from({length:3},(_,i)=>`<span class="alarm-dot ${i<state.alarm.value?'on':''}"></span>`).join('')}</div></div></div></div>
    ${tab==='mission'?missionView():tab==='intelligence'?intelligenceView():broadcastView()}
    <footer class="footer"><span>HEIST / COOPERATIVE BY DESIGN</span><span>${iconSmallDot()} <span data-connection>${roomId?'Mission link connected':'READY WHEN YOU ARE'}</span> &nbsp; · &nbsp; BUILT WITH CODEX</span></footer></div></main></div>`;
}
function iconSmallDot(){return '<span class="dot" style="height:4px;width:4px;margin-right:4px"></span>';}
function missionView(){return `<div class="mission-grid"><div class="left-stack">${sceneCard()}${objectives()}<section class="puzzle"><div class="section-heading"><h2>${icon('terminal')} ${state.phase==='briefing'?'Your mission briefing':state.result?'Mission debrief':'Operator terminal'}</h2><small>${state.result?'OPERATION CLOSED':state.paused?'ON HOLD':state.stage.kicker}</small></div>${puzzlePanel()}</section>${activityView()}</div><div><aside class="right-stack">${crewPanel()}${commsPanel()}</aside><div class="crew-tools">${icon('radio')}<div><strong>Your crew is your only way in.</strong><p>Each specialist has a piece of the puzzle. Talk to each other. Trust the signal.</p><button class="text-button" data-action="demo">Try with a demo crew ${'↗'}</button></div></div></div></div>`;}
function sceneCard(){return `<div class="scene-card"><div class="scene-head"><span>${iconSmallDot()} ${state.stageIndex===0?'VAULT ANTECHAMBER':state.stageIndex===1?'SECURITY RELAY':'EXTRACTION CORRIDOR'}</span><span class="feed-status">CAM ${String(state.stageIndex+4).padStart(2,'0')} &nbsp; / &nbsp; ${state.phase==='caught'?'SIGNAL LOST':'ENCRYPTED FEED'}</span></div><div class="scene"><canvas id="vault-canvas" aria-label="Animated view of ${state.stageIndex===0?'the Meridian vault':state.stageIndex===1?'five alarm circuits':'three escape airlocks'}"></canvas><span class="camera-corner tl"></span><span class="camera-corner tr"></span><span class="camera-corner bl"></span><span class="camera-corner br"></span><div class="scene-label">MERIDIAN INTERNAL SECURITY</div><div class="scene-rec"><span class="dot orange"></span>REC &nbsp; ${state.paused?'PAUSED':'● FEED 0'+(state.stageIndex+4)}</div><div class="scene-bottom"><span>SUB–LEVEL 03 &nbsp; / &nbsp; RESTRICTED ACCESS</span><span>1920 × 1080 &nbsp; 24 FPS</span></div></div><div class="scene-footer"><span><span class="signal-bars"><i></i><i></i><i></i><i></i></span>${state.phase==='caught'?'SECURITY LOCKDOWN':state.phase==='escaped'?'ASSET SECURED':state.phase==='briefing'?'CONNECTION SECURE':state.paused?'FEED ON HOLD':'OPERATOR ON SITE'}</span><span class="coordinate">34° 03′ 08.1″ N &nbsp; 118° 14′ 42.0″ W</span><span class="orange">${state.phase==='escaped'?'EXTRACTED':state.phase==='caught'?'COMPROMISED':'VAULT '+(state.stageIndex===0?'SEALED':'BREACHED')}</span></div></div>`;}
function puzzlePanel(){
  const controls=!roomId||isHost;
  if(state.result){return `<div class="puzzle-panel result-panel ${state.phase==='caught'?'failed':''}"><div class="eyebrow">${state.phase==='escaped'?'THE CREW DELIVERED.':'EVEN GOOD CREWS GET CAUGHT.'}</div><h3>${escape(state.result.title)}</h3><p>${escape(state.result.detail)}</p><div class="result-stats"><span>${formatTime(state.result.elapsedSeconds)} ELAPSED</span><span>${state.crew.total} CREW</span><span>${state.alarm.value} STRIKES</span></div><div class="button-row">${controls?`<button class="button" data-action="reset">${icon('reset')} Run a new heist</button>`:''}<button class="button secondary" data-action="share">${icon('crew')} Bring your crew</button></div></div>`;}
  if(state.phase==='briefing'){return `<div class="puzzle-panel"><h3>A vault that takes a village.</h3><p>Break into Meridian Reserve. Recover the artifact. Get everyone out before lockdown. Your crew sees the clues you can't.</p><div class="briefing-rules"><span class="briefing-rule">${icon('clock')} 8 minutes</span><span class="briefing-rule">${icon('shield')} 3 strikes = lockdown</span><span class="briefing-rule">${icon('crew')} 3 specialist roles</span></div><div class="button-row">${controls?`<button class="button" data-action="start">Begin heist ${icon('arrow')}</button><button class="button secondary" data-action="share">${icon('crew')} Assemble your crew</button>`:`<a class="button" href="/crew/${roomId}">Join the crew ${icon('arrow')}</a>`}<span class="button-note">${roomId?`MISSION ${escape(roomId.toUpperCase())}`:'No account needed to rehearse.'}</span></div></div>`;}
  return `<div class="puzzle-panel"><h3>${escape(state.stage.title)}</h3><p>${escape(state.stage.instruction)}</p>${state.paused?'<div class="notice" style="margin-top:14px">Mission paused. Resume the clock to operate the terminal.</div>':''}${state.stage.kind==='keypad'?`<form id="answer-form" class="keypad-form"><label class="eyebrow" for="code-input">ACCESS CODE</label><input class="code-input" id="code-input" name="answer" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="••••" value="${escape(codeAnswer)}" aria-label="Four digit access code" ${!controls||state.paused?'disabled':''}><button class="button" type="submit" ${!controls||state.paused?'disabled':''}>Unlock vault ${icon('arrow')}</button></form>`:`<div class="answer-options">${state.stage.options.map(option=>`<button class="answer-option ${selectedAnswer===option.id?'selected':''}" data-action="option" data-option="${escape(option.id)}" aria-pressed="${selectedAnswer===option.id}" ${!controls||state.paused?'disabled':''}>${state.stage.kind==='wires'?`<span class="wire-swatch" style="background:${escape(option.color)};color:${escape(option.color)}"></span>`:icon('shield')}<strong>${escape(option.label)}</strong><small>${escape(option.detail)}</small><span class="vote-count">${state.votes.find(v=>v.optionId===option.id)?.count||0} VOTES</span></button>`).join('')}</div><div class="button-row"><button class="button" data-action="submit-option" ${!controls||state.paused||!selectedAnswer?'disabled':''}>${state.stage.kind==='wires'?'Cut selected wire':'Take this exit'} ${icon('arrow')}</button><span class="button-note">${state.stage.kind==='wires'?'One cut. Check all three clues.':'Check the ring. Apply the shift.'}</span></div>`}</div>`;
}
function crewPanel(){return `<div class="crew-heading"><h2>${icon('crew')} The crew</h2><span class="crew-count">${state.crew.total} ASSIGNED</span></div><div class="crew-roles">${state.crew.roles.map(role=>`<div class="crew-role"><div class="role-icon">${icon(roleInfo[role.id]?.icon)}</div><div><strong>${escape(role.name)}</strong><small>${roleInfo[role.id]?.detail||''}</small></div><span class="role-count ${role.count?'present':''}">${role.count?String(role.count).padStart(2,'0'):'—'}</span></div>`).join('')}</div><div class="crew-invite"><button class="button secondary" data-action="share"><span>${icon('link')} &nbsp; Invite your crew</span>${icon('arrow')}</button></div>`;}
function messages(){return state.comms.length?state.comms.slice(-35).map(message=>`<div class="message"><div class="message-meta"><span class="message-name">${escape(message.name)}</span><span class="message-role">${escape(message.role||'crew').toUpperCase()}</span>${message.source==='demo'?'<span class="message-role demo">DEMO</span>':message.source==='twitch'?'<span class="message-role">TWITCH</span>':''}<time class="message-time">${new Date(message.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})}</time></div><p>${escape(message.text)}</p></div>`).join(''):`<div class="message system"><div class="message-meta"><span class="message-name">MISSION CONTROL</span><span class="message-role">SYSTEM</span></div><p>Secure line established. Awaiting crew intelligence.</p></div><div class="comms-empty"><strong>A little trust goes a long way.</strong>Invite your crew to unlock three private intelligence channels. Their clues appear here when they share them.</div>`;}
function commsPanel(){return `<div class="comms-header"><strong>Live comms</strong><span><span class="dot" style="width:4px;height:4px"></span>ENCRYPTED</span></div><div class="comms" aria-live="polite" aria-label="Crew communications">${messages()}</div><div class="comms-footer"><span>${icon('lock')} END-TO-END COOPERATION</span><span>${state.comms.length} MSG</span></div>`;}
function activityView(){const events=state.events.slice(-2);return events.length?`<section class="activity"><div class="section-heading"><h2>Mission activity</h2><small>LIVE LOG</small></div>${events.map(event=>`<div class="activity-item"><span class="dot ${event.tone==='danger'?'orange':''}"></span><span><strong>${escape(event.title)}</strong> &nbsp; ${escape(event.detail)}</span><time>${new Date(event.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})}</time></div>`).join('')}</section>`:'';}
function intelligenceView(){return `<div class="setup-panel"><div class="eyebrow">INFORMATION IS A TEAM SPORT</div><h2>Three perspectives. One way out.</h2><p>Your operator terminal never receives the private intelligence. Every specialist sees a different part of the current puzzle. Share your crew link, then work together over chat or voice.</p>${Object.entries(roleInfo).map(([id,r])=>`<div class="puzzle-panel"><div class="section-heading"><h3>${icon(r.icon)} &nbsp; ${r.name}</h3><span class="eyebrow">${state.crew.roles.find(x=>x.id===id)?.count||0} ASSIGNED</span></div><p>${id==='cipher'?'Cracks intercepted codes and decodes hidden signals. Holds half the symbol mappings, circuit pulse parity, and the original evacuation clearance.':id==='architect'?'Reads the building itself. Holds the symbol order, circuit terminal, and the original clockwise route ring.':'Sees the details nobody else can. Holds the other symbol mappings, physical circuit seal, and the live lockdown correction.'}</p></div>`).join('')}<div class="button-row"><button class="button" data-action="share">${icon('link')} Invite your crew</button><button class="button secondary" data-action="demo">${icon('crew')} Try a demo crew</button></div><div class="notice" style="margin-top:20px">Small crew? Two or three people can cover all roles using separate browser profiles. Rehearsing alone? The labeled demo specialists can relay their clues.</div></div>`;}
function broadcastView(){const connected=twitchStatus?.connected;return `<div class="setup-panel"><div class="eyebrow">YOUR STREAM. THEIR HEIST.</div><h2>Bring the operation to Twitch.</h2><p>Capture your operator view in OBS. Invite viewers to the crew page for private clues, or connect your Twitch channel so chat can join, request intelligence, and vote directly.</p><div class="puzzle-panel"><h3>01 &nbsp; Twitch chat connection</h3><div class="setup-status"><span class="dot ${connected?'':'off'}"></span><span>${connected?`Connected to ${escape(twitchStatus.channel)}`:escape(twitchStatus?.status||'Not connected. Local rehearsal is ready.')}</span></div><p>Your Twitch credentials stay on this computer. Configure the server, then connect your own channel below.</p><pre class="modal-code">TWITCH_CLIENT_ID=your_registered_client_id
TWITCH_ACCESS_TOKEN=your_user_access_token</pre><p>Use a user token with <code>user:read:chat</code>. Add <code>user:write:chat</code> if you want the bot to answer commands in chat. <a href="https://dev.twitch.tv/docs/chat/authenticating/" target="_blank" rel="noopener noreferrer">Twitch setup guide ↗</a></p><div class="button-row"><button class="button" data-action="twitch">${icon('radio')} ${connected?'Disconnect Twitch':'Connect Twitch'}</button><button class="button secondary small" data-action="refresh-twitch">Check connection</button></div></div><div class="puzzle-panel"><h3>02 &nbsp; Chat commands</h3><pre class="modal-code">!heist           Join the crew & receive a role
!clue            Relay your current role's intelligence
!vote cyan       Recommend a wire or an exit</pre><p>Votes show crew recommendations. The operator makes the final call. Joining the crew page gives viewers private clue cards without posting their clues to public chat.</p></div><div class="puzzle-panel"><h3>03 &nbsp; OBS browser source</h3><p>Add a Browser Source at 1920 × 1080. The overlay displays the timer, objectives, and crew count on a transparent background.</p><div class="field"><div class="copy-row"><input readonly aria-label="OBS overlay URL" value="${roomId?escape(location.origin+'/overlay/'+roomId):'Create a mission to generate your overlay URL'}"><button class="button secondary" data-action="copy-overlay">${icon('copy')} Copy</button>${roomId?`<a class="button secondary" href="/overlay/${roomId}" target="_blank" rel="noopener">Preview ↗</a>`:''}</div></div></div><button class="text-button" data-action="tab" data-tab="mission" aria-label="Mission control">← Return to mission control</button></div>`;}

function crewView(){
  const joined=!!token;
  return `<div class="crew-lobby"><header class="crew-top">${brand()}<div class="viewer-clock"><span data-clock>${formatTime(remaining())}</span><small>${state.paused?'MISSION PAUSED':'MISSION '+escape(roomId.toUpperCase())}</small></div></header><main class="crew-view"><div class="eyebrow"><span class="orange">CREW INTELLIGENCE</span> &nbsp; / &nbsp; MERIDIAN RESERVE</div><h1>${joined?`Every clue counts<span class="orange">.</span>`:`The operator needs you<span class="orange">.</span>`}</h1><p class="muted">${joined?'You see what the operator can’t. Relay your intelligence, listen to the other specialists, and get your crew out.':'Join the operation. Get a private specialist dossier. Help crack the vault before the clock runs out.'}</p>${!joined?`<form id="join-form" class="join-card"><h2 style="font-size:16px;margin:0">Choose your callsign.</h2><div class="field"><label for="callsign">YOUR CREW CALLSIGN</label><input id="callsign" name="name" required minlength="2" maxlength="24" placeholder="e.g. Nightowl" autocomplete="nickname" value="${escape(joinName)}"></div><div class="field"><label for="role-select">SPECIALIST ASSIGNMENT</label><select id="role-select" name="role"><option value="" ${!joinRole?'selected':''}>Assign me where I’m needed</option><option value="cipher" ${joinRole==='cipher'?'selected':''}>Cipher — intercepted signals</option><option value="architect" ${joinRole==='architect'?'selected':''}>Architect — blueprints & routes</option><option value="lookout" ${joinRole==='lookout'?'selected':''}>Lookout — eyes on the inside</option></select></div><button class="button" type="submit">Join the crew ${icon('arrow')}</button><p class="muted" style="font-size:10px;margin-bottom:0">No Twitch account needed for the companion view.</p></form>`:`${objectives()}${state.result?`<div class="puzzle-panel result-panel ${state.phase==='caught'?'failed':''}"><h3>${escape(state.result.title)}</h3><p>${escape(state.result.detail)}</p></div>`:dossierView()}<div class="crew-comms">${commsPanel()}</div><form id="chat-form" class="chat-form"><label for="chat-input" class="eyebrow" style="align-self:center">TRANSMIT</label><input class="chat-input" id="chat-input" name="text" maxlength="400" placeholder="Relay intelligence to your crew…" value="${escape(chatDraft)}" required autocomplete="off"><button class="button" type="submit">Send ${icon('arrow')}</button></form><p class="view-only-note">${icon('lock')} You relay the intelligence. The operator makes the call.</p>`}<div class="footer"><span>HEIST / TRUST YOUR CREW</span><span>${statusLabel()}</span></div></main></div>`;
}
function dossierView(){
  const d=state.dossier;
  if(!d)return '<div class="notice">Establishing your private intelligence channel…</div>';
  const recommendation=state.stage.options.length
    ? `<span class="button-note">Recommend a ${state.stage.kind==='wires'?'wire':'door'}:</span>${state.stage.options.map(o=>`<button class="button secondary small" data-action="vote" data-option="${escape(o.id)}" ${state.phase!=='active'||state.paused?'disabled':''}>${escape(o.label)}</button>`).join('')}`
    : '<span class="button-note">The other specialists have the missing pieces.</span>';
  return `<section class="crew-private"><div class="dossier-top"><div><div class="eyebrow">${escape(state.stage.kicker)} &nbsp; / &nbsp; PRIVATE INTELLIGENCE</div><h2>${icon(roleInfo[d.role]?.icon)} &nbsp; ${escape(d.name)} dossier</h2></div><span class="classified">EYES ONLY</span></div>${d.clues.map(c=>`<div class="clue"><div class="eyebrow">${escape(c.label)}</div><p>${escape(c.text)}</p></div>`).join('')}<p class="crew-objective">${escape(d.objective)}</p><div class="button-row" style="margin-top:18px"><button class="button" data-action="relay">${icon('radio')} Relay my clue</button>${recommendation}</div></section>`;
}

function overlayView(){document.body.classList.add('overlay-body');return `<div class="overlay-shell"><div class="overlay-bar"><div><div class="eyebrow orange">HEIST / THE MERIDIAN JOB</div><h1>${state.result?escape(state.result.title):escape(state.stage.title)}</h1><div class="eyebrow">${statusLabel()}</div></div><div><div class="timer" data-clock>${formatTime(remaining())}</div><div class="eyebrow">${state.alarm.value}/3 STRIKES</div></div></div><div class="overlay-bottom"><div class="eyebrow">${state.crew.total} CREW ASSIGNED &nbsp; / &nbsp; ${escape(roomId.toUpperCase())}</div>${objectives()}</div></div>`;}
function render(){
  const focus=document.activeElement?.id;const start=document.activeElement?.selectionStart;const end=document.activeElement?.selectionEnd;
  const scrolls=[...document.querySelectorAll('.comms')].map(el=>({bottom:el.scrollHeight-el.clientHeight-el.scrollTop<45,top:el.scrollTop}));
  $('#app').innerHTML=view==='crew'?crewView():view==='overlay'?overlayView():shell();
  if(focus){const el=document.getElementById(focus);if(el){el.focus({preventScroll:true});try{el.setSelectionRange(start,end);}catch{}}}
  document.querySelectorAll('.comms').forEach((el,i)=>{const prev=scrolls[i];el.scrollTop=!prev||prev.bottom?el.scrollHeight:prev.top;});
  updateTimers();drawScene(performance.now());
}
function modal(title,body){closeModal();const back=document.createElement('div');back.className='modal-backdrop';back.id='modal-backdrop';back.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>${body}</section>`;back.addEventListener('click',event=>{if(event.target===back)closeModal();});document.body.append(back);back._returnFocus=document.activeElement;$('.icon-button',back)?.focus();}
function closeModal(){const back=$('#modal-backdrop');if(back){const focus=back._returnFocus;back.remove();if(focus?.isConnected)focus.focus();}}
async function shareModal(){if(!roomId)await createMission(false);const url=location.origin+'/crew/'+roomId;modal('Every great heist needs a crew.',`<p>Send this link to your viewers. Each specialist receives a private piece of the current puzzle. Your operator controls stay with you.</p><div class="field"><label for="crew-link">CREW COMPANION LINK</label><div class="copy-row"><input id="crew-link" readonly value="${escape(url)}"><button class="button" data-action="copy-crew">${icon('copy')} Copy link</button></div></div><div class="button-row"><a class="button secondary" href="${escape(url)}" target="_blank" rel="noopener">Open crew view ↗</a></div><div class="notice" style="margin-top:20px">On this computer, open the link in another browser profile for each specialist. Remote viewers need a publicly reachable server; localhost links work on this computer only.</div><p class="eyebrow" style="margin-top:20px">MISSION ID &nbsp; ${escape(roomId.toUpperCase())}</p>`);}
async function demoModal(){if(!roomId)await createMission(false);if(!isHost)throw new Error('Demo crew controls belong to the operator.');modal('Meet your rehearsal crew.',`<p>Practice the full mission on your own. Each demo specialist relays only their part of the current puzzle. Read the clues, combine them, and make the call.</p><div class="notice">LOCAL REHEARSAL · These are labeled demo participants. Live Twitch viewers appear only after you connect your channel.</div>${Object.entries(roleInfo).map(([id,r])=>`<div class="demo-role-card"><div><strong>${icon(r.icon)} &nbsp; ${r.name}</strong><p>${r.detail}</p></div><button class="button secondary small" data-action="demo-clue" data-role="${id}">Relay clue ${icon('radio')}</button></div>`).join('')}<p class="muted" style="font-size:10px">Clues update at each objective. Call your specialists again after completing a stage.</p><button class="button" data-action="demo-all" style="margin-top:10px">${icon('crew')} Ask all three specialists</button>`);}
function helpModal(){modal('Eight minutes. Three perspectives.',`<p>Meridian Reserve has something that belongs to your crew. The operator has access to the building. The crew has the intelligence.</p>${[['01','Assemble your crew','Share the crew link. Viewers choose Cipher, Architect, or Lookout and receive different private clues.'],['02','Follow the intelligence','Begin the heist. Your crew relays clues to live comms. Combine all three perspectives before entering a code, cutting a wire, or choosing an exit.'],['03','Make it out together','Clear all three objectives before lockdown. Three wrong answers end the mission. The operator can pause during a rehearsal.']].map(([n,t,p])=>`<div class="help-grid"><span class="step-number">${n}</span><div><strong>${t}</strong><p>${p}</p></div></div>`).join('')}<div class="notice">Flying solo? Use “Try with a demo crew” to relay the specialists’ clues. Every fresh heist generates new puzzle answers.</div>`);}
async function copy(value){try{await navigator.clipboard.writeText(value);toast('Copied. Bring your crew.');}catch{modal('Copy your mission link.',`<div class="field"><input readonly value="${escape(value)}" aria-label="Mission link"></div><p>Select the link and copy it to your clipboard.</p>`);}}
async function refreshTwitch(){if(!roomId||!isHost)return;try{const next=await api(`/api/rooms/${roomId}/twitch`);if(JSON.stringify(next)!==JSON.stringify(twitchStatus)){twitchStatus=next;render();}}catch(error){toast(error.message);}}
function beep(type){if(!soundOn)return;try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();audioContext.resume();const now=audioContext.currentTime;const notes=type==='win'?[440,554,659,880]:type==='stage'?[440,660]:type==='alarm'||type==='lose'?[190,140]:[480];notes.forEach((frequency,i)=>{const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.value=frequency;gain.gain.setValueAtTime(0,now+i*.15);gain.gain.linearRampToValueAtTime(.06,now+i*.15+.01);gain.gain.exponentialRampToValueAtTime(.001,now+i*.15+.25);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now+i*.15);osc.stop(now+i*.15+.3);});}catch{/* Audio is optional. */}}

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;
  if(action==='close-modal'){closeModal();return;}
  if(action==='option'){selectedAnswer=button.dataset.option;render();return;}
  if(action==='tab'){tab=button.dataset.tab;render();if(tab==='broadcast')await refreshTwitch();return;}
  if(action==='help'){helpModal();return;}
  if(action==='sound'){soundOn=!soundOn;beep('tap');render();toast(soundOn?'Mission audio enabled.':'Mission audio muted.');return;}
  if(busy)return;
  busy=true;button.classList.add('busy');
  try{
    if(action==='start'){if(!roomId)await createMission(false);await hostAction('start');beep('tap');}
    else if(action==='pause')await hostAction(state.paused?'resume':'pause');
    else if(action==='reset'){await hostAction('reset');selectedAnswer='';codeAnswer='';render();}
    else if(action==='share')await shareModal();
    else if(action==='demo')await demoModal();
    else if(action==='demo-clue'){const next=await api(`/api/rooms/${roomId}/demo`,{method:'POST',body:{role:button.dataset.role}});setState(next);toast(`${roleInfo[button.dataset.role].name} intelligence received in live comms.`);}
    else if(action==='demo-all'){for(const role of ['cipher','architect','lookout'])setState(await api(`/api/rooms/${roomId}/demo`,{method:'POST',body:{role}}));closeModal();toast('All three specialists have checked in. Read live comms.');}
    else if(action==='submit-option'){await hostAction('submit',selectedAnswer);selectedAnswer='';render();}
    else if(action==='copy-crew')await copy(location.origin+'/crew/'+roomId);
    else if(action==='copy-overlay'){if(!roomId)await createMission(false);await copy(location.origin+'/overlay/'+roomId);}
    else if(action==='refresh-twitch')await refreshTwitch();
    else if(action==='twitch'){if(!roomId)await createMission(false);twitchStatus=await api(`/api/rooms/${roomId}/twitch`,{method:'POST',body:{action:twitchStatus?.connected?'disconnect':'connect'}});render();toast(twitchStatus.status||'Twitch connection updated.');}
    else if(action==='relay'){setState(await api(`/api/rooms/${roomId}/chat`,{method:'POST',body:{text:'!clue'}}));toast('Your clue is on the crew channel.');}
    else if(action==='vote'){setState(await api(`/api/rooms/${roomId}/chat`,{method:'POST',body:{text:`!vote ${button.dataset.option}`}}));toast('Recommendation sent. The operator makes the call.');}
  }catch(error){toast(error.message);}finally{busy=false;button.classList.remove('busy');}
});
document.addEventListener('input',event=>{if(event.target.id==='code-input'){codeAnswer=event.target.value.replace(/\D/g,'').slice(0,4);event.target.value=codeAnswer;}if(event.target.id==='chat-input')chatDraft=event.target.value;if(event.target.id==='callsign')joinName=event.target.value;if(event.target.id==='role-select')joinRole=event.target.value;});
document.addEventListener('submit',async event=>{
  if(!['answer-form','join-form','chat-form'].includes(event.target.id))return;event.preventDefault();if(busy)return;busy=true;
  const form=event.target;const submit=$('button[type="submit"]',form);if(submit)submit.disabled=true;
  try{
    if(form.id==='answer-form'){if(codeAnswer.length!==4)throw new Error('Enter all four digits from the crew’s intelligence.');await hostAction('submit',codeAnswer);codeAnswer='';render();}
    else if(form.id==='join-form'){const fields=new FormData(form);const data=await api(`/api/rooms/${roomId}/join`,{method:'POST',body:{name:fields.get('name'),...(fields.get('role')?{role:fields.get('role')}:{})},auth:''});token=data.viewerToken;playerRole=data.role;storeSet(`heist:viewer:${roomId}`,token);setState(data.state);subscribe();beep('tap');}
    else if(form.id==='chat-form'){const text=chatDraft.trim();if(!text)return;setState(await api(`/api/rooms/${roomId}/chat`,{method:'POST',body:{text}}));chatDraft='';render();}
  }catch(error){toast(error.message);}finally{busy=false;if(submit)submit.disabled=false;}
});
document.addEventListener('keydown',event=>{const modalEl=$('#modal-backdrop');if(event.key==='Escape')closeModal();if(event.key==='Tab'&&modalEl){const focusables=[...modalEl.querySelectorAll('button,a,input,select')].filter(el=>!el.disabled);const first=focusables[0],last=focusables.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
window.addEventListener('popstate',()=>location.reload());
window.addEventListener('beforeunload',()=>subscription?.close());

// The security camera is drawn locally. No video, third-party game assets, or image service is required.
function drawScene(time){
  const canvas=$('#vault-canvas');if(!canvas)return;
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const dpr=Math.min(devicePixelRatio||1,2);const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;
  c.clearRect(0,0,w,h);c.save();const sceneScale=Math.max(w/900,h/470);c.scale(sceneScale,sceneScale);c.translate((w/sceneScale-900)/2,(h/sceneScale-470)/2);
  const W=900,H=470,center=450,cy=217;
  const bg=c.createRadialGradient(450,200,20,450,220,530);bg.addColorStop(0,'#334236');bg.addColorStop(.55,'#1e2b22');bg.addColorStop(1,'#08100c');c.fillStyle=bg;c.fillRect(0,0,W,H);
  // Faceted concrete corridor, converging on the vault.
  polygon(c,[[0,0],[245,75],[245,347],[0,H]],'#16221b','#28362a');
  polygon(c,[[W,0],[655,75],[655,347],[W,H]],'#142018','#29372a');
  polygon(c,[[0,0],[W,0],[655,75],[245,75]],'#18231c','#27362a');
  polygon(c,[[0,H],[245,347],[655,347],[W,H]],'#101b14','#30402e');
  c.strokeStyle='#4a614033';c.lineWidth=1;
  for(let x=-500;x<1400;x+=165){c.beginPath();c.moveTo(center+(x-center)*.2,347);c.lineTo(x,H);c.stroke();}
  [359,378,407,449].forEach(y=>{c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();});
  [35,92,170,730,808,865].forEach((x,i)=>{const left=x<450;const ix=left?245:655;const depth=Math.abs(450-x)/450;polygon(c,[[x,0],[x+(left?11:-11),0],[ix+(left?-depth*30:depth*30),75],[ix+(left?-depth*30:depth*30),347],[x+(left?11:-11),H],[x,H]],i%2?'#17281d':'#1d3022','#45573a66');});
  // Vertical practical strip lights.
  glowLine(c,170,94,170,322,'#bdc898',3,13);glowLine(c,730,94,730,322,'#bdc898',3,13);
  c.fillStyle='#0b150f';c.fillRect(235,65,430,290);c.strokeStyle='#566949';c.lineWidth=3;c.strokeRect(235,65,430,290);
  c.strokeStyle='#121d14';c.lineWidth=8;c.strokeRect(247,77,406,266);
  if(state.stageIndex===0)drawVault(c,time,cy);
  else if(state.stageIndex===1)drawWires(c,time);
  else drawDoors(c,time);
  // Equipment and diegetic signage.
  polygon(c,[[79,245],[133,230],[133,318],[79,343]],'#18281b','#556540');
  polygon(c,[[86,252],[126,241],[126,273],[86,287]],'#132719','#50643e');
  c.fillStyle='#a8c17b';c.font='8px monospace';c.fillText('M / 03',90,267);glowLine(c,91,298,117,289,'#a9ba80',1,4);
  c.save();c.translate(791,233);c.transform(1,.28,0,1,0,0);c.fillStyle='#29351f';c.fillRect(-12,-25,47,46);c.strokeStyle='#697542';c.strokeRect(-12,-25,47,46);c.fillStyle='#b4b780';c.font='7px monospace';c.fillText('CAUTION',-7,-11);c.font='5px monospace';c.fillText('AUTHORIZED',-7,0);c.fillText('PERSONNEL',-7,8);c.restore();
  // Alarm light, reflections, particles, camera treatment.
  const alarm=state.phase==='caught';const pulse=.6+Math.sin(time*.002)*.2;
  c.save();c.globalAlpha=pulse;glowLine(c,672,104,672,158,alarm?'#ff4933':'#df7c44',5,17);c.restore();
  const light=c.createRadialGradient(667,141,2,667,141,130);light.addColorStop(0,alarm?'#e5522b22':'#c5833022');light.addColorStop(1,'#c5833000');c.fillStyle=light;c.fillRect(540,40,250,250);
  c.fillStyle='#91b478';for(let i=0;i<26;i++){const x=(i*137.7+Math.sin(time*.00008+i)*20)%900;const y=(i*67+time*.003*(1+i%3))%470;c.globalAlpha=.08+((i%4)*.04);c.fillRect(x,y,1,1);}c.globalAlpha=1;
  const vignette=c.createRadialGradient(450,220,110,450,230,500);vignette.addColorStop(0,'#00000000');vignette.addColorStop(1,'#030b06d9');c.fillStyle=vignette;c.fillRect(0,0,W,H);
  c.strokeStyle='#a8c18f44';c.lineWidth=.8;c.beginPath();c.moveTo(439,cy);c.lineTo(445,cy);c.moveTo(455,cy);c.lineTo(461,cy);c.moveTo(450,cy-11);c.lineTo(450,cy-5);c.moveTo(450,cy+5);c.lineTo(450,cy+11);c.stroke();
  if(state.phase==='escaped'){c.fillStyle='#101f0caa';c.fillRect(0,0,W,H);c.textAlign='center';c.fillStyle='#c3dca1';c.font='500 12px monospace';c.fillText('ARTIFACT SECURED',450,200);c.fillStyle='#8da46d';c.font='9px monospace';c.fillText('EXTRACTION COMPLETE / THE CREW DELIVERED',450,224);c.textAlign='left';}
  if(state.phase==='caught'){c.fillStyle='#3c0d09aa';c.fillRect(0,0,W,H);c.textAlign='center';c.fillStyle='#ff9b75';c.font='500 16px monospace';c.fillText('SECURITY LOCKDOWN',450,211);c.font='8px monospace';c.fillText('ACCESS REVOKED / SIGNAL TERMINATED',450,235);c.textAlign='left';}
  c.restore();
}
function polygon(c,points,fill,stroke){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
function glowLine(c,x1,y1,x2,y2,color,width,blur){c.save();c.strokeStyle=color;c.lineWidth=width;c.shadowColor=color;c.shadowBlur=blur;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();c.restore();}
function drawVault(c,time,cy){
  c.fillStyle='#263225';c.fillRect(262,85,376,247);c.strokeStyle='#48573b';c.lineWidth=2;c.strokeRect(262,85,376,247);
  c.fillStyle='#0b160e';c.fillRect(278,100,344,218);c.strokeStyle='#566547';c.lineWidth=1;c.strokeRect(278,100,344,218);
  const metal=c.createLinearGradient(330,100,580,330);metal.addColorStop(0,'#63705b');metal.addColorStop(.15,'#344431');metal.addColorStop(.48,'#58644e');metal.addColorStop(.53,'#283b29');metal.addColorStop(.9,'#49573c');metal.addColorStop(1,'#788069');
  c.shadowColor='#000a';c.shadowBlur=20;c.shadowOffsetY=10;c.beginPath();c.arc(450,cy,114,0,Math.PI*2);c.fillStyle=metal;c.fill();c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#6d7d5c';c.lineWidth=3;c.stroke();
  for(const [r,color,width]of[[106,'#152413',5],[97,'#748264',2],[90,'#1e2e1d',5],[81,'#6d795d',1]]){c.beginPath();c.arc(450,cy,r,0,Math.PI*2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  const face=c.createRadialGradient(425,cy-35,0,450,cy,80);face.addColorStop(0,'#56684b');face.addColorStop(1,'#2a3c28');c.fillStyle=face;c.beginPath();c.arc(450,cy,79,0,Math.PI*2);c.fill();
  for(let i=0;i<12;i++){const a=i*Math.PI/6;const x=450+101*Math.cos(a),y=cy+101*Math.sin(a);c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fillStyle='#1b2c1b';c.fill();c.beginPath();c.arc(x-1,y-1,1,0,Math.PI*2);c.fillStyle='#93a27c';c.fill();}
  for(let i=0;i<6;i++){const a=i*Math.PI/3;c.strokeStyle='#263923';c.lineWidth=7;c.beginPath();c.moveTo(450+18*Math.cos(a),cy+18*Math.sin(a));c.lineTo(450+48*Math.cos(a),cy+48*Math.sin(a));c.stroke();c.strokeStyle='#7d8969';c.lineWidth=3;c.stroke();}
  c.beginPath();c.arc(450,cy,49,0,Math.PI*2);c.strokeStyle='#182d1b';c.lineWidth=9;c.stroke();c.strokeStyle='#7d8969';c.lineWidth=4;c.stroke();
  c.beginPath();c.arc(450,cy,18,0,Math.PI*2);c.fillStyle='#738768';c.fill();c.strokeStyle='#243c27';c.lineWidth=5;c.stroke();
  for(const y of[150,251]){c.fillStyle='#6c785a';c.fillRect(567,y,22,19);c.fillStyle='#31452b';c.fillRect(571,y+3,22,19);c.strokeStyle='#758264';c.lineWidth=1;c.strokeRect(571,y+3,22,19);}
  c.fillStyle='#253521';c.fillRect(295,164,27,68);c.strokeStyle='#66774e';c.strokeRect(295,164,27,68);c.fillStyle='#b9d58a';c.shadowColor='#b9d58a';c.shadowBlur=8;c.fillRect(302,172,13,9);c.shadowBlur=0;
  for(let row=0;row<4;row++)for(let col=0;col<3;col++){c.fillStyle='#7c8d5e';c.fillRect(300+col*6,188+row*8,3,3);}
  c.fillStyle='#b3c297';c.font='7px monospace';c.textAlign='center';c.fillText('M E R I D I A N',450,305);c.font='5px monospace';c.fillStyle='#6f835b';c.fillText('RESERVE  /  EST.  1968',450,316);c.textAlign='left';
  const floor=c.createLinearGradient(0,345,0,440);floor.addColorStop(0,'#8eaa5722');floor.addColorStop(1,'#8eaa5700');c.fillStyle=floor;c.beginPath();c.moveTo(354,349);c.lineTo(548,349);c.lineTo(625,440);c.lineTo(275,440);c.fill();
}
function drawWires(c,time){
  c.fillStyle='#24331f';c.fillRect(275,91,350,240);c.strokeStyle='#586a42';c.lineWidth=3;c.strokeRect(275,91,350,240);
  c.fillStyle='#112014';c.fillRect(300,110,300,80);c.strokeStyle='#405d37';c.lineWidth=1;c.strokeRect(300,110,300,80);
  c.fillStyle='#a8c879';c.shadowColor='#9bbd65';c.shadowBlur=6;c.textAlign='center';c.font='10px monospace';c.fillText('SECURITY BYPASS / MANUAL OVERRIDE',450,136);c.font='7px monospace';c.fillText('MATCH TERMINAL + PULSE + SEAL',450,158);c.fillStyle='#638a48';c.fillRect(330,170,240,2);c.shadowBlur=0;c.textAlign='left';
  const colors=state.stage.options.map(o=>o.color);colors.forEach((color,i)=>{const x=315+i*66;c.fillStyle='#0b140a';c.fillRect(x-12,205,24,23);c.fillRect(x-12,290,24,23);c.strokeStyle='#67824b';c.lineWidth=1;c.strokeRect(x-12,205,24,23);c.strokeRect(x-12,290,24,23);c.save();c.lineCap='round';c.beginPath();c.moveTo(x,221);c.bezierCurveTo(x-18,243,x+21,270,x,299);c.strokeStyle='#08110a';c.lineWidth=13;c.stroke();c.strokeStyle=color;c.lineWidth=7;c.shadowBlur=8;c.shadowColor=color;c.stroke();c.restore();c.fillStyle='#acbc91';c.font='6px monospace';c.textAlign='center';c.fillText(state.stage.options[i].label.toUpperCase(),x,322);c.textAlign='left';});
}
function drawDoors(c,time){
  const options=state.stage.options;options.forEach((option,i)=>{const x=275+i*123;c.fillStyle='#35432c';c.fillRect(x,97,108,235);c.strokeStyle='#72825c';c.lineWidth=2;c.strokeRect(x,97,108,235);c.fillStyle='#142210';c.fillRect(x+7,105,94,220);c.strokeStyle='#3c5130';c.lineWidth=1;c.strokeRect(x+12,110,84,210);c.fillStyle='#273c23';c.fillRect(x+17,151,74,89);c.strokeStyle='#4d6840';c.strokeRect(x+17,151,74,89);glowLine(c,x+13,115,x+95,115,option.color,2,10);c.fillStyle=option.color;c.font='10px monospace';c.textAlign='center';c.fillText(option.label,x+54,136);c.fillStyle='#799166';c.font='7px monospace';c.fillText('0'+(i+1),x+54,274);c.textAlign='left';c.fillStyle='#92a578';c.fillRect(x+83,245,6,23);});
}
let lastDraw=0;const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(time){if(time-lastDraw>(reducedMotion?1000:40)){drawScene(time);lastDraw=time;}frame=requestAnimationFrame(animate);}
async function boot(){
  const match=location.pathname.match(/^\/(play|crew|overlay)\/([a-z0-9-]+)\/?$/i);
  if(match){roomId=match[2].toUpperCase();view=match[1]==='crew'?'crew':match[1]==='overlay'?'overlay':'host';if(view==='host'){const fragment=new URLSearchParams(location.hash.slice(1));token=fragment.get('host')||storeGet(`heist:host:${roomId}`,sessionStorage);isHost=!!token;if(fragment.has('host')){storeSet(`heist:host:${roomId}`,token,sessionStorage);history.replaceState({},'',location.pathname);}}else if(view==='crew')token=storeGet(`heist:viewer:${roomId}`);}
  render();
  if(roomId){try{const next=await api(`/api/rooms/${roomId}/state`);setState(next);subscribe();if(isHost)refreshTwitch();}catch(error){if(token&&(error.status===401||error.status===403)){token='';isHost=false;try{setState(await api(`/api/rooms/${roomId}/state`));subscribe();}catch{showError(error);}}else showError(error);}}
  requestAnimationFrame(animate);setInterval(updateTimers,250);setInterval(()=>{if(roomId&&isHost)refreshTwitch();},5000);
}
function showError(error){$('#app').innerHTML=`<div class="connection-error"><div class="eyebrow orange">MISSION LINK UNAVAILABLE</div><h1>This operation has gone dark.</h1><p>${escape(error.message)}</p><p class="muted">Mission rooms live in server memory. If the server restarted, create a new operation.</p><a class="button" href="/">Return to base ${icon('arrow')}</a></div>`;}
boot();
