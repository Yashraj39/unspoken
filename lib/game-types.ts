export type Gender = 'male' | 'female';
export type Phase = 'LOBBY' | 'CHECK' | 'LOCK' | 'WRITE' | 'MIX' | 'ANSWER' | 'TALLY' | 'RESULTS' | 'COMPLETE';
export type Peer = { id: string; key: JsonWebKey; gender: Gender };
export type Question = { id: string; text: string; options: string[]; audience: 'all' | Gender };
export type Player = { id: string; name: string; needsName?: boolean; gender: Gender | null; locked: boolean; ready: boolean; key: JsonWebKey; auth: string; anonymousAuth: string; active: boolean; seen: number };
export type Game = {
  phase: Phase; round: string; peers: Peer[]; credentials: Record<string,string>;
  options: string[]; sealed: Record<string,string>; batch: string[]; mix: number;
  questions: Question[]; index: number; deadline: number; commits: Record<string,boolean>;
  active: string[]; masked: Record<string,number[]>; totals: number[] | null;
  reason: string | null; next: Record<string,boolean>; phaseAt: number;
};
export type Lobby = { host: string; players: Player[] };
export type View = {
  code: string; revision: number; phase: Phase; round: string; serverNow: number; clockOffset?: number;
  host: boolean; me: { id: string; gender: Gender | null; locked: boolean; ready: boolean; active: boolean; needsName?: boolean };
  players?: { id:string; name:string; gender:Gender|null; locked:boolean;ready:boolean;host:boolean;active:boolean }[];
  peers?: Peer[]; options?: string[]; mix?: number; batch?: string[];
  submitted?: boolean; question?: Question; index?:number; total?:number; deadline?:number;
  committed?:boolean; active?:string[]; tallied?:boolean; totals?:number[]|null; reason?:string|null;
  nextDone?:boolean; nextRemaining?:number; phaseAt:number;
};
