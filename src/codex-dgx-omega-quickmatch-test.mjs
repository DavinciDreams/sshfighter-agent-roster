#!/usr/bin/env node
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHARACTER, CHILD_HARD_DEADLINE_MS, CHILD_KILL_GRACE_MS, CHILD_TERM_GRACE_MS,
  DEPLOYED_COMMIT_ATTESTED, EXPECTED_FINGERPRINT, EXPECTED_VENDOR_IMPLEMENTATION_SHA256,
  HANDLE, MIGRATED_FROM_UPSTREAM_PR_HEAD, PINNED_ROSTER, POLICY_FUNCTION_SHA256, POLICY_SEED,
  RUNTIME_PROFILE_EVIDENCE, VENDOR_IMPLEMENTATION_FILES, VENDOR_SOURCE_COMMIT,
  agentRepoProvenance, assertStrictQueueEmpty, computeVendorImplementationHash,
  createBoundedChildLifecycle, createBoundedTransportSession, createExclusiveLedger,
  createOneMatchController, decide, deterministicFixture, parseArgs, redactLedgerValue,
  resetRng, validatePinnedRoster, verifyVendorProvenance,
} from './tools/codex-dgx-omega-quickmatch.mjs';

let pass = true;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) pass = false; };
const throws = (fn, pattern) => { try { fn(); return false; } catch (error) { return pattern.test(String(error)); } };
const rejects = async (promise, pattern) => {
  try { await promise; return false; } catch (error) { return pattern.test(String(error)); }
};

check('migration pins exact upstream PR #31 head',
  MIGRATED_FROM_UPSTREAM_PR_HEAD === 'aa72038b4aa2068ea9d295fcd2f8778f6d61e874');
check('vendor mechanics/protocol pins exact canonical commit',
  VENDOR_SOURCE_COMMIT === '3caedf3435c12996cf4d34fb5ac76c7cd7b75076');
check('runtime evidence is truthful and exact-roster scoped',
  DEPLOYED_COMMIT_ATTESTED === false && /exact authenticated ordered 17-fighter/.test(RUNTIME_PROFILE_EVIDENCE));
check('vendor implementation surface is explicit', JSON.stringify(VENDOR_IMPLEMENTATION_FILES) === JSON.stringify([
  'src/game/moves.ts', 'src/game/engine.ts', 'src/game/types.ts',
  'src/api/bot-server.ts', 'src/cluster/messages.ts', 'src/cluster/coordinator.ts',
]));
const vendor = verifyVendorProvenance();
check('vendor implementation digest recomputes exactly',
  vendor.vendorImplementationSha256 === EXPECTED_VENDOR_IMPLEMENTATION_SHA256
  && computeVendorImplementationHash() === EXPECTED_VENDOR_IMPLEMENTATION_SHA256);
check('vendor commit and implementation drift fail closed',
  throws(() => verifyVendorProvenance('0'.repeat(40), EXPECTED_VENDOR_IMPLEMENTATION_SHA256), /commit mismatch/)
  && throws(() => verifyVendorProvenance(VENDOR_SOURCE_COMMIT, '0'.repeat(64)), /implementation hash mismatch/));
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

const invalidQueued = [null, undefined, '', false, true, '0', '1', Number.NaN, -1, 1, 0.5];
check('public queue gate accepts only numeric integer zero',
  assertStrictQueueEmpty({ queued: 0 }, 'public preflight').queued === 0
  && invalidQueued.every((queued) => throws(
    () => assertStrictQueueEmpty({ queued }, 'public preflight'), /numeric integer zero/)));

validatePinnedRoster([...PINNED_ROSTER]);
const old16 = PINNED_ROSTER.slice(0, -1);
const substituted = PINNED_ROSTER.map((value, index) => index === 7 ? 'SUBSTITUTE' : value);
const reordered = [...PINNED_ROSTER];
[reordered[15], reordered[16]] = [reordered[16], reordered[15]];
check('exact authenticated ordered 17-fighter roster is pinned',
  PINNED_ROSTER.length === 17 && PINNED_ROSTER.at(-1) === 'UNCLOSE'
  && throws(() => validatePinnedRoster(['BYU', CHARACTER, 'CODEX']), /exact ordered/)
  && throws(() => validatePinnedRoster(old16), /exact ordered/)
  && throws(() => validatePinnedRoster(substituted), /exact ordered/)
  && throws(() => validatePinnedRoster(reordered), /exact ordered/));

const controllerHarness = (queuePayload = { queued: 0 }) => {
  const sent = [], rows = [], timers = [];
  let finished = null;
  const controller = createOneMatchController({ windowMs: 5000 }, {
    send: (message) => sent.push(message), append: (kind, data) => rows.push({ kind, ...data }),
    schedule: (fn) => { timers.push(fn); return timers.length - 1; }, cancel: () => {},
    assertQueueSafe: async () => queuePayload,
    fetchOfficial: async (matchId) => ({ match: { id: matchId, end_reason: 'ko' } }),
    finish: (summary) => { finished = summary; },
  });
  return { controller, sent, rows, timers, get finished() { return finished; } };
};

const h = controllerHarness();
await h.controller.handle({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER] });
check('welcome validates exact roster and numeric-zero queue before one OMEGA queue',
  h.sent.length === 1 && h.sent[0].t === 'queue' && h.sent[0].char === CHARACTER);
await h.controller.handle({ t: 'queued', char: CHARACTER });
await h.controller.handle({
  t: 'matchStart', mid: 'fixture', yourCursor: PINNED_ROSTER.indexOf(CHARACTER),
  oppCursor: PINNED_ROSTER.indexOf('CODEX'), role: 'a', stage: 'dojo', oppName: 'OPP',
});
await h.controller.handle({
  t: 'state', frame: 1, ack: 0, phase: 'fight',
  you: { x: 50, y: 0, facing: 1, attack: 'none' },
  opp: { x: 120, y: 0, attack: 'none' },
});
check('fight emits exactly one deterministic input', h.sent.length === 2 && h.sent[1].t === 'input');
await h.controller.handle({ t: 'matchEnd', result: { youWon: true } });
check('one match sends leave instead of requeue',
  h.sent.length === 3 && h.sent[2].t === 'leave' && h.controller.status().stopping);
await h.controller.handle({ t: 'left' });
check('clean left finalizes one bounded match', h.finished?.matched === true && h.finished?.matchId === 'fixture');

let strictWelcome = true;
for (const queued of invalidQueued) {
  const candidate = controllerHarness({ queued });
  const rejected = await rejects(candidate.controller.handle({
    t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER],
  }), /numeric integer zero/);
  strictWelcome &&= rejected && candidate.sent.length === 0;
}
check('welcome-time queue telemetry rejects null/empty/boolean/string/NaN/negative before queue/input', strictWelcome);

let rosterRejectsBeforeActuation = true;
for (const candidateRoster of [['BYU', CHARACTER, 'CODEX'], old16, substituted, reordered]) {
  const candidate = controllerHarness();
  const rejected = await rejects(candidate.controller.handle({
    t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: candidateRoster,
  }), /runtime profile mismatch/);
  rosterRejectsBeforeActuation &&= rejected && candidate.sent.length === 0;
}
check('3/16/substituted/reordered welcome rosters produce zero queue or input', rosterRejectsBeforeActuation);

const wrongIdentity = controllerHarness();
check('wrong SSH identity aborts before queueing',
  await rejects(wrongIdentity.controller.handle({
    t: 'welcome', name: 'CODEX_ROOT', fp: 'wrong', roster: [...PINNED_ROSTER],
  }), /identity mismatch/) && wrongIdentity.sent.length === 0);

const redacted = redactLedgerValue({
  official: { match: { a_fp: 'A', b_fp: 'B', nested: { fingerprint: 'C', key: 'D', token: 'E', identity: 'F' } } },
  safe: 'preserved', incidental: `owner ${EXPECTED_FINGERPRINT}`,
});
check('recursive redaction covers opponent fingerprints, keys, tokens, identities, and embedded fingerprints',
  redacted.official.match.a_fp === '[REDACTED]'
  && redacted.official.match.b_fp === '[REDACTED]'
  && Object.values(redacted.official.match.nested).every((value) => value === '[REDACTED]')
  && redacted.safe === 'preserved' && !redacted.incidental.includes('SHA256:'));

const ledgerDir = mkdtempSync(join(tmpdir(), 'omega-ledger-'));
const ledgerPath = join(ledgerDir, 'audit.jsonl');
const ledger = createExclusiveLedger(ledgerPath, { now: () => 'fixed' });
ledger.append('match_boundary', {
  official: { match: { a_fp: 'A', b_fp: 'B', fingerprint: 'C', privateKey: 'D', accessToken: 'E', identityPath: '/secret' } },
});
ledger.close();
const ledgerText = readFileSync(ledgerPath, 'utf8');
const ledgerMatch = JSON.parse(ledgerText).official.match;
check('exclusive mode-0600 ledger applies recursive redaction to every appended payload',
  (statSync(ledgerPath).mode & 0o777) === 0o600
  && Object.values(ledgerMatch).every((value) => value === '[REDACTED]')
  && (ledgerText.match(/\[REDACTED\]/g) ?? []).length === 6);
rmSync(ledgerDir, { recursive: true });

class FakeClock {
  now = 0;
  next = 1;
  tasks = new Map();
  schedule = (fn, ms) => { const id = this.next++; this.tasks.set(id, { at: this.now + ms, fn }); return id; };
  cancel = (id) => { this.tasks.delete(id); };
  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      this.tasks.delete(next[0]); this.now = next[1].at; next[1].fn();
    }
    this.now = target;
  }
}
class FakeChild extends EventEmitter {
  kills = [];
  stdin = { destroyed: false, ended: false, end: () => { this.stdin.ended = true; } };
  kill(signal) { this.kills.push(signal); return true; }
}

const lifecycleClock = new FakeClock();
const stubbornChild = new FakeChild();
const lifecycle = createBoundedChildLifecycle(stubbornChild, {
  schedule: lifecycleClock.schedule, cancel: lifecycleClock.cancel,
});
lifecycle.close('test_complete');
lifecycleClock.advance(CHILD_TERM_GRACE_MS);
const termObserved = stubbornChild.kills.join(',') === 'SIGTERM';
lifecycleClock.advance(CHILD_KILL_GRACE_MS - CHILD_TERM_GRACE_MS);
const killObserved = stubbornChild.kills.join(',') === 'SIGTERM,SIGKILL';
lifecycleClock.advance(CHILD_HARD_DEADLINE_MS - CHILD_KILL_GRACE_MS);
await lifecycle.done;
check('stubborn child is bounded by stdin close, TERM, KILL, and hard settlement',
  stubbornChild.stdin.ended && termObserved && killObserved && lifecycle.status().settled);

const prematureChild = new FakeChild();
const premature = createBoundedChildLifecycle(prematureChild);
const prematureResult = premature.done.then(() => false, (error) => /before bounded completion/.test(String(error)));
prematureChild.emit('exit', 255, null);
check('premature SSH exit remains fail closed', await prematureResult);

const sessionHarness = ({ windowMs = 50, globalTimeoutMs = 10_000, queueCheck = async () => ({ queued: 0 }) } = {}) => {
  const clock = new FakeClock();
  const child = new FakeChild();
  const sent = [], rows = [];
  let signalHandler = null;
  const session = createBoundedTransportSession({
    windowMs, globalTimeoutMs,
    termMs: CHILD_TERM_GRACE_MS, killMs: CHILD_KILL_GRACE_MS, hardMs: CHILD_HARD_DEADLINE_MS,
  }, {
    child, send: (message) => sent.push(message), append: (kind, payload) => rows.push({ kind, ...payload }),
    schedule: clock.schedule, cancel: clock.cancel,
    addSignal: (handler) => { signalHandler = handler; }, removeSignal: () => { signalHandler = null; },
    assertQueueSafe: queueCheck, fetchOfficial: async () => ({ match: { end_reason: 'ko' } }),
  });
  return { clock, child, sent, rows, session, get signalHandler() { return signalHandler; } };
};

const queueTimeout = sessionHarness();
const queueDone = queueTimeout.session.done.then(() => null, (error) => error);
await queueTimeout.session.dispatch({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER] });
queueTimeout.clock.advance(50);
check('queue-window expiry closes transport immediately',
  queueTimeout.session.lifecycle.status().closing && queueTimeout.child.stdin.ended
  && queueTimeout.sent.at(-1)?.t === 'leave');
queueTimeout.clock.advance(CHILD_HARD_DEADLINE_MS);
check('queue-window shutdown cannot hang', /bounded_queue_window_expired/.test(String(await queueDone)));

const globalTimeout = sessionHarness({ globalTimeoutMs: 50 });
const globalDone = globalTimeout.session.done.then(() => null, (error) => error);
globalTimeout.clock.advance(50);
check('global timeout closes transport', globalTimeout.session.lifecycle.status().closing && globalTimeout.child.stdin.ended);
globalTimeout.clock.advance(CHILD_HARD_DEADLINE_MS);
check('global-timeout shutdown cannot hang', /global_timeout/.test(String(await globalDone)));

let releaseQueueGate;
const delayedQueueGate = new Promise((resolvePromise) => { releaseQueueGate = resolvePromise; });
const globalDuringGate = sessionHarness({ globalTimeoutMs: 50, queueCheck: () => delayedQueueGate });
const gatedDone = globalDuringGate.session.done.then(() => null, (error) => error);
const gatedWelcome = globalDuringGate.session.dispatch({
  t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER],
});
globalDuringGate.clock.advance(50);
releaseQueueGate({ queued: 0 });
await gatedWelcome;
check('global timeout during async welcome gate never queues afterward',
  globalDuringGate.sent.filter((message) => message.t === 'queue' || message.t === 'input').length === 0);
globalDuringGate.clock.advance(CHILD_HARD_DEADLINE_MS);
await gatedDone;

const interrupted = sessionHarness();
const interruptedDone = interrupted.session.done.then(() => null, (error) => error);
interrupted.signalHandler();
check('SIGINT closes transport', interrupted.session.lifecycle.status().closing && interrupted.child.stdin.ended);
interrupted.clock.advance(CHILD_HARD_DEADLINE_MS);
check('SIGINT shutdown cannot hang', /operator_sigint/.test(String(await interruptedDone)));

const completed = sessionHarness();
const completedDone = completed.session.done.then(() => null, (error) => error);
await completed.session.dispatch({ t: 'welcome', name: HANDLE, fp: EXPECTED_FINGERPRINT, roster: [...PINNED_ROSTER] });
await completed.session.dispatch({
  t: 'matchStart', mid: 'complete', yourCursor: PINNED_ROSTER.indexOf(CHARACTER),
  oppCursor: PINNED_ROSTER.indexOf('CODEX'), role: 'b', stage: 'dojo', oppName: 'OPP',
});
await completed.session.dispatch({ t: 'matchEnd', result: { youWon: true } });
completed.child.emit('exit', 255, null);
check('expected SSH 255 after authoritative completion remains success', await completedDone === null);

console.log(pass ? '\nOMEGA QUICK MATCH TEST: PASS' : '\nOMEGA QUICK MATCH TEST: FAIL');
process.exit(pass ? 0 : 1);
