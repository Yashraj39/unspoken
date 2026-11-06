// All private keys, plaintext drafts and chosen answers stay in this browser.
// The relay receives padded onion ciphertexts, acknowledgements and masked sums.
import type { Peer, Question } from './game-types';
const enc = new TextEncoder();
const dec = new TextDecoder();
export type PrivateKey = CryptoKey | Uint8Array;
const b64 = (b: ArrayBuffer | Uint8Array) => { const a=new Uint8Array(b); let s='';for(const v of a)s+=String.fromCharCode(v);return btoa(s); };
const unb64 = (s:string) => Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function randomToken(){return b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function shuffle<T>(input:T[]):T[]{const a=[...input];for(let i=a.length-1;i>0;i--){const limit=Math.floor(4294967296/(i+1))*(i+1);let v;do{v=crypto.getRandomValues(new Uint32Array(1))[0];}while(v>=limit);const j=v%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
// Use native Web Crypto on HTTPS. The same primitives have a lazy-loaded,
// device-only Noble implementation for environments without SubtleCrypto.
export async function generateKey():Promise<{privateKey:PrivateKey;publicKey:JsonWebKey}>{
  if(crypto.subtle){const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);const k=await crypto.subtle.exportKey('jwk',kp.publicKey);return {privateKey:kp.privateKey,publicKey:{kty:'EC',crv:'P-256',x:k.x,y:k.y,ext:true}};}
  const {p256}=await import('@noble/curves/p256');const secret=p256.utils.randomPrivateKey();const pub=p256.getPublicKey(secret,false);
  const url=(x:Uint8Array)=>b64(x).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  return {privateKey:secret,publicKey:{kty:'EC',crv:'P-256',x:url(pub.slice(1,33)),y:url(pub.slice(33,65)),ext:true}};
}
async function shared(privateKey:PrivateKey,publicKey:JsonWebKey):Promise<Uint8Array>{
  if(privateKey instanceof Uint8Array){const {p256}=await import('@noble/curves/p256');const x=unb64(publicKey.x!.replaceAll('-','+').replaceAll('_','/')),y=unb64(publicKey.y!.replaceAll('-','+').replaceAll('_','/'));const pub=new Uint8Array(65);pub[0]=4;pub.set(x,1);pub.set(y,33);return p256.getSharedSecret(privateKey,pub,false).slice(1,33);}
  const pub=await crypto.subtle.importKey('jwk',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);return new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:pub},privateKey,256));
}
async function derive(secret:Uint8Array,salt:Uint8Array,info:Uint8Array,length:number):Promise<Uint8Array>{
  if(!crypto.subtle){const [{hkdf},{sha256}]=await Promise.all([import('@noble/hashes/hkdf'),import('@noble/hashes/sha256')]);return hkdf(sha256,secret,salt,info,length);}
  const material=await crypto.subtle.importKey('raw',new Uint8Array(secret),'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(salt),info:new Uint8Array(info)},material,length*8));
}
async function cipher(secret:Uint8Array,iv:Uint8Array,bytes:Uint8Array,decrypt=false):Promise<Uint8Array>{
  if(!crypto.subtle){const {gcm}=await import('@noble/ciphers/aes');return decrypt?gcm(secret,iv).decrypt(bytes):gcm(secret,iv).encrypt(bytes);}
  const key=await crypto.subtle.importKey('raw',new Uint8Array(secret),{name:'AES-GCM'},false,['encrypt','decrypt']);return new Uint8Array(await crypto.subtle[decrypt?'decrypt':'encrypt']({name:'AES-GCM',iv:new Uint8Array(iv)},key,new Uint8Array(bytes)));
}
async function aes(privateKey:PrivateKey,publicKey:JsonWebKey,scope:string){return derive(await shared(privateKey,publicKey),enc.encode(scope),enc.encode('unspoken-question-v1'),32);}
// Binary layers grow by 92 bytes per device; base64 is applied only at the
// transport boundary. Nested base64/JSON would grow exponentially in large rooms.
const url64=(a:Uint8Array)=>b64(a).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const coordinate=(s:string)=>unb64(s.replaceAll('-','+').replaceAll('_','/'));
async function wrap(message:Uint8Array,peer:Peer,round:string){
  const kp=await generateKey(),key=await aes(kp.privateKey,peer.key,round),iv=crypto.getRandomValues(new Uint8Array(12));
  const body=await cipher(key,iv,message),out=new Uint8Array(76+body.length);
  out.set(coordinate(kp.publicKey.x!),0);out.set(coordinate(kp.publicKey.y!),32);out.set(iv,64);out.set(body,76);return out;
}
export async function sealQuestion(q:Question,peers:Peer[],round:string){
  const bytes=enc.encode(JSON.stringify(q));if(bytes.length>8188)throw new Error('That question is too long.');
  const padded=crypto.getRandomValues(new Uint8Array(8192));new DataView(padded.buffer).setUint32(0,bytes.length);padded.set(bytes,4);
  let message:Uint8Array=padded;for(let i=peers.length-1;i>=0;i--)message=await wrap(message,peers[i],round);return b64(message);
}
export async function mixQuestions(batch:string[],privateKey:PrivateKey,round:string,last:boolean){
  const out=await Promise.all(batch.map(async s=>{
    const x=unb64(s);if(x.length<92)throw new Error('The private mix could not be verified.');
    const publicKey:JsonWebKey={kty:'EC',crv:'P-256',x:url64(x.slice(0,32)),y:url64(x.slice(32,64)),ext:true};
    const key=await aes(privateKey,publicKey,round);return cipher(key,x.slice(64,76),x.slice(76),true);
  }));
  return shuffle(out).map(p=>{if(!last)return b64(p);const size=new DataView(p.buffer,p.byteOffset,p.byteLength).getUint32(0);if(size>p.length-4)throw new Error('The private mix could not be verified.');return JSON.parse(dec.decode(p.slice(4,4+size)));});
}
export async function maskVote(privateKey:PrivateKey,id:string,peers:Peer[],active:string[],scope:string,option:number,size:number){
  if(active.length<3)throw new Error('Too few answers for a private tally.');
  const vector=new Uint32Array(size);vector[option]=1;
  // A pair derives the same mask; one adds it and the other subtracts it.
  // Individual vectors look random. Only the sum cancels every pairwise mask.
  const members=peers.filter(p=>active.includes(p.id));
  const context=enc.encode(`unspoken-ballot-v1:${scope}:${[...active].sort().join(',')}`);
  await Promise.all(members.filter(p=>p.id!==id).map(async p=>{
    const secret=await shared(privateKey,p.key);
    const bits=await derive(secret,context,enc.encode('pairwise-mask'),size*4);
    const bytes=new DataView(bits.buffer,bits.byteOffset,bits.byteLength);
    for(let j=0;j<size;j++){const m=bytes.getUint32(j*4);vector[j]=(vector[j]+(id<p.id?m:-m))>>>0;}
  }));return Array.from(vector);
}
export type LocalSession = {code:string; token:string; anonymousToken:string; id:string; key:PrivateKey; publicKey:JsonWebKey; gender?:string; round?:string; question?:string; sealed?:string; choices:Record<string,number>; tallyScopes:Record<string,string>};
// Optional local profile isolates multiple people using one browser. It does
// not alter the relay, add players, or simulate any part of the game.
async function db(){const profile=new URLSearchParams(location.search).get('profile')?.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32)||'default';return new Promise<IDBDatabase>((res,rej)=>{const r=indexedDB.open(`unspoken-device-v1-${profile}`,1);r.onupgradeneeded=()=>r.result.createObjectStore('session');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function loadSession(){const d=await db();return new Promise<LocalSession|undefined>((res,rej)=>{const r=d.transaction('session').objectStore('session').get('current');r.onsuccess=()=>{d.close();res(r.result);};r.onerror=()=>rej(r.error);});}
export async function saveSession(s:LocalSession){const d=await db();return new Promise<void>((res,rej)=>{const t=d.transaction('session','readwrite');t.objectStore('session').put(s,'current');t.oncomplete=()=>{d.close();res();};t.onerror=()=>rej(t.error);});}
export async function clearSession(){const d=await db();return new Promise<void>(res=>{const t=d.transaction('session','readwrite');t.objectStore('session').clear();t.oncomplete=()=>{d.close();res();};});}
