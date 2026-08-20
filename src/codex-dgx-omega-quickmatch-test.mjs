#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  CHARACTER, DEPLOYED_COMMIT_ATTESTED, EXPECTED_FINGERPRINT,
  EXPECTED_VENDOR_IMPLEMENTATION_SHA256,
  HANDLE, MIGRATED_FROM_UPSTREAM_PR_HEAD, POLICY_FUNCTION_SHA256, POLICY_SEED,
  RUNTIME_PROFILE_EVIDENCE,
  VENDOR_IMPLEMENTATION_FILES, VENDOR_SOURCE_COMMIT, agentRepoProvenance,
  computeVendorImplementationHash, createOneMatchController, decide,
  deterministicFixture, parseArgs, resetRng, verifyVendorProvenance,
} from './tools/codex-dgx-omega-quickmatch.mjs';

let pass = true;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) pass = false; };
const throws = (fn, pattern) => { try { fn(); return false; } catch (error) { return pattern.test(String(error)); } };

check('migration pins exact upstream PR #31 head',
  MIGRATED_FROM_UPSTREAM_PR_HEAD === 'aa72038b4aa2068ea9d295fcd2f8778f6d61e874');
check('vendor mechanics/protocol pins exact canonical commit',
  VENDOR_SOURCE_COMMIT === '3caedf3435c12996cf4d34fb5ac76c7cd7b75076');
check('vendor reference is not mislabeled as a deployed commit attestation',
  DEPLOYED_COMMIT_ATTESTED === false
  && /health.*welcome roster/.test(RUNTIME_PROFILE_EVIDENCE));
check('vendor implementation surface is explicit', JSON.stringify(VENDOR_IMPLEMENTATION_FILES) === JSON.stringify([
  'src/game/moves.ts',
  'src/game/engine.ts',
  'src/game/types.ts',
  'src/api/bot-server.ts',
  'src/cluster/messages.ts',
  'src/cluster/coordinator.ts',
]));
const vendor = verifyVendorProvenance();
check('vendor implementation digest recomputes exactly',
  vendor.vendorImplementationSha256 === EXPECTED_VENDOR_IMPLEMENTATION_SHA256
  && computeVendorImplementationHash() === EXPECTED_VENDOR_IMPLEMENTATION_SHA256);
check('vendor commit drift fails closed',
  throws(() => verifyVendorProvenance('0'.repeat(40), EXPECTED_VENDOR_IMPLEMENTATION_SHA256), /commit mismatch/));
check('vendor implementation drift fails closed',
  throws(() => verifyVendorProvenance(VENDOR_SOURCE_COMMIT, '0'.repeat(64)), /implementation hash mismatch/));
const agentRepo = agentRepoProvenance();
check('agent-repo provenance labels commit, status, source hash, and migration source',
  /^[0-9a-f]{40}$/.test(agentRepo.agentRepoHeadCommit)
  && typeof agentRepo.agentRepoRunnerStatus === 'string'
  && /^[0-9a-f]{64}$/.test(agentRepo.runnerSourceSha256)
  && agentRepo.migratedFromUpstreamPrHead === MIGRATED_FROM_UPSTREAM_PR_HEAD);

check('default launch is impossible', throws(() => parseArgs([]), /choose exactly one/));
check('armed mode requires identity and output', throws(() => parseArgs(['--armed']), /requires --identity and --out/));
check('queue window is bounded', throws(() => parseArgs(['--dry-run', '--window-ms', '200000']), /5000 to 120000/));
check('dry-run requires no identity or output', parseArgs(['--dry-run']).dryRun === true);
check('fixed seed remains OMEG', POLICY_SEED === 0x4f4d4547);
check('policy rerun is byte deterministic', JSON.stringify(deterministicFixture()) === JSON.stringify(deterministicFixture()));
resetRng();
check('decide body remains byte-equivalent to frozen PR #28 policy',
  createHash('sha256').update(decide.toString()).digest('hex') === POLICY_FUNCTION_SHA256);

const sent = [], rows = [], timers = [];
let finished = null;
let queueChecks = 0;
const controller = createOneMatchController({ windowMs: 5000 }, {
  send: (message) => sent.push(message), append: (kind, data) => rows.push({ kind, ...data }),
  schedule: (fn) => { timers.push(fn); return timers.length - 1; }, cancel: () => {},
  assertQueueSafe: async () => { queueChecks++; },
  fetchOfficial: async (matchId) => ({ match: { id: matchId, end_reason: 'ko' } }),
  finish: (summary) => { finished = summary; },
});
const roster = ['BYU', CHARACTER, 'CODEX'];
await controller.handle({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster });
check('welcome checks empty queue then queues exact OMEGA once',
  queueChecks === 1 && sent.length === 1 && sent[0].t === 'queue' && sent[0].char === CHARACTER);
await controller.handle({ t: 'queued', char: CHARACTER });
await controller.handle({ t: 'matchStart', mid: 'fixture', yourCursor: 1, oppCursor: 2, role: 'a', stage: 'dojo', oppName: 'OPP' });
await controller.handle({
  t: 'state', frame: 1, ack: 0, phase: 'fight',
  you: { x: 50, y: 0, facing: 1, attack: 'none' },
  opp: { x: 120, y: 0, attack: 'none' },
});
check('fight emits exactly one deterministic input', sent.length === 2 && sent[1].t === 'input');
await controller.handle({ t: 'matchEnd', result: { youWon: true } });
check('one match sends leave instead of requeue', sent.length === 3 && sent[2].t === 'leave' && controller.status().stopping);
await check('second matchStart is rejected after the bounded match',
  controller.handle({ t: 'matchStart', mid: 'second', yourCursor: 1, oppCursor: 2 })
    .then(() => false, (error) => /second matchStart/.test(String(error))));
await controller.handle({ t: 'left' });
check('clean left finalizes one bounded match', finished?.matched === true && finished?.matchId === 'fixture');

const timeoutSent = [];
const timeout = createOneMatchController({ windowMs: 5000 }, {
  send: (message) => timeoutSent.push(message), append: () => {}, schedule: (fn) => { timers.push(fn); return timers.length - 1; },
  cancel: () => {}, assertQueueSafe: async () => {}, fetchOfficial: async () => null, finish: () => {},
});
await timeout.handle({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster });
timers.at(-1)();
check('expired queue window leaves without a match', timeoutSent.at(-1)?.t === 'leave' && !timeout.status().matched);

const unsafeSent = [];
const unsafe = createOneMatchController({ windowMs: 5000 }, {
  send: (message) => unsafeSent.push(message), append: () => {}, schedule: () => 0, cancel: () => {},
  assertQueueSafe: async () => { throw new Error('global queue changed before join: 1'); },
  fetchOfficial: async () => null, finish: () => {},
});
await check('connection-time queue race aborts before queueing',
  await unsafe.handle({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster })
    .then(() => false, (error) => /queue changed/.test(String(error)))
    && unsafeSent.length === 0);

const wrongIdentitySent = [];
const wrongIdentity = createOneMatchController({ windowMs: 5000 }, {
  send: (message) => wrongIdentitySent.push(message), append: () => {}, schedule: () => 0, cancel: () => {},
  assertQueueSafe: async () => {}, fetchOfficial: async () => null, finish: () => {},
});
await check('wrong SSH identity aborts before queueing',
  await wrongIdentity.handle({ t: 'welcome', name: 'CODEX_ROOT', fp: 'wrong', roster })
    .then(() => false, (error) => /identity mismatch/.test(String(error)))
    && wrongIdentitySent.length === 0);

console.log(pass ? '\nOMEGA QUICK MATCH TEST: PASS' : '\nOMEGA QUICK MATCH TEST: FAIL');
process.exit(pass ? 0 : 1);
