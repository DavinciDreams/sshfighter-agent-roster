#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

import { botApiSchema } from '../vendor/sshfighter-sf8/src/api/bot-schema.js';
import { botStateFor } from '../vendor/sshfighter-sf8/src/api/bot-server.js';
import { makeFighter, makeMatch, stepMatch } from '../vendor/sshfighter-sf8/src/game/engine.js';
import { emptyInputs, type Inputs } from '../vendor/sshfighter-sf8/src/game/types.js';
import {
  RoundSafeSnapshotFifo, SshGymV3, canonicalJson, normalizeSnapshotInput,
  validateAgainstSchema, assertSshGymV3Provenance,
} from './gym/ssh-gym-v3.js';
import {
  PINNED_BOT_PROTOCOL, PINNED_BUILD, PINNED_SCHEMA_SHA256,
  SSH_GYM_V3_IMPLEMENTATION_SHA256, SSH_GYM_V3_SCHEMA,
} from './gym/ssh-gym-v3-provenance.js';

let checks = 0;
const check = (condition: unknown, message: string): void => { assert(condition, message); checks++; };
const neutral = (): Inputs => emptyInputs();
const move = (motion: string, button: 'punch' | 'kick'): Inputs => ({ ...emptyInputs(), motion, [button]: true });

const provenance = assertSshGymV3Provenance();
check(provenance.schema === SSH_GYM_V3_SCHEMA
  && provenance.implementationSha256 === SSH_GYM_V3_IMPLEMENTATION_SHA256,
'Gym v3 executable digest is exact and non-self-referential');
check(provenance.vendor.build === PINNED_BUILD && provenance.vendor.botProtocol === PINNED_BOT_PROTOCOL,
'Gym v3 pins exact sf-8 build and protocol 2');
check(provenance.vendor.schemaSha256 === PINNED_SCHEMA_SHA256
  && createHash('sha256').update(canonicalJson(botApiSchema())).digest('hex') === PINNED_SCHEMA_SHA256,
'canonical machine-readable bot schema digest recomputes exactly');

const snapshot = normalizeSnapshotInput({ moveX: 1, punch: true });
check(snapshot.moveX === 1 && snapshot.punch && !snapshot.kick && !snapshot.down && snapshot.motion === 'N',
'snapshot normalization resets every omitted field');
assert.throws(() => normalizeSnapshotInput({ moveX: 2 }), /moveX/); checks++;
assert.throws(() => normalizeSnapshotInput({ motion: 'Q' }), /motion/); checks++;
const fifo = new RoundSafeSnapshotFifo(2);
check(!fifo.emit(normalizeSnapshotInput({ kick: true }), 'fight').kick
  && !fifo.emit(normalizeSnapshotInput({ kick: true }), 'fight').kick
  && fifo.emit(normalizeSnapshotInput({ kick: true }), 'fight').kick,
'synthetic delay is an explicit snapshot FIFO');
check(!fifo.emit(normalizeSnapshotInput({ kick: true }), 'round-over').kick,
'round boundary clears delayed edge inputs');

const gym = new SshGymV3();
const reset = gym.reset({ a: 'BLANKO', b: 'MEGAWATTS', seed: 17, stage: 'dojo' }) as any;
check(reset.profile === 'bot-protocol-v2' && reset.a.you.character === 'BLANKO'
  && reset.a.opp.character === 'MEGAWATTS' && reset.b.you.character === 'MEGAWATTS'
  && reset.b.opp.character === 'BLANKO', 'both seats receive self-contained perspective-local fighter identity');
check(reset.a.frame === reset.b.frame && reset.a.ack === 0 && reset.b.ack === 0,
'both perspectives bind the same authoritative state with independent ACK fields');
check(reset.a.you.facing === 1 && reset.a.opp.facing === -1
  && reset.b.you.facing === -1 && reset.b.opp.facing === 1,
'initial seats face inward and each perspective preserves authoritative facing for motion mirroring');
const after = gym.step({ n: 95, inputsA: { moveX: 1 }, inputsB: { moveX: -1 } }) as any;
check(after.state.a.phase === 'fight' && after.state.a.ack === 95 && after.state.b.ack === 95,
'one snapshot per simulated state advances authoritative ACKs');
validateAgainstSchema(after.state.a, (botApiSchema() as any).serverMessages.state, botApiSchema()); checks++;
validateAgainstSchema(after.state.b, (botApiSchema() as any).serverMessages.state, botApiSchema()); checks++;

const detailed = makeMatch(makeFighter('a', 'MNEME', 'a'), makeFighter('b', 'XENON', 'b'));
for (let index = 0; index < 95; index++) stepMatch(detailed, neutral(), neutral());
detailed.a.x = 70; detailed.b.x = 180; detailed.a.facing = 1; detailed.b.facing = -1;
stepMatch(detailed, move('DL', 'punch'), neutral());
for (let index = 0; index < 45 && !detailed.projectiles.some((p) => p.parentId); index++)
  stepMatch(detailed, neutral(), neutral());
const seatA = botStateFor('a', detailed, 12) as any;
const seatB = botStateFor('b', detailed, 19) as any;
const turret = seatA.projectiles.find((p: any) => p.style === 'construct');
const moteA = seatA.projectiles.find((p: any) => p.parentId === turret?.id);
const moteB = seatB.projectiles.find((p: any) => p.id === moteA?.id);
check(turret?.state === 'turret' && turret.dangerous === false && turret.canHit === false
  && Number.isInteger(turret.id) && turret.nextFireIn !== null,
'protocol 2 exposes stable turret lifecycle and danger semantics');
check(moteA?.sourceAttack === 'construct' && moteA.parentId === turret.id
  && moteA.ownedBy === 'you' && moteB?.ownedBy === 'opponent',
'projectile parentage and perspective-local ownership agree across seats');
check([seatA.you.x, seatA.you.y, seatA.you.vx, seatA.you.vy, moteA.x, moteA.y, moteA.vx, moteA.vy]
  .every((value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8),
'fighter and projectile kinematics are 0.01-quantized');
check(typeof seatA.you.actionable === 'boolean' && typeof seatA.you.blocking === 'boolean'
  && typeof seatA.you.invulnerable === 'boolean' && typeof seatA.you.armored === 'boolean'
  && ['neutral', 'startup', 'active', 'recovery'].includes(seatA.you.movePhase),
'actionability, guard, invulnerability, armor, and move phase are live-observable');
validateAgainstSchema(seatA, (botApiSchema() as any).serverMessages.state, botApiSchema()); checks++;
validateAgainstSchema(seatB, (botApiSchema() as any).serverMessages.state, botApiSchema()); checks++;

const oracleGym = new SshGymV3();
const oracle = oracleGym.reset({
  a: 'BLANKO', b: 'MEGAWATTS', seed: 17, stage: 'dojo', observationProfile: 'engine-oracle-v1',
}) as any;
check(oracle.a.name === 'BLANKO' && 'phaseT' in oracle.a && !('you' in oracle),
'engine oracle stays explicitly separate from the live-observable profile');

const child = spawn('node_modules/.bin/tsx', ['src/tools/ssh-gym-v3.ts'], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout });
const iterator = lines[Symbol.asyncIterator]();
const rpc = async (message: object): Promise<any> => {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  const next = await iterator.next();
  if (next.done) throw new Error('Gym v3 CLI exited early');
  return JSON.parse(next.value);
};
check((await rpc({ cmd: 'ping' })).pong === true, 'JSONL Gym v3 responds to ping');
check((await rpc({ cmd: 'version' })).schema === SSH_GYM_V3_SCHEMA, 'JSONL Gym v3 reports exact provenance');
check((await rpc({ cmd: 'schema' })).schema.protocolVersion === 2, 'JSONL Gym v3 exposes canonical protocol schema');
child.stdin.end();
const [code] = await once(child, 'exit') as [number | null];
check(code === 0, 'JSONL Gym v3 exits cleanly');

console.log(`SSH GYM V3 TEST: PASS (${checks} checks)`);
