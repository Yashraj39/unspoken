import type { RoomStore } from './room-store';
import { freshGame, GameError, mutate, PARTY_TTL, tick, validateName, view } from './game-engine';
import type { Game, Lobby, Player } from './game-types';
async function hash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function json(x:unknown,status=200){return Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
function validateKey(key:unknown):JsonWebKey{const k=key as JsonWebKey;if(!k||k.kty!=='EC'||k.crv!=='P-256'||!k.x||!k.y||k.d)throw new GameError('Your device could not create a private session.');return {kty:k.kty,crv:k.crv,x:k.x,y:k.y,ext:true};}
async function makePlayer(data:Record<string,unknown>,auth:string):Promise<Player>{if(typeof data.anonymousToken!=='string'||data.anonymousToken.length!==43)throw new GameError('Your device could not create a private session.');return {id:crypto.randomUUID(),name:validateName(data.name),gender:null,locked:false,ready:false,active:true,seen:Date.now(),auth,anonymousAuth:await hash(data.anonymousToken),key:validateKey(data.key)};}
async function operate(request:Request,database:()=>Promise<RoomStore>,clock:()=>number){
  const now=clock();const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if(!token||token.length!==43)throw new GameError('Your session has expired.',401);
  const auth=await hash(token);const method=request.method;
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)throw new GameError('Open this party in its own tab.',403);
  let data:Record<string,unknown>={};
  if(method==='POST'){try{data=await request.json() as Record<string,unknown>;}catch{throw new GameError('That request could not be read.');}if(!data||typeof data!=='object'||Array.isArray(data))throw new GameError('That request could not be read.');}
  if(method==='POST'&&Number(request.headers.get('content-length')??0)>8500000)throw new GameError('That request is too large.',413);
  const db=await database();
  // Expired data is physically deleted on service activity. Idle rooms are inaccessible after TTL.
  await db.deleteExpired(now);
  if(data.action==='create'){
    const p=await makePlayer(data,auth);const l:Lobby={host:p.id,players:[p]};const g=freshGame();
    for(let attempt=0;attempt<10;attempt++){
      let v:number;do{v=crypto.getRandomValues(new Uint32Array(1))[0];}while(v>=4294800000);
      const code=String(100000+v%900000);
      const r=await db.create(code,now+PARTY_TTL,JSON.stringify(l),JSON.stringify(g));
      if(r)return json(view(code,0,l,g,p,null,now),201);
    }throw new GameError('Try creating your party again.',503);
  }
  const code=String(data.code??new URL(request.url).searchParams.get('code')??'');if(!/^\d{6}$/.test(code))throw new GameError('Enter the six-digit party code.');
  for(let attempt=0;attempt<8;attempt++){
    const row=await db.get(code,now);
    if(!row)throw new GameError('That party was not found, or has expired.',404);
    const l=JSON.parse(row.lobby) as Lobby;const g=JSON.parse(row.game) as Game;
    let p=l.players.find(p=>p.auth===auth)??null;let anon=g.credentials[auth]??null;
    if(data.action==='join'&&!p){
      if(g.phase!=='LOBBY')throw new GameError('This party has already started. Join the next round.',403);
      if(l.players.length>=50)throw new GameError('This party is full.');
      const n=validateName(data.name);if(l.players.some(p=>p.name.toLowerCase()===n.toLowerCase()))throw new GameError('That name is taken. Add an initial.');
      p=await makePlayer(data,auth);l.players.push(p);
    }else{
      const identity=g.phase==='LOBBY'||g.phase==='CHECK';
      // Old lobby credential cannot read or write any anonymous-round data.
      if(identity&&!p||!identity&&!anon)throw new GameError('Your session has expired.',401);
      if(p&&now-p.seen>10000)p.seen=now;
      if(anon){const lp=l.players.find(p=>p.id===anon);if(lp&&now-lp.seen>10000)lp.seen=now;}
      tick(l,g,now);
      if(method==='POST'&&data.action!=='join')mutate(l,g,p,anon,String(data.action),data,now);
    }
    const nextLobby=JSON.stringify(l),nextGame=JSON.stringify(g);
    if(row.lobby===nextLobby&&row.game===nextGame)return json(view(code,row.revision,l,g,p,anon,now));
    const saved=await db.replace(code,row.revision,nextLobby,nextGame);
    if(saved){
      // A phase-boundary response uses the matching credential on the next poll.
      if((g.phase==='LOBBY'||g.phase==='CHECK')&&!p&&anon)p=l.players.find(p=>p.id===anon)??null;
      if(g.phase!=='LOBBY'&&g.phase!=='CHECK'&&!anon&&p)anon=p.id;
      if(data.action==='leave'){if(!l.players.length)await db.remove(code,row.revision+1);return json({left:true});}
      return json(view(code,row.revision+1,l,g,p,anon,now));
    }
  }throw new GameError('The party is busy. Try again.',409);
}
export function createGameHandler(database:()=>Promise<RoomStore>,clock:()=>number=Date.now){
  return async function handle(request:Request):Promise<Response>{
    if(request.method!=='GET'&&request.method!=='POST')return json({error:'That method is unavailable.'},405);
    try{return await operate(request,database,clock);}
    catch(e){if(e instanceof GameError)return json({error:e.message},e.status);return json({error:'The party service is catching up. Please try again.'},503);}
  };
}
