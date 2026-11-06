import type { Game, Lobby, View, Question, Player } from './game-types';
export const PARTY_TTL=2*60*60*1000;
export class GameError extends Error { constructor(message:string,public status=400){super(message);} }
export function validateName(name:unknown){if(typeof name!=='string')throw new GameError('Enter your name.');const n=name.trim();if(!n||n.length>24||/[\u0000-\u001f]/.test(n))throw new GameError('Use a name between 1 and 24 characters.');return n;}
export function freshGame():Game {return {phase:'LOBBY',round:crypto.randomUUID(),peers:[],credentials:{},options:[],sealed:{},batch:[],mix:0,questions:[],index:0,deadline:0,commits:{},active:[],masked:{},totals:null,reason:null,next:{},phaseAt:Date.now()};}
const count=(o:object)=>Object.keys(o).length;
function phase(g:Game,p:Game['phase'],now:number){g.phase=p;g.phaseAt=now;}
function results(g:Game,now:number,reason:string|null=null){g.sealed={};g.batch=[];g.commits={};g.masked={};g.reason=reason;g.next={};phase(g,'RESULTS',now);}
function complete(g:Game,now:number,reason:string|null=null){g.questions=[];g.sealed={};g.batch=[];g.commits={};g.masked={};g.totals=null;g.active=[];g.next={};g.reason=reason;phase(g,'COMPLETE',now);}
function startQuestion(g:Game,now:number){g.commits={};g.masked={};g.active=[];g.next={};g.totals=null;g.reason=null;g.deadline=now+30000;phase(g,'ANSWER',now);const q=g.questions[g.index];if(g.peers.filter(p=>q.audience==='all'||p.gender===q.audience).length<3){g.totals=null;results(g,now,'This audience is too small for a private result.');}}
function nextQuestion(g:Game,now:number){g.index++;if(g.index>=g.questions.length)complete(g,now);else startQuestion(g,now);}
export function tick(l:Lobby,g:Game,now:number){
  if((g.phase==='LOBBY'||g.phase==='CHECK')&&l.players.find(p=>p.id===l.host&&now-p.seen>45000)){const replacement=l.players.find(p=>now-p.seen<15000);if(replacement)l.host=replacement.id;}
  if(g.phase==='LOCK'&&now-g.phaseAt>=3200)phase(g,'WRITE',now);
  if(g.phase==='WRITE'&&count(g.sealed)===g.peers.length){g.batch=Object.values(g.sealed);g.sealed={};g.mix=0;phase(g,'MIX',now);}
  if((g.phase==='WRITE'&&now-g.phaseAt>240000)||(g.phase==='MIX'&&now-g.phaseAt>60000))complete(g,now,'The round ended safely because a device stopped responding.');
  if(g.phase==='ANSWER'){
    const q=g.questions[g.index];const eligible=g.peers.filter(p=>q.audience==='all'||p.gender===q.audience);
    if(now>=g.deadline||count(g.commits)===eligible.length){
      g.active=Object.keys(g.commits).sort();g.commits={};
      if(g.active.length<3){g.totals=null;results(g,now,'Too few answers to reveal a private result.');}
      else phase(g,'TALLY',now);
    }
  }
  if(g.phase==='TALLY'){
    if(count(g.masked)===g.active.length){
      const totals=new Array(g.questions[g.index].options.length).fill(0);
      for(const vector of Object.values(g.masked))for(let i=0;i<totals.length;i++)totals[i]=(totals[i]+vector[i])>>>0;
      if(totals.some(n=>n>g.active.length)||totals.reduce((a,b)=>a+b,0)!==g.active.length){g.totals=null;results(g,now,'The private tally could not be verified.');}
      else {g.totals=totals;results(g,now);}
    }else if(now-g.phaseAt>20000){g.totals=null;results(g,now,'A device disconnected. This result stays private.');}
  }
  if(g.phase==='RESULTS'&&(count(g.next)===g.peers.length||now-g.phaseAt>=60000))nextQuestion(g,now);
}
export function sanitizeQuestion(x:unknown):Question {
  if(!x||typeof x!=='object')throw new GameError('That question needs another look.');
  const q=x as Question;const text=typeof q.text==='string'?q.text.trim():'';
  const options=Array.isArray(q.options)?q.options.map(o=>typeof o==='string'?o.trim():''):[];
  if(text.length<5||text.length>200||options.length<2||options.length>50||options.some(o=>!o||o.length>60)||new Set(options.map(o=>o.toLowerCase())).size!==options.length||!['all','male','female'].includes(q.audience))throw new GameError('That question needs another look.');
  return {id:crypto.randomUUID(),text,options,audience:q.audience};
}
export function mutate(l:Lobby,g:Game,p:Player|null,anonymousId:string|null,action:string,data:Record<string,unknown>,now:number){
  const identity=g.phase==='LOBBY'||g.phase==='CHECK';
  if(identity&&!p)throw new GameError('Your session has expired.',401);
  const id=identity?p!.id:anonymousId!;
  if(!identity&&!g.peers.some(x=>x.id===id)&&action!=='lobby'&&!(action==='leave'&&g.phase==='COMPLETE'))throw new GameError('Your session has expired.',401);
  if(action==='name'){
    if(g.phase!=='LOBBY'||p!.locked)throw new GameError('Names are locked. Ask the host to redo the check.');
    const name=validateName(data.name);
    if(l.players.some(x=>x.id!==p!.id&&x.name.toLowerCase()===name.toLowerCase()))throw new GameError('That name is taken. Add an initial.');
    p!.name=name;p!.needsName=false;
  }else if(action==='reset'){
    if(!identity||l.host!==p!.id)throw new GameError('Only the host can redo setup before anonymity begins.');
    l.players.forEach(x=>{x.gender=null;x.locked=false;x.ready=false;x.needsName=true;});
    Object.assign(g,freshGame());g.phaseAt=now;
  }else if(action==='gender'){
    if(g.phase!=='LOBBY'||p!.locked)throw new GameError('Your choice is already locked.');
    if(p!.needsName)throw new GameError('Confirm your name first.');
    if(data.gender!=='male'&&data.gender!=='female')throw new GameError('Choose Male or Female.');
    p!.gender=data.gender;p!.locked=true;
  }else if(action==='participate'){
    if(g.phase!=='LOBBY'||l.host!==p!.id)throw new GameError('This setting is locked.');
    p!.active=!!data.active;
  }else if(action==='check'){
    const players=l.players.filter(p=>p.active);
    if(g.phase!=='LOBBY'||l.host!==p!.id||players.length<3||players.some(p=>!p.locked||p.needsName))throw new GameError('Everyone needs to confirm their name and lock their choice first.');
    l.players.forEach(p=>p.ready=false);phase(g,'CHECK',now);
  }else if(action==='cancel'){
    if(!identity||l.host!==p!.id)throw new GameError('This round is locked.');
    l.players.forEach(p=>p.ready=false);phase(g,'LOBBY',now);
  }else if(action==='ready'){
    if(g.phase!=='CHECK')throw new GameError('The check has ended.');p!.ready=true;
  }else if(action==='lock'){
    const players=l.players.filter(p=>p.active);
    if(g.phase!=='CHECK'||l.host!==p!.id||players.some(p=>!p.ready))throw new GameError('Wait until everyone is ready.');
    g.round=crypto.randomUUID();g.options=players.map(p=>p.name);
    // Anonymous credentials and opaque public-key roster contain no names.
    g.peers=players.map(p=>({id:p.id,key:p.key,gender:p.gender!})).sort((a,b)=>a.id.localeCompare(b.id));
    g.credentials=Object.fromEntries(l.players.map(p=>[p.anonymousAuth,p.id]));
    phase(g,'LOCK',now);
  }else if(action==='sealed'){
    if(g.phase!=='WRITE')return; // An accepted envelope may be retried after the mix begins.
    if(typeof data.envelope!=='string'||data.envelope.length<100||data.envelope.length>150000)throw new GameError('Your question could not be sent.');
    if(!g.sealed[id])g.sealed[id]=data.envelope;
  }else if(action==='mix'){
    if(g.phase!=='MIX'||g.peers[g.mix].id!==id||data.step!==g.mix)throw new GameError('The mix has moved on.',409);
    if(!Array.isArray(data.batch)||data.batch.length!==g.peers.length)throw new GameError('The private mix could not be verified.');
    if(g.mix===g.peers.length-1){g.questions=data.batch.map(sanitizeQuestion);g.batch=[];startQuestion(g,now);}
    else {if(data.batch.some(x=>typeof x!=='string'||x.length>150000))throw new GameError('The private mix could not be verified.');g.batch=data.batch as string[];g.mix++;g.phaseAt=now;}
  }else if(action==='commit'){
    if(g.phase!=='ANSWER'&&data.question===g.questions[g.index]?.id&&g.active.includes(id))return;
    if(g.phase!=='ANSWER'||now>=g.deadline)throw new GameError('Time is up.');
    const peer=g.peers.find(p=>p.id===id)!;const q=g.questions[g.index];
    if(data.question!==q.id||(q.audience!=='all'&&q.audience!==peer.gender))throw new GameError('This question is for another audience.');
    // There is deliberately no answer, option, plaintext vote or per-voter vector here.
    g.commits[id]=true;
  }else if(action==='masked'){
    if(g.phase!=='TALLY'||!g.active.includes(id)||data.question!==g.questions[g.index].id)throw new GameError('This tally has ended.',409);
    if(!Array.isArray(data.vector)||data.vector.length!==g.questions[g.index].options.length||data.vector.some(n=>!Number.isInteger(n)||(n as number)<0||(n as number)>4294967295))throw new GameError('The private tally could not be verified.');
    if(!g.masked[id])g.masked[id]=data.vector as number[];
  }else if(action==='next'){
    if(g.phase!=='RESULTS'||data.question!==g.questions[g.index].id)throw new GameError('The group has moved on.',409);g.next[id]=true;
  }else if(action==='lobby'){
    if(g.phase!=='COMPLETE')throw new GameError('Finish this round first.');
    l.players.forEach(p=>{p.gender=null;p.locked=false;p.ready=false;});Object.assign(g,freshGame());
  }else if(action==='leave'){
    if(!identity&&g.phase!=='COMPLETE')throw new GameError('You can leave after the round.');l.players=l.players.filter(x=>x.id!==id);if(l.host===id)l.host=l.players[0]?.id??'';
  }else throw new GameError('That action is unavailable.');
  tick(l,g,now);
}
export function view(code:string,revision:number,l:Lobby,g:Game,p:Player|null,anonymousId:string|null,now:number):View{
  const identity=g.phase==='LOBBY'||g.phase==='CHECK';const id=identity?p?.id:anonymousId;
  if(!id)throw new GameError('Your session has expired.',401);
  const me=identity?p:g.peers.find(x=>x.id===id);const admin=!identity&&!me&&g.credentials;
  const v:View={code,revision,phase:g.phase,round:g.round,serverNow:now,phaseAt:g.phaseAt,host:identity&&l.host===id,me:{id,gender:me?.gender??null,locked:identity?!!p?.locked:true,ready:identity?!!p?.ready:false,active:identity?!!p?.active:!!me}};
  if(identity){v.me.needsName=!!p?.needsName;v.players=l.players.map(x=>({id:x.id,name:x.name,gender:g.phase==='CHECK'?x.gender:null,locked:x.locked,ready:x.ready,host:x.id===l.host,active:x.active}));return v;}
  if(!me&&!admin)throw new GameError('Your session has expired.',401);
  v.peers=g.peers;v.options=g.options;
  if(g.phase==='WRITE')v.submitted=!!g.sealed[id];
  if(g.phase==='MIX'){v.mix=g.mix;if(g.peers[g.mix].id===id)v.batch=g.batch;}
  if(['ANSWER','TALLY','RESULTS'].includes(g.phase)){v.question=g.questions[g.index];v.index=g.index;v.total=g.questions.length;v.deadline=g.deadline;}
  if(g.phase==='ANSWER')v.committed=!!g.commits[id];
  if(g.phase==='TALLY'){v.active=g.active;v.tallied=!!g.masked[id];}
  if(g.phase==='RESULTS'){v.totals=g.totals;v.reason=g.reason;v.nextDone=!!g.next[id];v.nextRemaining=g.peers.length-count(g.next);}
  if(g.phase==='COMPLETE')v.reason=g.reason;
  return v;
}
