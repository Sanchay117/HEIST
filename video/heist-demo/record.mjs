/** Fresh real-browser rehearsal. No fake clock, injected solution, or production auth bypass. */
import { pathToFileURL } from 'node:url';
const pwModule=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(pwModule.startsWith('/')?pathToFileURL(pwModule).href:pwModule);
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createServer } from '../../server.mjs';
import { startTwitchFixture } from '../../test/support/twitch-fixture.mjs';

const out=resolve('artifacts/heist-demo');
await mkdir(out+'/footage',{recursive:true});await mkdir(out+'/stills',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const server=createServer({twitchOptions:{clientId:'',accessToken:''}});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const contexts=[];const sources={};const marks={};const evidence={kind:'LOCAL REHEARSAL / AUTOMATED BROWSER CREW',clock:'actual wall-clock, default eight-minute mission',markers:marks,participants:[],runtimeErrors:[],actions:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const elapsed=()=>Number(((performance.now()-sources.host?.start)/1000).toFixed(3));
async function page(name,viewport={width:1440,height:1000},url=base){
  const context=await browser.newContext({viewport,recordVideo:{dir:out+'/footage/raw',size:viewport}});contexts.push(context);
  const p=await context.newPage();sources[name]={page:p,context,start:performance.now()};p.on('pageerror',e=>evidence.runtimeErrors.push(e.message));await p.goto(url);await p.evaluate(()=>document.fonts.ready);return p;
}
async function mark(name,payload={}){marks[name]={t:elapsed(),...payload};await writeFile(out+'/capture-progress.json',JSON.stringify(evidence,null,2));console.log(`Capture ${name}: ${elapsed()}s`,);}
async function still(p,name,selector){await (selector?p.locator(selector):p).screenshot({path:out+`/stills/${name}.png`});}
let f;
try{
  const host=await page('host');await still(host,'briefing');
  await host.getByRole('button',{name:'Assemble your crew'}).click();await host.locator('#crew-link').waitFor();
  const crewUrl=await host.locator('#crew-link').inputValue();evidence.roomId=crewUrl.split('/').at(-1);
  await host.getByRole('button',{name:'Close dialog'}).click();
  const crew={};
  for(const [role,name]of [['cipher','Echo'],['architect','Blueprint'],['lookout','Ghost']]){
    crew[role]=await page(role,{width:440,height:1000},crewUrl);
    await crew[role].getByLabel('YOUR CREW CALLSIGN').fill(name);await crew[role].getByLabel('SPECIALIST ASSIGNMENT').selectOption(role);await crew[role].getByRole('button',{name:'Join the crew'}).click();
    await crew[role].locator('.clue p').waitFor();await still(crew[role],`lock-${role}`,'.crew-private');
    evidence.participants.push({name,role,source:'browser rehearsal, automated'});
  }
  await host.getByRole('button',{name:'Begin heist'}).click();await host.locator('#code-input').waitFor();await mark('missionStart');await still(host,'host-lock');
  await wait(6000);await mark('cluesStart');
  for(const p of Object.values(crew)){await p.getByRole('button',{name:'Relay my clue'}).click();await wait(1600);}
  const clueText=(await host.locator('.comms .message p').allTextContents()).join(' ');
  const order=clueText.match(/plates in this order: (.*?)\. This order/)[1].split(' → ');
  const mappings=Object.fromEntries([...clueText.matchAll(/(MOON|EYE|CROWN|STAR) = (\d)/g)].map(m=>[m[1],m[2]]));
  evidence.lock={order,mappings,code:order.map(x=>mappings[x]).join('')};
  await wait(6000);await mark('codeStart');
  await host.getByLabel('Four digit access code').pressSequentially(evidence.lock.code,{delay:550});await wait(2000);await host.getByRole('button',{name:'Unlock vault'}).click();
  await host.locator('[data-option="cyan"]').waitFor();await mark('wireStart');await still(host,'host-wires');
  for(const [role,p]of Object.entries(crew)){await p.locator('.clue p').filter({hasText:role==='cipher'?'pulse':role==='architect'?'TERMINAL':'seal'}).waitFor();await still(p,`wire-${role}`,'.crew-private');await p.getByRole('button',{name:'Relay my clue'}).click();}
  const all=(await host.locator('.comms .message p').allTextContents()).slice(-3).join(' ');
  const terminal=all.match(/TERMINAL ([AB])/)[1],pulse=all.match(/an (ODD|EVEN) pulse/)[1],seal=all.match(/a (BROKEN|INTACT) seal/)[1];
  const option=host.locator('[data-action="option"]').filter({hasText:`Terminal ${terminal} · ${pulse} pulse · ${seal} seal`});
  const wire=await option.getAttribute('data-option');evidence.wire={terminal,pulse,seal,wire};
  const other=wire==='cyan'?'red':'cyan';await wait(3500);await mark('voteStart');
  await crew.cipher.locator(`[data-action="vote"][data-option="${other}"]`).click();await wait(3500);
  await crew.cipher.locator(`[data-action="vote"][data-option="${wire}"]`).click();await host.locator(`[data-option="${wire}"] .vote-count`).filter({hasText:'1 VOTES'}).waitFor();
  const state=(await (await fetch(`${base}/api/rooms/${evidence.roomId}/state`)).json());
  evidence.actions.push({kind:'actual companion HTTP vote',source:'automated rehearsal browser',vote:wire,hostVotes:state.votes});await mark('voteReceived');await still(host,'host-vote');
  await wait(4000);await option.click();await wait(1500);await host.getByRole('button',{name:'Cut selected wire'}).click();await host.locator('[data-option="iris"]').waitFor();await mark('exitStart');
  for(const [role,p]of Object.entries(crew)){await p.locator('.clue p').filter({hasText:role==='cipher'?'SLOT':role==='architect'?'clockwise':'FORWARD'}).waitFor();await still(p,`exit-${role}`,'.crew-private');await p.getByRole('button',{name:'Relay my clue'}).click();}
  const exitText=(await host.locator('.comms .message p').allTextContents()).slice(-3).join(' ');
  const ring=exitText.match(/clockwise: (.*?) → back/)[1].split(' → ').map(x=>x.toLowerCase());const slot=Number(exitText.match(/SLOT (\d)/)[1]),shift=Number(exitText.match(/FORWARD (\d)/)[1]);
  evidence.escape={ring,slot,shift,door:ring[(slot-1+shift)%3]};await still(host,'host-exit');await mark('exitClues');

  // An isolated test transport demonstrates pairing only. It is always labeled simulated.
  f=await startTwitchFixture();const live=await f.create();await f.connect(live);
  const pair=await page('pairing',{width:1100,height:900},`${f.base}/crew/${live.roomId}`);
  sources.pairing.kind='SIMULATED TWITCH TRANSPORT / IDENTITY UI ONLY';
  await pair.getByRole('button',{name:'Get pairing code',exact:true}).click();await pair.locator('#pair-command').waitFor();await wait(3000);await still(pair,'pairing-pending');
  const code=(await pair.locator('#pair-command').inputValue()).slice(6);await f.send('999',`!link ${code}`,'Nightowl');await pair.getByRole('button',{name:'Confirm account'}).waitFor();await wait(3000);await still(pair,'pairing-confirm');
  await pair.getByRole('button',{name:'Confirm account'}).click();await pair.locator('.clue p').waitFor();await wait(4000);await still(pair,'pairing-linked');
  await sources.pairing.context.close();contexts.splice(contexts.indexOf(sources.pairing.context),1);await rename(await pair.video().path(),out+'/footage/pairing.webm');await f.close();f=null;

  while(true){const data=await (await fetch(`${base}/api/rooms/${evidence.roomId}/state`)).json();if(data.phase!=='active')throw new Error('Rehearsal ended before the recorded climax.');if(data.clock.remainingSeconds<=20)break;await wait(Math.min(30,data.clock.remainingSeconds-20)*1000);console.log('Recording the real countdown; production work can continue.');}
  await host.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await mark('climaxStart');await still(host,'host-countdown');
  while((await (await fetch(`${base}/api/rooms/${evidence.roomId}/state`)).json()).clock.remainingSeconds>5)await wait(500);
  await host.locator(`[data-action="option"][data-option="${evidence.escape.door}"]`).click();await host.getByRole('button',{name:'Take this exit'}).click();await host.getByRole('heading',{name:'The perfect getaway'}).waitFor();await mark('escaped');await still(host,'host-success');
  const final=await (await fetch(`${base}/api/rooms/${evidence.roomId}/state`)).json();evidence.result={phase:final.phase,clock:final.clock,alarm:final.alarm,elapsedSeconds:final.result.elapsedSeconds};await wait(7000);
  for(const [name,source]of Object.entries(sources)){if(name==='pairing')continue;await source.context.close();await rename(await source.page.video().path(),out+`/footage/${name}.webm`);}
  evidence.sources=Object.fromEntries(Object.entries(sources).map(([name,s])=>[name,{file:`footage/${name}.webm`,kind:s.kind||'REAL APP / LOCAL BROWSER REHEARSAL'}]));
  await writeFile(out+'/capture.json',JSON.stringify(evidence,null,2));console.log('Complete rehearsal captured, with a real browser vote and actual successful extraction.');
}finally{if(f)await f.close();await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
