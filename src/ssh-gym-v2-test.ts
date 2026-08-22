#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import {
  ACTUATION_PROFILES,
  OBSERVATION_PROFILES,
  RoundSafeFifo,
  SshGymV2,
  assertSshGymProvenance,
  normalizeGymInput,
} from './gym/ssh-gym-v2.js';
import {
  PINNED_ENGINE_VERSION,
  PINNED_ROSTER,
  PINNED_VENDOR_COMMIT,
  SSH_GYM_V2_IMPLEMENTATION_SHA256,
  SSH_GYM_V2_SCHEMA,
} from './gym/ssh-gym-v2-provenance.js';

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  checks++;
}

function state(value: object): any { return value; }

function stepUntilFight(gym: SshGymV2): void {
  for (let index = 0; index < 120; index++) {
    if (state(gym.state()).phase === 'fight') return;
    gym.step({ n: 1 });
  }
  throw new Error('fight did not begin within 120 frames');
}

function testProvenance(): void {
  const provenance = assertSshGymProvenance();
  check(provenance.schema === SSH_GYM_V2_SCHEMA, 'schema is pinned');
  check(provenance.implementationSha256 === SSH_GYM_V2_IMPLEMENTATION_SHA256,
    'implementation digest is non-self-referential and pinned');
  check(provenance.vendor.commit === PINNED_VENDOR_COMMIT && !provenance.vendor.dirty,
    'vendor commit is exact and clean');
  check(provenance.vendor.engineVersion === PINNED_ENGINE_VERSION, 'canonical engine version is imported');
  check(JSON.stringify(provenance.runtimeProfile.roster) === JSON.stringify(PINNED_ROSTER),
    'ordered roster is exact');
  check(provenance.runtimeProfile.canonicalDeployCommitAttested === false,
    'offline source profile does not claim live deploy attestation');
  check(provenance.runtimeProfile.stages.includes('dojo'), 'explicit dojo stage is available');
  check(['rushdown', 'poker', 'champion', 'zoner', 'grappler', 'hitrun', 'jumper', 'turtle']
    .every((name) => provenance.runtimeProfile.styles.includes(name)), 'v2 stress styles are present');

  const catalog = JSON.parse(readFileSync(resolve('roster/agents.json'), 'utf8')) as any;
  const gym = catalog.gyms?.find((entry: any) => entry.id === 'ssh-gym-v2');
  check(gym?.implementationSha256 === SSH_GYM_V2_IMPLEMENTATION_SHA256,
    'catalog pins the executable implementation');
  check(gym?.vendorCommit === PINNED_VENDOR_COMMIT && gym?.engineVersion === PINNED_ENGINE_VERSION,
    'catalog pins source and coarse engine version separately');
}

function testProfilesAndValidation(): void {
  const gym = new SshGymV2();
  const version = gym.version() as any;
  check(version.transportClaim === 'none-offline-exact-engine-only', 'version denies transport claim');
  check(JSON.stringify(version.runtimeProfile.observationProfiles) === JSON.stringify(OBSERVATION_PROFILES),
    'observation profiles are explicit');
  check(JSON.stringify(version.runtimeProfile.actuationProfiles) === JSON.stringify(ACTUATION_PROFILES),
    'actuation profiles are explicit');
  assert.throws(() => gym.state(), /reset first/); checks++;
  assert.throws(() => gym.reset({ a: 'NOPE', b: 'MEN', seed: 1, stage: 'dojo' }), /unknown fighter/); checks++;
  assert.throws(() => gym.reset({ a: 'BYU', b: 'MEN', seed: 1, stage: 'not-a-stage' }), /unknown stage/); checks++;
  assert.throws(() => gym.reset({
    a: 'BYU', b: 'MEN', seed: 1, stage: 'dojo', inputDelayA: 1,
  }), /requires zero input delays/); checks++;
  assert.throws(() => gym.reset({
    a: 'BYU', b: 'MEN', seed: 1, stage: 'dojo',
    actuationProfile: 'round-safe-fifo-v1', inputDelayA: 121,
  }), /0 to 120/); checks++;
}

function walkTrace(gym: SshGymV2, profile: 'bot-wire-v1' | 'engine-oracle-v1'): any {
  gym.reset({ a: 'BYU', b: 'MEN', seed: 7, stage: 'dojo', observationProfile: profile });
  return state(gym.step({ n: 95, inputsA: { moveX: 1 }, inputsB: { moveX: -1 } }).state);
}

function testWireProjectionAndDeterminism(): void {
  const gym = new SshGymV2();
  const originalRandom = Math.random;
  const wire1 = walkTrace(gym, 'bot-wire-v1');
  const wire2 = walkTrace(gym, 'bot-wire-v1');
  const oracle = walkTrace(gym, 'engine-oracle-v1');
  check(JSON.stringify(wire1) === JSON.stringify(wire2), 'same seed/stage trace is deterministic');
  check(Number.isInteger(wire1.a.x) && Number.isInteger(wire1.a.vx), 'wire fighter kinematics are rounded');
  check(!('phaseT' in wire1.a) && 'phaseT' in oracle.a, 'oracle-only state does not leak onto wire profile');
  check(oracle.a.x !== wire1.a.x, 'oracle retains full-precision position');
  check(Math.random === originalRandom, 'seeded environment does not replace host global RNG');
}

function testRoundSafeDelay(): void {
  const fifo = new RoundSafeFifo(2);
  const kick = normalizeGymInput({ kick: true, motion: 'DR' });
  check(!fifo.emit(kick, 'fight').kick, 'delay frame one is neutral');
  check(!fifo.emit(kick, 'fight').kick, 'delay frame two is neutral');
  check(fifo.emit(kick, 'fight').kick, 'delay frame three emits first edge');
  check(!fifo.emit(kick, 'round-over').kick, 'round-over clears and suppresses edge');
  check(!fifo.emit(normalizeGymInput({}), 'fight').kick, 'new round cannot receive stale edge');

  const gym = new SshGymV2();
  gym.reset({
    a: 'BYU', b: 'MEN', seed: 9, stage: 'dojo',
    actuationProfile: 'round-safe-fifo-v1', inputDelayA: 2, inputDelayB: 0,
  });
  stepUntilFight(gym);
  const one = gym.step({ inputsA: { kick: true } });
  const two = gym.step({ inputsA: { kick: true } });
  const three = gym.step({ inputsA: { kick: true } });
  check(!one.appliedA.kick && !two.appliedA.kick && three.appliedA.kick,
    'environment applies declared two-frame FIFO exactly');
}

function testStylesAndFullMatchHorizon(): void {
  const gym = new SshGymV2();
  gym.reset({ a: 'BYU', b: 'MEN', seed: 1, stage: 'dojo' });
  assert.throws(() => gym.step({ inputsA: {}, styleA: 'champion' }), /fixed inputs or a style/); checks++;
  assert.throws(() => gym.step({ styleA: 'not-a-style' }), /unknown gym style/); checks++;
  assert.throws(() => gym.step({ n: 10001 }), /1\.\.10000/); checks++;

  let current = state(gym.step({ n: 1800, styleA: 'champion', styleB: 'champion' }).state);
  check(current.phase !== 'match-over', 'frame 1800 is not silently treated as a match outcome');
  let frames = 1800;
  while (current.phase !== 'match-over' && frames < 12000) {
    current = state(gym.step({ n: 1, styleA: 'champion', styleB: 'champion' }).state);
    frames++;
  }
  check(current.phase === 'match-over' && frames > 1800,
    'authoritative full match completes beyond diagnostic horizon');
}

async function testJsonlCli(): Promise<void> {
  const child = spawn(resolve('node_modules/.bin/tsx'), ['src/tools/ssh-gym-v2.ts'], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = createInterface({ input: child.stdout });
  const iterator = output[Symbol.asyncIterator]();
  const rpc = async (payload: string): Promise<any> => {
    child.stdin.write(`${payload}\n`);
    const next = await iterator.next();
    if (next.done) throw new Error('gym CLI closed before replying');
    return JSON.parse(next.value);
  };
  check((await rpc('{"cmd":"ping"}')).pong === true, 'CLI responds to ping');
  check((await rpc('{"cmd":"version"}')).schema === SSH_GYM_V2_SCHEMA, 'CLI reports reviewed version');
  check((await rpc('[]')).ok === false, 'CLI rejects non-object JSON');
  check((await rpc('{')).ok === false, 'CLI reports malformed JSON without crashing');
  check((await rpc(JSON.stringify({ cmd: 'ping', pad: 'x'.repeat(65536) }))).ok === false,
    'CLI bounds input lines');
  child.stdin.end();
  const [code] = await once(child, 'exit') as [number | null];
  check(code === 0, 'CLI exits cleanly');
}

function testOwnershipBoundary(): void {
  const source = [
    readFileSync('src/gym/ssh-gym-v2.ts', 'utf8'),
    readFileSync('src/tools/ssh-gym-v2.ts', 'utf8'),
  ].join('\n');
  check(!/node:(?:net|http|https|tls)|from ['"]ssh2|joinLounge|acceptChallenge|['"]queue['"]/.test(source),
    'offline Gym imports no network/live-match surface');
  check(!/checkpoint|torch|transformers/i.test(source), 'Gym remains model-framework independent');
}

async function main(): Promise<void> {
  testProvenance();
  testProfilesAndValidation();
  testWireProjectionAndDeterminism();
  testRoundSafeDelay();
  testStylesAndFullMatchHorizon();
  testOwnershipBoundary();
  await testJsonlCli();
  console.log(`SSH GYM V2 TEST: PASS (${checks} checks)`);
}

await main();
