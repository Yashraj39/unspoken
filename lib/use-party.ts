'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Question, View } from './game-types';
import { clearSession, generateKey, loadSession, maskVote, mixQuestions, randomToken, saveSession, sealQuestion, type LocalSession } from './privacy';
export function useParty(){
  const [session,setSession]=useState<LocalSession|null>(null),[state,setState]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[connection,setConnection]=useState<'connected'|'reconnecting'|'offline'>('connected'),[boot,setBoot]=useState(true);
  const stateRef=useRef<View|null>(null),sessionRef=useRef<LocalSession|null>(null),worker=useRef(false),polling=useRef(false);
  const accept=useCallback((v:View)=>{if(!v?.phase)return;const previous=stateRef.current;if(previous?.code===v.code&&(v.revision<previous.revision||v.revision===previous.revision&&v.serverNow<previous.serverNow))return;const received={...v,clockOffset:v.serverNow-Date.now()};stateRef.current=received;setState(received);setConnection('connected');},[]);
  const keep=useCallback(async(s:LocalSession)=>{sessionRef.current=s;setSession(s);await saveSession(s);},[]);
  const request=useCallback(async(s:LocalSession,data?:Record<string,unknown>,force?:'lobby'|'anonymous'):Promise<View>=>{
    const phase=stateRef.current?.phase;const anonymous=force?force==='anonymous':phase?phase!=='LOBBY'&&phase!=='CHECK':false;
    const response=await fetch(data?'/api/game':`/api/game?code=${s.code}`,{method:data?'POST':'GET',headers:{'Authorization':`Bearer ${anonymous?s.anonymousToken:s.token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify({...data,code:s.code})}:{})});
    const v=await response.json() as View & {error?:string};if(!response.ok)throw Object.assign(new Error(v.error||'Try again in a moment.'),{status:response.status});return v;
  },[]);
  const sync=useCallback(async()=>{
    const s=sessionRef.current;if(!s||polling.current)return;polling.current=true;
    try{let v:View;try{v=await request(s);}catch(e){if((e as {status:number}).status!==401)throw e;const phase=stateRef.current?.phase;v=await request(s,undefined,phase&&phase!=='LOBBY'&&phase!=='CHECK'?'lobby':'anonymous');}accept(v);}
    catch(e){if((e as {status:number}).status===404){setError((e as Error).message);await clearSession();sessionRef.current=null;setSession(null);stateRef.current=null;setState(null);}else setConnection(navigator.onLine?'reconnecting':'offline');}
    finally{polling.current=false;}
  },[request,accept]);
  useEffect(()=>{let alive=true;loadSession().then(async s=>{if(s&&alive){sessionRef.current=s;setSession(s);await sync();}if(alive)setBoot(false);}).catch(()=>setBoot(false));return()=>{alive=false;};},[sync]);
  const partyCode=session?.code;
  useEffect(()=>{if(!partyCode)return;const timer=setInterval(sync,1000);const online=()=>sync();window.addEventListener('online',online);document.addEventListener('visibilitychange',online);return()=>{clearInterval(timer);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',online);};},[partyCode,sync]);
  const action=useCallback(async(action:string,data:Record<string,unknown>={})=>{
    const s=sessionRef.current;if(!s)return;setBusy(true);setError('');try{accept(await request(s,{action,...data}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  },[request,accept]);
  const enter=useCallback(async(name:string,code?:string)=>{
    setBusy(true);setError('');try{const kp=await generateKey();const s:LocalSession={code:code||'',token:randomToken(),anonymousToken:randomToken(),id:'',key:kp.privateKey,publicKey:kp.publicKey,choices:{},tallyScopes:{}};
      stateRef.current=null;const v=await request(s,{action:code?'join':'create',name,key:s.publicKey,anonymousToken:s.anonymousToken},'lobby');s.code=v.code;s.id=v.me.id;await keep(s);accept(v);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  },[request,keep,accept]);
  const submitQuestion=useCallback(async(q:Omit<Question,'id'>)=>{
    const s=sessionRef.current,v=stateRef.current;if(!s||!v?.peers||v.phase!=='WRITE')return;setBusy(true);setError('');
    try{const s2={...s,round:v.round,sealed:s.round===v.round?s.sealed:undefined};if(!s2.sealed)s2.sealed=await sealQuestion({...q,id:randomToken()},v.peers,v.round);await keep(s2);accept(await request(s2,{action:'sealed',envelope:s2.sealed}));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  },[keep,accept,request]);
  const vote=useCallback(async(option:number)=>{
    const s=sessionRef.current,v=stateRef.current;if(!s||v?.phase!=='ANSWER'||!v.question)return;setBusy(true);setError('');
    try{const q=v.question.id;const old=s.choices[q];const s2={...s,choices:{...s.choices,[q]:old??option}};await keep(s2);accept(await request(s2,{action:'commit',question:q}));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  },[keep,request,accept]);
  useEffect(()=>{
    const v=state;if(!v||worker.current)return;const s=sessionRef.current;if(!s)return;
    async function work(){if(!v||!s)return;worker.current=true;try{
      if(v.phase==='MIX'&&v.batch&&v.peers&&v.peers[v.mix!]?.id===s.id){const batch=await mixQuestions(v.batch,s.key,v.round,v.mix===v.peers.length-1);accept(await request(s,{action:'mix',step:v.mix,batch}));}
      if(v.phase==='TALLY'&&v.question&&v.active?.includes(s.id)&&!v.tallied&&v.peers){
        const q=v.question.id;const choice=s.choices[q];if(choice===undefined)return;
        const scope=JSON.stringify([...v.active].sort());if(s.tallyScopes[q]&&s.tallyScopes[q]!==scope)throw new Error('The tally changed. Your answer stays private.');
        const s2={...s,tallyScopes:{...s.tallyScopes,[q]:scope}};await keep(s2);
        const vector=await maskVote(s.key,s.id,v.peers,v.active,`${v.round}:${q}`,choice,v.question.options.length);
        accept(await request(s2,{action:'masked',question:q,vector}));
      }
      if(v.phase==='ANSWER'&&v.question&&!v.committed&&s.choices[v.question.id]!==undefined)accept(await request(s,{action:'commit',question:v.question.id}));
      if(v.phase==='WRITE'&&s.round===v.round&&s.sealed&&!v.submitted)accept(await request(s,{action:'sealed',envelope:s.sealed}));
      if((v.phase==='COMPLETE'||v.phase==='LOBBY')&&(Object.keys(s.choices).length||s.sealed))await keep({...s,sealed:undefined,question:undefined,choices:{},tallyScopes:{}});
    }catch(e){if((e as {status:number}).status!==409)setError((e as Error).message);}finally{worker.current=false;}}
    if(['MIX','TALLY','ANSWER','WRITE','COMPLETE','LOBBY'].includes(v.phase))void work();
  },[state,accept,keep,request]);
  const leave=useCallback(async()=>{if(['LOBBY','CHECK','COMPLETE'].includes(stateRef.current?.phase??''))await action('leave');await clearSession();sessionRef.current=null;stateRef.current=null;setSession(null);setState(null);setError('');},[action]);
  return {session,state,error,setError,busy,connection,boot,enter,action,submitQuestion,vote,leave};
}
