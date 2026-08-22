import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENTS, EXPECTED_ENGINE, EXPECTED_PROTOCOL, EXPECTED_SCHEMA_PATH, PINNED_ROSTER,
  EXPECTED_SCHEMA_COMPATIBILITY_SHA256, REVIEWED_BASELINE_BUILD,
  REVIEWED_BASELINE_COMMIT, REVIEWED_BASELINE_SCHEMA_SHA256, classifyRuntime,
  createPolicyBinding, createStandingController,
  computeRequeueDelayMs, computeRunnerImplementationHash, normalizeInput, parseArgs,
  runtimeDataBoundary, schemaCompatibilityView, sha256, stable, validateOfficial,
  validatePreflight,
  type AgentId, type AuditSink, type RunnerOptions, type RuntimeAttestation,
} from './tools/standing-bot-v2.js';

type Message = Record<string, unknown>;

class MemoryAudit implements AuditSink {
  rows: Array<{ event: string; payload: unknown }> = [];
  traces: unknown[] = [];
  append(event: string, payload: unknown = {}) { this.rows.push({ event, payload }); }
  beginMatch(mid: string, payload: unknown) { this.rows.push({ event: `begin:${mid}`, payload }); }
  trace(payload: unknown) { this.traces.push(payload); }
  endMatch(payload: unknown) { this.rows.push({ event: 'end', payload }); }
  close() {}
}

const exactBuild = {
  engine: EXPECTED_ENGINE, commit: REVIEWED_BASELINE_COMMIT, dirty: false,
  build: REVIEWED_BASELINE_BUILD, protocol: EXPECTED_PROTOCOL, schema: EXPECTED_SCHEMA_PATH,
};
const runtime: RuntimeAttestation = {
  engine: EXPECTED_ENGINE, commit: REVIEWED_BASELINE_COMMIT,
  build: REVIEWED_BASELINE_BUILD, protocol: EXPECTED_PROTOCOL,
  schemaSha256: REVIEWED_BASELINE_SCHEMA_SHA256,
  schemaCompatibilitySha256: EXPECTED_SCHEMA_COMPATIBILITY_SHA256,
};

const fighter = (character: string, overrides: Message = {}): Message => ({
  character, x: 80, y: 0, vx: 0, vy: 0, facing: 1, hp: 100, wins: 0,
  attack: 'none', attackFrame: 0, movePhase: 'neutral', hitboxActive: false,
  attackConnected: false, stun: 0, blocking: false, invulnerable: false,
  invulnerabilityFrames: 0, armored: false, armorFrames: 0, thrownFrames: 0,
  actionable: true, pose: 'idle', crouching: false, special: false, active: false,
  casting: false, ...overrides,
});

const state = (agent: AgentId, frame: number, ack: number, overrides: Message = {}): Message => ({
  t: 'state', frame, phase: 'fight', round: 1, roundTime: 75, hitStop: 0, ack,
  you: fighter(AGENTS[agent].character), opp: fighter('CODEX', { x: 150, facing: -1 }),
  projectiles: [], ...overrides,
});

const options = (agent: AgentId): RunnerOptions => ({
  agent, identity: '/tmp/test.key', outDir: '/tmp/test-output', host: 'sshfighter.com',
  seed: AGENTS[agent].defaultSeed, armed: true, dryRun: false,
  requeueDelayMs: 1_000, requeueJitterMs: 5_000,
});

function official(agent: AgentId, mid = 'm1'): Message {
  const binding = AGENTS[agent];
  return { match: {
    id: mid, mode: 'versus', engine_version: EXPECTED_ENGINE,
    engine_commit: REVIEWED_BASELINE_COMMIT, engine_dirty: 0,
    a_name: binding.handle, a_char: binding.character, a_is_bot: 1,
    b_name: 'OPP', b_char: 'CODEX', b_is_bot: 1,
    winner: 'a', a_rounds: 2, b_rounds: 0, end_reason: 'ko',
  } };
}

function harness(agent: AgentId) {
  const sent: Message[] = [];
  const scheduled: Array<{ fn: () => void; delayMs: number }> = [];
  const audit = new MemoryAudit();
  let closed = false;
  let clock = 1_000n;
  const controller = createStandingController(options(agent), createPolicyBinding(agent, options(agent).seed), {
    send: (message) => sent.push(message), close: () => { closed = true; }, audit,
    fetchOfficial: async (mid) => official(agent, mid),
    schedule: (fn, delayMs) => { scheduled.push({ fn, delayMs }); return scheduled.length; },
    nowNs: () => { clock += 100n; return clock; },
  }, runtime);
  return { controller, sent, scheduled, audit, isClosed: () => closed };
}

async function enter(agent: AgentId, h: ReturnType<typeof harness>) {
  const binding = AGENTS[agent];
  await h.controller.handle({ t: 'hi', service: 'ringside-bot', ...exactBuild });
  await h.controller.handle({
    t: 'welcome', name: binding.handle, fp: binding.fingerprint, elo: 1200,
    roster: [...PINNED_ROSTER], channel: 'bot-api', playerType: 'bot', ...exactBuild,
  });
  await h.controller.handle({ t: 'queued', char: binding.character, opponents: 'bots' });
  await h.controller.handle({
    t: 'matchStart', mid: 'm1', role: 'a', yourCursor: PINNED_ROSTER.indexOf(binding.character),
    oppName: 'OPP', oppCursor: PINNED_ROSTER.indexOf('CODEX'), oppType: 'bot',
    stage: 'dojo', ...exactBuild,
  });
}

for (const agent of ['blank', 'megawatts'] as const) {
  const h = harness(agent);
  await enter(agent, h);
  assert.deepEqual(h.sent[0], { t: 'queue', char: AGENTS[agent].character, opponents: 'bots' });
  await h.controller.handle(state(agent, 1, 0));
  await h.controller.handle(state(agent, 2, 1));
  const inputs = h.sent.filter((row) => row.t === 'input');
  assert.equal(inputs.length, 2, `${agent}: one decision per state without ACK gating`);
  for (const input of inputs) {
    assert.deepEqual(Object.keys(input).sort(),
      ['down', 'jump', 'kick', 'motion', 'moveX', 'punch', 't', 'throw'].sort());
  }
  assert.equal((h.audit.traces[1] as Message).unackedInputs, 1);
  const matchManifest = h.audit.rows.find((row) => row.event === 'begin:m1')?.payload as Message;
  assert.equal(matchManifest.commit, REVIEWED_BASELINE_COMMIT);
  assert.equal(matchManifest.schemaSha256, REVIEWED_BASELINE_SCHEMA_SHA256);
  assert.equal(matchManifest.runtimeAlignment, 'reviewed-baseline');
  assert.equal(matchManifest.trainingEligibility, 'reviewed-runtime');
  await h.controller.handle({
    t: 'matchEnd', result: { youWon: true, winner: AGENTS[agent].handle, loser: 'OPP' },
  });
  assert.equal(h.controller.status().completed, 1);
  assert.equal(h.scheduled.length, 1);
  assert.ok(h.scheduled[0]!.delayMs >= 1_000 && h.scheduled[0]!.delayMs <= 6_000);
  const requeueEvent = h.audit.rows.find((row) => row.event === 'requeue-scheduled');
  assert.deepEqual(requeueEvent?.payload, {
    completed: 1, delayMs: h.scheduled[0]!.delayMs, baseDelayMs: 1_000, jitterMs: 5_000,
  });
  h.scheduled[0]!.fn();
  assert.deepEqual(h.sent.at(-1), { t: 'queue', char: AGENTS[agent].character, opponents: 'bots' });
  await h.controller.handle({
    t: 'matchStart', mid: 'm2', role: 'a', yourCursor: PINNED_ROSTER.indexOf(AGENTS[agent].character),
    oppName: 'OPP', oppCursor: PINNED_ROSTER.indexOf('CODEX'), oppType: 'bot',
    stage: 'dojo', ...exactBuild,
  });
  await h.controller.handle(state(agent, 1, 0));
  assert.equal(h.controller.status().localSeq, 3, `${agent}: local sequence remains connection-global`);
  assert.equal(h.controller.status().matchSeqBase, 2, `${agent}: match sequence baseline resets`);
  assert.equal(h.controller.status().matchAckBase, 1, `${agent}: match ACK baseline uses prior high-water`);
  assert.equal(h.controller.status().lastAck, 0, `${agent}: ACK baseline resets per match`);
  assert.equal((h.audit.traces.at(-1) as Message).unackedInputs, 1,
    `${agent}: zero ACK is measured from the match baseline`);
  await h.controller.handle(state(agent, 2, 1));
  assert.equal(h.controller.status().localSeq, 4);
  assert.equal(h.controller.status().lastAck, 1, `${agent}: stale high-water ACK is valid in a new match`);
  assert.equal((h.audit.traces.at(-1) as Message).unackedInputs, 2);
  await h.controller.handle(state(agent, 3, 2));
  assert.equal(h.controller.status().connectionAckHighWater, 2,
    `${agent}: server ACK advances independently of client send count`);
  assert.equal((h.audit.traces.at(-1) as Message).unackedInputs, 2);
}
console.log('PASS  BLANK and MEGAWATTS reconcile client sends with global server ACK across matches');

const noHuman = harness('blank');
await noHuman.controller.handle({ t: 'hi', service: 'ringside-bot', ...exactBuild });
await noHuman.controller.handle({
  t: 'welcome', name: AGENTS.blank.handle, fp: AGENTS.blank.fingerprint,
  roster: [...PINNED_ROSTER], channel: 'bot-api', playerType: 'bot', ...exactBuild,
});
await assert.rejects(noHuman.controller.handle({
  t: 'matchStart', mid: 'human', role: 'a', yourCursor: 2, oppName: 'HUMAN',
  oppCursor: 11, oppType: 'human', stage: 'dojo', ...exactBuild,
}), /bot-only/);
assert.equal(noHuman.sent.some((row) => row.t === 'input'), false);
console.log('PASS  human pairings and incomplete match bindings fail before combat input');

const runtimeChanged = harness('blank');
await runtimeChanged.controller.handle({ t: 'hi', service: 'ringside-bot', ...exactBuild });
const driftCommit = '1234567890abcdef1234567890abcdef12345678';
await assert.rejects(runtimeChanged.controller.handle({
  t: 'welcome', name: AGENTS.blank.handle, fp: AGENTS.blank.fingerprint,
  roster: [...PINNED_ROSTER], channel: 'bot-api', playerType: 'bot',
  engine: EXPECTED_ENGINE, commit: driftCommit, dirty: false,
  build: `${EXPECTED_ENGINE}@${driftCommit.slice(0, 12)}`,
  protocol: EXPECTED_PROTOCOL, schema: EXPECTED_SCHEMA_PATH,
}), /changed after preflight/);
assert.equal(runtimeChanged.sent.some((row) => row.t === 'queue'), false);
console.log('PASS  transport attestation cannot change after the API-derived preflight commit');

const protocol = harness('megawatts');
await enter('megawatts', protocol);
await assert.rejects(protocol.controller.handle(state('megawatts', 1, 0, {
  opp: { ...fighter('CODEX'), hitboxActive: undefined },
})), /complete protocol-2/);
await protocol.controller.handle(state('megawatts', 1, 0));
await assert.rejects(protocol.controller.handle(state('megawatts', 2, 99)), /ack/);
console.log('PASS  incomplete protocol-2 observations and impossible ACKs fail closed');

const stop = harness('blank');
await enter('blank', stop);
stop.controller.stop();
await stop.controller.handle(state('blank', 1, 0));
assert.equal(stop.sent.filter((row) => row.t === 'input').length, 0);
assert.deepEqual(stop.sent.at(-1), { t: 'leave' });
await stop.controller.handle({ t: 'left' });
assert.equal(stop.isClosed(), true);
console.log('PASS  stop suppresses combat input and closes only after leave acknowledgement');

const binding = AGENTS.megawatts;
const valid = official('megawatts');
assert.equal(validateOfficial(valid, 'm1', binding, {
  role: 'a', oppName: 'OPP', oppCharacter: 'CODEX', runtimeCommit: runtime.commit,
}), valid);
assert.throws(() => validateOfficial({ match: {
  ...(valid.match as Message), engine_commit: 'wrong',
} }, 'm1', binding, {
  role: 'a', oppName: 'OPP', oppCharacter: 'CODEX', runtimeCommit: runtime.commit,
}), /attested sf-8/);
assert.throws(() => validateOfficial({ match: {
  ...(valid.match as Message), b_is_bot: 0,
} }, 'm1', binding, {
  role: 'a', oppName: 'OPP', oppCharacter: 'CODEX', runtimeCommit: runtime.commit,
}), /bot-pool/);
console.log('PASS  official evidence binds exact engine, identities, characters, and bot pool');

assert.deepEqual(normalizeInput({ t: 'input', moveX: 9, punch: 1 }), {
  t: 'input', moveX: 1, down: false, jump: false, punch: true,
  kick: false, throw: false, motion: 'N',
});
assert.throws(() => normalizeInput({ t: 'input', motion: 'Q' }), /invalid absolute motion/);
assert.throws(() => parseArgs(['--agent', 'blank', '--identity', '/tmp/k', '--out-dir', '/tmp/o']), /--armed/);
assert.equal(parseArgs([
  '--agent', 'megawatts', '--identity', '/tmp/k', '--out-dir', '/tmp/o', '--dry-run',
  '--requeue-delay-ms', '9000', '--requeue-jitter-ms', '9000',
]).requeueJitterMs, 9000);
assert.throws(() => parseArgs([
  '--agent', 'blank', '--identity', '/tmp/k', '--out-dir', '/tmp/o', '--dry-run',
  '--requeue-jitter-ms', '-1',
]), /non-negative integers/);
assert.throws(() => parseArgs([
  '--agent', 'blank', '--identity', '/tmp/k', '--out-dir', '/tmp/o', '--dry-run',
  '--requeue-delay-ms', '299999', '--requeue-jitter-ms', '2',
]), /at most/);
console.log('PASS  CLI arm gate, bounded requeue controls, and snapshot normalization are explicit');

const blankDelays = Array.from({ length: 32 }, (_, index) => computeRequeueDelayMs(
  AGENTS.blank.defaultSeed, index + 1, 1_000, 5_000,
));
const repeatedBlankDelays = Array.from({ length: 32 }, (_, index) => computeRequeueDelayMs(
  AGENTS.blank.defaultSeed, index + 1, 1_000, 5_000,
));
const megawattsDelays = Array.from({ length: 32 }, (_, index) => computeRequeueDelayMs(
  AGENTS.megawatts.defaultSeed, index + 1, 9_000, 9_000,
));
assert.deepEqual(blankDelays, repeatedBlankDelays);
assert.ok(new Set(blankDelays).size > 1);
assert.ok(blankDelays.every((delay) => delay >= 1_000 && delay <= 6_000));
assert.ok(megawattsDelays.every((delay) => delay >= 9_000 && delay <= 18_000));
console.log('PASS  seeded requeue jitter is reproducible, variable, bounded, and staggered by agent');

assert.throws(() => validatePreflight(
  { ok: true, service: 'sshfighter', engine: 'sf-7' }, {}, {},
), /version preflight runtime mismatch/);
const nextCommit = '1234567890abcdef1234567890abcdef12345678';
const nextBuild = `sf-8@${nextCommit.slice(0, 12)}`;
const compatibleSchema: Message = {
  protocolVersion: EXPECTED_PROTOCOL,
  generatedFor: {
    engine: EXPECTED_ENGINE, commit: nextCommit, commitShort: nextCommit.slice(0, 12),
    dirty: false, build: nextBuild, api: 1, botProtocol: EXPECTED_PROTOCOL,
  },
  attacks: { characters: PINNED_ROSTER.map((name) => ({ name })) },
  simulation: { inputSemantics: { omitted: 'snapshot; Send one decision per state' } },
};
const compatibleDigest = sha256(stable(schemaCompatibilityView(compatibleSchema)));
const compatibleEvidence = validatePreflight(
  {
    ok: true, service: 'sshfighter', engine: EXPECTED_ENGINE, commit: nextCommit,
    commitShort: nextCommit.slice(0, 12), dirty: false, build: nextBuild,
    botProtocol: EXPECTED_PROTOCOL,
  },
  {
    ok: true, service: 'ringside', engine: EXPECTED_ENGINE, commit: nextCommit,
    dirty: false, build: nextBuild,
  },
  compatibleSchema,
  compatibleDigest,
);
assert.equal(compatibleEvidence.runtime.commit, nextCommit);
assert.equal(classifyRuntime(compatibleEvidence.runtime), 'compatible-unreviewed-commit');
assert.deepEqual(runtimeDataBoundary(compatibleEvidence.runtime), {
  runtimeAlignment: 'compatible-unreviewed-commit',
  datasetPartition: `${EXPECTED_ENGINE}/${nextCommit}`,
  trainingEligibility: 'quarantined-pending-runtime-review',
});
const changedGeneratedFor = structuredClone(compatibleSchema);
(changedGeneratedFor.generatedFor as Message).commit = REVIEWED_BASELINE_COMMIT;
(changedGeneratedFor.generatedFor as Message).commitShort = REVIEWED_BASELINE_COMMIT.slice(0, 12);
(changedGeneratedFor.generatedFor as Message).build = REVIEWED_BASELINE_BUILD;
assert.equal(
  sha256(stable(schemaCompatibilityView(changedGeneratedFor))), compatibleDigest,
  'volatile build attestation must not rotate semantic compatibility',
);
const changedMechanics = structuredClone(compatibleSchema);
(changedMechanics.simulation as Message).tickHz = 31;
assert.throws(() => validatePreflight(
  {
    ok: true, service: 'sshfighter', engine: EXPECTED_ENGINE, commit: nextCommit,
    commitShort: nextCommit.slice(0, 12), dirty: false, build: nextBuild,
    botProtocol: EXPECTED_PROTOCOL,
  },
  {
    ok: true, service: 'ringside', engine: EXPECTED_ENGINE, commit: nextCommit,
    dirty: false, build: nextBuild,
  },
  changedMechanics,
  compatibleDigest,
), /compatibility hash mismatch/);
console.log('PASS  runtime commit drift continues only inside the reviewed semantic compatibility envelope');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'roster/agents.json'), 'utf8')) as {
  runners?: Array<{
    id: string; implementationSha256?: string; activation?: string;
    requeueDelayMs?: number; requeueJitterMs?: number;
    expectedEngine?: string; botProtocol?: number;
    botSchemaCompatibilitySha256?: string; runtimeCommitPolicy?: string;
    compatibleCommitDrift?: string;
  }>;
};
const implementationHash = computeRunnerImplementationHash(root);
const expectedRequeue = new Map([
  ['blanko-oscillator-standing-v3', [1_000, 5_000, 'sshfighter-blank-bot.service']],
  ['megawatts-resonant-standing-v3', [9_000, 9_000, 'sshfighter-megawattsbot.service']],
]);
for (const [id, [delayMs, jitterMs, service]] of expectedRequeue) {
  const entry = catalog.runners?.find((candidate) => candidate.id === id);
  assert.equal(entry?.implementationSha256, implementationHash, id);
  assert.equal(entry?.activation, 'independent-review-and-merge-required', id);
  assert.equal(entry?.requeueDelayMs, delayMs, id);
  assert.equal(entry?.requeueJitterMs, jitterMs, id);
  assert.equal(entry?.expectedEngine, EXPECTED_ENGINE, id);
  assert.equal(entry?.botProtocol, EXPECTED_PROTOCOL, id);
  assert.equal(entry?.botSchemaCompatibilitySha256, EXPECTED_SCHEMA_COMPATIBILITY_SHA256, id);
  assert.equal(entry?.runtimeCommitPolicy, 'derive-and-require-cross-surface-consistency', id);
  assert.equal(entry?.compatibleCommitDrift,
    'continue-with-warning-and-training-quarantine', id);
  const unit = readFileSync(resolve(root, 'deploy/systemd/user', String(service)), 'utf8');
  assert.ok(unit.includes(`--requeue-delay-ms ${String(delayMs)}`), id);
  assert.ok(unit.includes(`--requeue-jitter-ms ${String(jitterMs)}`), id);
}
console.log('PASS  standing profiles and service units pin implementation, cooldown bands, and review gate');
