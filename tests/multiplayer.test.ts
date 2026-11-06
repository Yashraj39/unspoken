import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createGameHandler } from '../lib/game-service';
import { RoomStore } from '../lib/room-store';
import { generateKey, maskVote, mixQuestions, randomToken, sealQuestion } from '../lib/privacy';
import type { View } from '../lib/game-types';

// Actual PostgreSQL SQL runs in a temporary in-memory PGlite engine.
// No hosted database, production rooms, credentials or external network are used.
const pg = new PGlite();
const store = new RoomStore(async (statement, parameters = []) => {
  const result = await pg.query(statement, parameters);
  return result.rows as Record<string, unknown>[];
});
await store.initialize();
let now = Date.now();
const handle = createGameHandler(async () => store, () => now);
const keys = await Promise.all(Array.from({ length: 4 }, () => generateKey()));
const devices = keys.map((key, i) => ({ key, token: randomToken(), anonymousToken: randomToken(),
  id: '', code: '', name: ['Yash', 'Dev', 'Aarav', 'Meera'][i], state: null as View | null }));
type Device = typeof devices[number];

async function request(device: Device, data?: Record<string, unknown>, anonymous?: boolean): Promise<Response> {
  const useAnonymous = anonymous ?? (!!device.state && !['LOBBY', 'CHECK'].includes(device.state.phase));
  const headers = { Authorization: `Bearer ${useAnonymous ? device.anonymousToken : device.token}`,
    Origin: 'https://game.example', ...(data ? { 'Content-Type': 'application/json' } : {}) };
  return handle(new Request(`https://game.example/api/game${data ? '' : `?code=${device.code}`}`, {
    method: data ? 'POST' : 'GET', headers,
    ...(data ? { body: JSON.stringify({ ...data, code: device.code }) } : {}),
  }));
}

async function send(device: Device, data?: Record<string, unknown>): Promise<View> {
  let response = await request(device, data);
  if (response.status === 401) {
    const oldAnonymous = !!device.state && !['LOBBY', 'CHECK'].includes(device.state.phase);
    response = await request(device, data, !oldAnonymous);
  }
  const body = await response.json();
  assert(response.ok, `Action ${String(data?.action || 'sync')} failed (${response.status}): ${body.error || ''}`);
  if (body.phase) device.state = body as View;
  return body as View;
}

async function syncAll(): Promise<void> { await Promise.all(devices.map(device => send(device))); }
function everyone(phase: View['phase']): void { assert(devices.every(device => device.state?.phase === phase)); }
async function stateInDatabase() {
  const row = await store.get(devices[0].code, now);
  assert(row);
  return { row, lobby: JSON.parse(row.lobby), game: JSON.parse(row.game) };
}

assert.equal((await handle(new Request('https://game.example/api/game'))).status, 401);
assert.equal((await handle(new Request('https://game.example/api/game', { method: 'DELETE' }))).status, 405);
const crossOrigin = await handle(new Request('https://game.example/api/game', {
  headers: { Origin: 'https://other.example', Authorization: `Bearer ${devices[0].token}` },
}));
assert.equal(crossOrigin.status, 403);

const host = devices[0];
await send(host, { action: 'create', name: host.name, key: host.key.publicKey, anonymousToken: host.anonymousToken });
assert.match(host.state!.code, /^\d{6}$/);
host.code = host.state!.code;
host.id = host.state!.me.id;
for (const device of devices.slice(1)) {
  device.code = host.code;
  await send(device, { action: 'join', name: device.name, key: device.key.publicKey, anonymousToken: device.anonymousToken });
  device.id = device.state!.me.id;
}
await syncAll();
everyone('LOBBY');
assert.equal(host.state!.players!.length, 4);

// Repeated joins are idempotent and do not add duplicate players.
await send(devices[1], { action: 'join', name: devices[1].name, key: devices[1].key.publicKey, anonymousToken: devices[1].anonymousToken });
assert.equal(devices[1].state!.players!.length, 4);
await Promise.all(devices.map(device => send(device, { action: 'gender', gender: 'male' })));
await send(host, { action: 'check' });
await syncAll();
everyone('CHECK');
assert((await request(devices[1], { action: 'reset' })).status >= 400);
await send(host, { action: 'reset' });
await syncAll();
everyone('LOBBY');
assert(host.state!.players!.every(player => !player.locked));
for (const [i, device] of devices.entries()) {
  await send(device, { action: 'name', name: device.name });
  await send(device, { action: 'gender', gender: i === 3 ? 'female' : 'male' });
}
await send(host, { action: 'check' });
await syncAll();
assert.equal(host.state!.players!.find(player => player.id === devices[3].id)?.name, 'Meera');
assert.equal(host.state!.players!.find(player => player.id === devices[3].id)?.gender, 'female');
await Promise.all(devices.map(device => send(device, { action: 'ready' })));
await send(host, { action: 'lock' });
await syncAll();
everyone('LOCK');
assert(devices.every(device => !device.state!.players && !device.state!.host));
assert.equal((await request(host, undefined, false)).status, 401);
assert((await request(host, { action: 'reset' }, true)).status >= 400);
now += 3300;
await syncAll();
everyone('WRITE');

const questions = devices.map((device, i) => ({
  id: randomToken(), text: `Which snack should we order for party number ${i + 1}?`,
  options: ['Pizza', 'Dosa', 'Momos', 'Pasta'], audience: 'all' as const,
}));
const envelopes = await Promise.all(devices.map((device, i) =>
  sealQuestion(questions[i], device.state!.peers!, device.state!.round)));
await send(host, { action: 'sealed', envelope: envelopes[0] });
const encrypted = await stateInDatabase();
assert(!questions.some(question => encrypted.row.game.includes(question.text)));
await Promise.all(devices.slice(1).map((device, i) => send(device, { action: 'sealed', envelope: envelopes[i + 1] })));
await syncAll();
everyone('MIX');

for (let step = 0; step < 4; step++) {
  const current = devices[0].state!;
  const device = devices.find(device => device.id === current.peers![current.mix!].id)!;
  const mine = await send(device);
  assert(mine.batch);
  const batch = await mixQuestions(mine.batch, device.key.privateKey, mine.round, step === 3);
  await send(device, { action: 'mix', step, batch });
  await syncAll();
}
everyone('ANSWER');
const shuffled = await stateInDatabase();
assert.equal(shuffled.game.questions.length, 4);
assert.deepEqual(shuffled.game.sealed, {});
assert.deepEqual(shuffled.game.batch, []);
for (const question of shuffled.game.questions) {
  assert.deepEqual(Object.keys(question).sort(), ['audience', 'id', 'options', 'text']);
}

for (let index = 0; index < 4; index++) {
  everyone('ANSWER');
  const question = devices[0].state!.question!;
  assert.equal(devices[0].state!.index, index);
  assert(devices.every(device => device.state!.question!.id === question.id));
  const choices = devices.map((_, i) => (i + index % 2) % 3);
  await Promise.all(devices.map(device => send(device, { action: 'commit', question: question.id })));
  await syncAll();
  everyone('TALLY');
  assert(devices.every(device => !('commits' in device.state!) && !('masked' in device.state!)));
  const vectors = await Promise.all(devices.map((device, i) => maskVote(
    device.key.privateKey, device.id, device.state!.peers!, device.state!.active!,
    `${device.state!.round}:${question.id}`, choices[i], question.options.length,
  )));
  await send(host, { action: 'masked', question: question.id, vector: vectors[0] });
  const inFlight = await stateInDatabase();
  assert(Object.values(inFlight.game.masked).every(vector => Array.isArray(vector) && vector.some((n: number) => n > 100000)));
  assert(!('votes' in inFlight.game) && !('answers' in inFlight.game));
  await Promise.all(devices.slice(1).map((device, i) => send(device, {
    action: 'masked', question: question.id, vector: vectors[i + 1],
  })));
  await syncAll();
  everyone('RESULTS');
  const expected = question.options.map((_, option) => choices.filter(choice => choice === option).length);
  assert(devices.every(device => JSON.stringify(device.state!.totals) === JSON.stringify(expected)));
  const result = await stateInDatabase();
  assert.deepEqual(result.game.masked, {});
  assert.deepEqual(result.game.commits, {});
  assert(devices.every(device => !('masked' in device.state!) && !('commits' in device.state!)));
  await Promise.all(devices.map(device => send(device, { action: 'next', question: question.id })));
  await syncAll();
}
everyone('COMPLETE');
const completed = await stateInDatabase();
assert.deepEqual(completed.game.questions, []);
assert.deepEqual(completed.game.masked, {});
assert.equal(completed.game.totals, null);
await send(host, { action: 'lobby' });
await syncAll();
everyone('LOBBY');

// Stale writes cannot overwrite a newer room state.
const latest = await stateInDatabase();
const updates = await Promise.all([
  store.replace(host.code, latest.row.revision, latest.row.lobby, latest.row.game),
  store.replace(host.code, latest.row.revision, latest.row.lobby, latest.row.game),
]);
assert.equal(updates.filter(Boolean).length, 1);
await pg.query('UPDATE rooms SET expires = $1 WHERE code = $2', [now - 1, host.code]);
assert.equal((await request(host)).status, 404);
const remaining = await pg.query('SELECT count(*)::int AS count FROM rooms');
assert.equal((remaining.rows[0] as { count: number }).count, 0);
await pg.close();
console.log('Passed: four independent device sessions, PostgreSQL storage, create/join, setup correction, gender check, anonymity lock, encrypted questions, four mixes, four answer/result cycles, return to lobby, atomic updates and expiry cleanup.');
