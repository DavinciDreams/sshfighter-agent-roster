#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_FINGERPRINT, HANDLE, PINNED_ROSTER, createOneMatchController,
} from './tools/codex-dgx-omega-quickmatch.mjs';
import {
  DURABLE_PROFILES, STATIC_ROUTER_HF_REVISION, STATIC_ROUTER_WEIGHT_SHA256,
  createStaticGymPolicy, staticProfile,
} from './policies/static-router-gym.mjs';
import {
  DEFAULT_HANDLE, parseArgs as parseQuickArgs, run as runQuick, transientQueueError, validateOfficial,
} from './tools/static-router-quickmatch.mjs';
import {
  acquireSupervisorLock, parseArgs as parseSupervisorArgs, runSupervisor,
} from './tools/durable-quickmatch-supervisor.mjs';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const rejects = async (promise, pattern) => {
  try { await promise; return false; } catch (error) { return pattern.test(String(error)); }
};

check(DURABLE_PROFILES.map((p) => `${p.character}:${p.policy}`).join(',')
  === 'BYU:jumper,GYLE:jumper,MNEME:zoner', 'frozen durable profile order');
check(/^[0-9a-f]{64}$/.test(STATIC_ROUTER_WEIGHT_SHA256)
  && /^[0-9a-f]{40}$/.test(STATIC_ROUTER_HF_REVISION), 'frozen evidence hashes');
check(staticProfile('static-mneme-zoner').cleanPointsRate === 0.9935, 'MNEME evidence metadata');
assert.throws(() => staticProfile('unknown'), /unknown durable/); checks++;

const catalog = JSON.parse(readFileSync(resolve(sourceRoot, '../roster/agents.json'), 'utf8'));
const omegaCatalog = catalog.runners.find((row) => row.id === 'omega-control-v1-quickmatch');
const megaCatalog = catalog.runners.find((row) => row.agent === 'MEGA');
const sharedTransportHash = sha256File(resolve(sourceRoot, 'tools/codex-dgx-omega-quickmatch.mjs'));
check(omegaCatalog?.runnerSourceSha256 === sharedTransportHash, 'OMEGA catalog pins shared transport bytes');
check(megaCatalog?.sharedTransportSha256 === sharedTransportHash, 'MEGA catalog pins shared transport bytes');
check(megaCatalog?.handle === 'MEGA_BOT'
  && megaCatalog?.expectedFingerprint === 'SHA256:NoCiA/EN3QjY4iBoGRjExbvAqgfYNLKk7cJKWCui8W4'
  && DEFAULT_HANDLE === 'MEGA_BOT', 'MEGA catalog and runner pin the dedicated bot identity');
check(megaCatalog?.childRunnerSourceSha256 === sha256File(resolve(sourceRoot, 'tools/static-router-quickmatch.mjs')),
  'MEGA catalog pins child bytes');
check(megaCatalog?.supervisorSourceSha256 === sha256File(resolve(sourceRoot, 'tools/durable-quickmatch-supervisor.mjs')),
  'MEGA catalog pins supervisor bytes');
check(megaCatalog?.policyModuleSha256 === sha256File(resolve(sourceRoot, 'policies/static-router-gym.mjs')),
  'MEGA catalog pins policy bytes');

const fixture = {
  phase: 'fight',
  you: { x: 30, y: 0, facing: 1, stun: 0, attack: 'none' },
  opp: { x: 140, y: 0, facing: -1, stun: 0, attack: 'none', active: false },
};
for (const profile of DURABLE_PROFILES) {
  const first = createStaticGymPolicy(profile.id, 123);
  const second = createStaticGymPolicy(profile.id, 123);
  const a = Array.from({ length: 64 }, () => first.decide(fixture));
  const b = Array.from({ length: 64 }, () => second.decide(fixture));
  check(JSON.stringify(a) === JSON.stringify(b), `${profile.id} deterministic`);
  check(a.every((row) => row.action.motion), `${profile.id} always explicitly resets/sets motion`);
}
const mneme = createStaticGymPolicy('static-mneme-zoner', 1);
const mnemeRows = Array.from({ length: 100 }, () => mneme.decide(fixture));
check(mnemeRows.some((row) => row.reason === 'zoner_far_beam')
  && mnemeRows.filter((row) => row.reason === 'zoner_far_beam').every((row) => row.action.motion === 'DR' && row.action.punch),
'MNEME zoner emits canonical volley input');

assert.throws(() => parseQuickArgs([]), /choose exactly one/); checks++;
assert.throws(() => parseQuickArgs(['--armed', '--profile', 'static-byu-jumper']), /requires/); checks++;
check(parseQuickArgs(['--dry-run', '--profile', 'static-gyle-jumper']).profile.character === 'GYLE', 'quick args bind profile');
const megaArgs = parseQuickArgs([
  '--armed', '--identity', '/fake/mega', '--handle', 'MEGA_BOT',
  '--expected-fingerprint', 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  '--out', '/tmp/mega.jsonl',
]);
check(megaArgs.handle === 'MEGA_BOT' && megaArgs.expectedFingerprint.startsWith('SHA256:'),
  'armed quick args require an explicit identity binding');
assert.throws(() => parseQuickArgs([
  '--armed', '--identity', '/fake/mega', '--handle', 'mega bot',
  '--expected-fingerprint', 'SHA256:abc', '--out', '/tmp/mega.jsonl',
]), /handle/); checks++;
check(transientQueueError(new Error('public preflight must report queued as numeric integer zero; got 2')), 'busy queue transient');
check(!transientQueueError(new Error('got null')), 'malformed queue is fatal');

const sent = [], rows = [];
const policy = createStaticGymPolicy('static-mneme-zoner', 7);
const controller = createOneMatchController({
  windowMs: 5000, handle: HANDLE, character: 'MNEME', expectedFingerprint: EXPECTED_FINGERPRINT,
  decide: policy.decide, reset: policy.reset, rngState: policy.rngState,
  requireAckBeforeNextInput: true,
}, {
  send: (message) => sent.push(message), append: (kind, payload) => rows.push({ kind, ...payload }),
  schedule: () => 1, cancel: () => {}, assertQueueSafe: async () => ({ queued: 0 }),
  fetchOfficial: async (mid) => ({ match: { id: mid, mode: 'versus', engine_version: 'sf-6', a_name: HANDLE, a_char: 'MNEME', b_name: 'OPP', b_char: 'BYU', winner: 'a', a_rounds: 2, b_rounds: 0, end_reason: 'ko' } }),
  finish: () => {},
});
await controller.handle({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER] });
check(sent[0]?.t === 'queue' && sent[0]?.char === 'MNEME', 'generic controller queues configured character');
await controller.handle({ t: 'matchStart', mid: 'm1', yourCursor: PINNED_ROSTER.indexOf('MNEME'), oppCursor: 0, role: 'a', stage: 'dojo', oppName: 'OPP' });
await controller.handle({ t: 'state', frame: 1, ack: 0, ...fixture });
check(sent[1]?.t === 'input' && rows.some((row) => row.kind === 'decision'), 'generic controller drives configured policy');
await controller.handle({ t: 'state', frame: 2, ack: 0, ...fixture });
check(sent.length === 2 && rows.some((row) => row.kind === 'input_suppressed'), 'MEGA emits nothing behind an unacked input');
await controller.handle({ t: 'state', frame: 3, ack: 1, ...fixture });
check(sent.length === 3, 'MEGA resumes only after authoritative ack');
const wrong = createOneMatchController({ windowMs: 5000, character: 'MNEME' }, {
  send: () => {}, append: () => {}, schedule: () => 1, cancel: () => {},
  assertQueueSafe: async () => ({ queued: 0 }), fetchOfficial: async () => ({}), finish: () => {},
});
await wrong.handle({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER] });
check(await rejects(wrong.handle({ t: 'queued', char: 'BYU' }), /queued wrong character/), 'wrong queued character rejects');

const official = { match: { id: 'm1', mode: 'versus', engine_version: 'sf-6', a_name: HANDLE, a_char: 'BYU', b_name: 'OPP', b_char: 'XENON', winner: 'a', a_rounds: 2, b_rounds: 1, end_reason: 'ko' } };
check(validateOfficial(official, 'm1', 'BYU', HANDLE) === official, 'official completion validates explicit generic handle');
assert.throws(() => validateOfficial({ match: { ...official.match, a_char: 'GYLE' } }, 'm1', 'BYU', HANDLE), /clean uniquely bound/); checks++;
const megaOfficial = { match: { ...official.match, a_name: 'MEGA_BOT' } };
check(validateOfficial(megaOfficial, 'm1', 'BYU') === megaOfficial,
  'official completion defaults to the dedicated MEGA_BOT handle');

const dry = parseQuickArgs(['--dry-run', '--profile', 'static-byu-jumper']);
await runQuick(dry); checks++;

const supervisorDry = await runSupervisor(parseSupervisorArgs(['--dry-run']));
check(supervisorDry.networkAccess === false && supervisorDry.profiles.length === 3
  && supervisorDry.handle === 'MEGA_BOT', 'supervisor dry run is network free and bot-identity bound');

const lockTemp = mkdtempSync(join(tmpdir(), 'static-router-lock-'));
const firstLock = acquireSupervisorLock(lockTemp);
check((statSync(firstLock.path).mode & 0o777) === 0o600, 'supervisor singleton lock is mode0600');
assert.throws(() => acquireSupervisorLock(lockTemp), /EEXIST/); checks++;
firstLock.release();
check(!existsSync(firstLock.path), 'graceful supervisor release removes its owned lock');
acquireSupervisorLock(lockTemp).release();
rmSync(lockTemp, { recursive: true });

class FakeChild extends EventEmitter { kill() { this.killed = true; return true; } }
const exits = [0, 75, 0, 0];
const launched = [], sleeps = [];
const temp = mkdtempSync(join(tmpdir(), 'static-router-supervisor-'));
const supervisorResult = await runSupervisor({
  dryRun: false, identity: '/fake/key', handle: 'MEGA', expectedFingerprint: 'SHA256:fixture',
  outDir: temp, host: 'example', cooldownMs: 5000,
  idleBackoffMs: 6000, maxMatches: 3, maxFailures: 3,
}, {
  spawnChild(command, args) { const child = new FakeChild(); launched.push({ command, args, child }); return child; },
  waitChild: async () => ({ code: exits.shift(), signal: null }),
  sleep: async (ms) => { sleeps.push(ms); },
  now: () => new Date('2026-08-20T00:00:00Z'),
});
check(supervisorResult.completed === 3 && supervisorResult.attempts === 4, 'supervisor counts only completed matches');
check(launched[0].args.includes('static-byu-jumper') && launched[1].args.includes('static-gyle-jumper')
  && launched[2].args.includes('static-gyle-jumper') && launched[3].args.includes('static-mneme-zoner'),
'transient queue preserves current profile and successful matches rotate');
check(launched.every((row) => row.args.includes('MEGA') && row.args.includes('SHA256:fixture')),
  'supervisor forwards the exact handle and fingerprint to every child');
check(sleeps.join(',') === '5000,6000,5000,5000', 'supervisor applies cooldown and idle backoff');
rmSync(temp, { recursive: true });

const fatalExits = [1, 1];
check(await rejects(runSupervisor({
  dryRun: false, identity: '/fake/key', handle: 'MEGA', expectedFingerprint: 'SHA256:fixture',
  outDir: mkdtempSync(join(tmpdir(), 'static-router-fatal-')),
  host: 'example', cooldownMs: 5000, idleBackoffMs: 5000, maxMatches: 1, maxFailures: 2,
}, {
  spawnChild: () => new FakeChild(), waitChild: async () => ({ code: fatalExits.shift(), signal: null }), sleep: async () => {},
}), /circuit breaker/), 'fatal child failures open circuit breaker');

console.log(`STATIC ROUTER QUICKMATCH TEST: PASS (${checks} checks)`);
