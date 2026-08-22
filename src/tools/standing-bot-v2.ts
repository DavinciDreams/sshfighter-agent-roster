#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { createMegaInnovationPolicy } from '../policies/mega-innovation-router.mjs';
import { createWirePolicy as createMegawattsPolicy } from '../policies/megawatts-resonant-policy.js';

export const RUNNER_SCHEMA = 'sshfighter-standing-bot/v2';
export const EXPECTED_ENGINE = 'sf-8';
export const EXPECTED_COMMIT = '838924f24b177f2a1eee0786578c3bd44d093108';
export const EXPECTED_BUILD = 'sf-8@838924f24b17';
export const EXPECTED_PROTOCOL = 2;
export const EXPECTED_SCHEMA_PATH = '/api/bot/schema';
export const EXPECTED_SCHEMA_SHA256 = '965f1b33bcfa1e4fc34f41ed5d10fbfbdddc3816636652769ec7dca237c5f528';
export const PINNED_ROSTER = [
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO',
  'KIRA', 'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON',
  'MEGAWATTS', 'UNCLOSE',
] as const;
export const RUNNER_IMPLEMENTATION_FILES = [
  'src/tools/standing-bot-v2.ts',
  'src/policies/static-router-gym.mjs',
  'src/policies/mega-innovation-router.mjs',
  'src/policies/megawatts-innovation-policy.ts',
  'src/policies/megawatts-resonant-policy.ts',
] as const;

export type AgentId = 'blank' | 'megawatts';
type JsonObject = Record<string, unknown>;

export interface CompleteInput extends JsonObject {
  t: 'input'; moveX: -1 | 0 | 1; down: boolean; jump: boolean;
  punch: boolean; kick: boolean; throw: boolean; motion: string;
}

export interface AgentBinding {
  agent: AgentId;
  handle: string;
  fingerprint: string;
  character: 'BLANKO' | 'MEGAWATTS';
  policyId: string;
  defaultSeed: number;
}

export const AGENTS: Readonly<Record<AgentId, AgentBinding>> = Object.freeze({
  blank: Object.freeze({
    agent: 'blank', handle: 'BLANK-BOT',
    fingerprint: 'SHA256:xd/3Gvx2khlsWD2qBEU2kR7CUaMn1TDUTIV7qxNK7R8',
    character: 'BLANKO', policyId: 'blanko-oscillator-resonant-v1', defaultSeed: 20260822,
  }),
  megawatts: Object.freeze({
    agent: 'megawatts', handle: 'MEGAWATTSBOT',
    fingerprint: 'SHA256:Zb/rg2d5XEjD6tU5a3aS6CLjrAiDOAh41Tlj55TeFRE',
    character: 'MEGAWATTS', policyId: 'megawatts-resonant-v1', defaultSeed: 0x4d575454,
  }),
});

export interface RunnerOptions {
  agent: AgentId;
  identity: string;
  outDir: string;
  host: string;
  seed: number;
  armed: boolean;
  dryRun: boolean;
  requeueDelayMs: number;
}

export interface PolicyBinding {
  decide(state: JsonObject): { action: JsonObject; reason: string };
  reset(): void;
  status(): JsonObject;
}

export interface AuditSink {
  append(event: string, payload?: unknown): void;
  beginMatch(mid: string, payload: unknown): void;
  trace(payload: unknown): void;
  endMatch(payload: unknown): void;
  close(): void;
}

export interface ControllerIo {
  send(message: JsonObject): void;
  close(): void;
  audit: AuditSink;
  fetchOfficial(mid: string): Promise<unknown>;
  schedule(fn: () => void, delayMs: number): unknown;
  nowNs(): bigint;
}

export interface SshChild {
  stdin: Writable;
  stdout: Readable;
  on(event: 'exit', handler: (code: number | null) => void): unknown;
  on(event: 'error', handler: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnSsh = (command: string, args: readonly string[]) => SshChild;

export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as JsonObject)
      .sort(([a], [b]) => a.localeCompare(b)));
  });
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeRunnerImplementationHash(
  root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
): string {
  const digest = createHash('sha256');
  for (const file of RUNNER_IMPLEMENTATION_FILES) {
    digest.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0');
  }
  return digest.digest('hex');
}

function exactArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

export function assertExactBuild(message: JsonObject, label: string): void {
  if (message.engine !== EXPECTED_ENGINE || message.commit !== EXPECTED_COMMIT
      || message.dirty !== false || message.build !== EXPECTED_BUILD
      || message.protocol !== EXPECTED_PROTOCOL || message.schema !== EXPECTED_SCHEMA_PATH) {
    throw new Error(`${label} runtime mismatch: require exact clean ${EXPECTED_BUILD} protocol ${EXPECTED_PROTOCOL}`);
  }
}

export function validatePreflight(version: unknown, health: unknown, schema: unknown): JsonObject {
  const v = version as JsonObject;
  const h = health as JsonObject;
  const s = schema as JsonObject;
  if (v?.ok !== true || v.service !== 'sshfighter' || v.engine !== EXPECTED_ENGINE
      || v.commit !== EXPECTED_COMMIT || v.dirty !== false || v.build !== EXPECTED_BUILD
      || v.botProtocol !== EXPECTED_PROTOCOL) throw new Error('version preflight mismatch');
  if (h?.ok !== true || h.service !== 'ringside' || h.engine !== EXPECTED_ENGINE
      || h.commit !== EXPECTED_COMMIT || h.dirty !== false || h.build !== EXPECTED_BUILD) {
    throw new Error('health preflight mismatch');
  }
  const generated = s?.generatedFor as JsonObject;
  const roster = (s?.attacks as JsonObject)?.characters;
  const rosterNames = Array.isArray(roster) ? roster.map((entry) => (entry as JsonObject)?.name) : [];
  const inputSemantics = ((s?.simulation as JsonObject)?.inputSemantics as JsonObject)?.omitted;
  if (s?.protocolVersion !== EXPECTED_PROTOCOL || generated?.engine !== EXPECTED_ENGINE
      || generated?.commit !== EXPECTED_COMMIT || generated?.dirty !== false
      || generated?.build !== EXPECTED_BUILD || !exactArray(rosterNames, PINNED_ROSTER)
      || typeof inputSemantics !== 'string' || !inputSemantics.includes('snapshot')
      || !inputSemantics.includes('Send one decision per state')) throw new Error('bot schema contract mismatch');
  const digest = sha256(stable(s));
  if (digest !== EXPECTED_SCHEMA_SHA256) {
    throw new Error(`bot schema hash mismatch: expected ${EXPECTED_SCHEMA_SHA256}, received ${digest}`);
  }
  return { version: v, health: h, schemaSha256: digest };
}

export function normalizeInput(action: JsonObject): CompleteInput {
  const rawMove = Number(action.moveX) || 0;
  const moveX = (rawMove < 0 ? -1 : rawMove > 0 ? 1 : 0) as -1 | 0 | 1;
  const motion = typeof action.motion === 'string' && action.motion ? action.motion : 'N';
  if (!/^(N|[LRDU]{1,8})$/.test(motion)) throw new Error('policy emitted an invalid absolute motion suffix');
  return {
    t: 'input', moveX, down: Boolean(action.down), jump: Boolean(action.jump),
    punch: Boolean(action.punch), kick: Boolean(action.kick), throw: Boolean(action.throw),
    motion,
  };
}

export function createPolicyBinding(agent: AgentId, seed: number): PolicyBinding {
  if (agent === 'blank') {
    const policy = createMegaInnovationPolicy(
      'blanko-oscillator-v1', 'innovation-resonant', seed,
    );
    return {
      decide: (state) => {
        const result = policy.decide(state);
        return { action: result.action, reason: result.reason };
      },
      reset: () => policy.reset(),
      status: () => policy.status(),
    };
  }
  const policy = createMegawattsPolicy({ seed });
  return {
    decide: (state) => ({
      action: policy.decide(state as never) as unknown as JsonObject,
      reason: 'megawatts-resonant',
    }),
    reset: () => policy.reset(),
    status: () => policy.status() as unknown as JsonObject,
  };
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function assertFighter(value: unknown, expectedCharacter: string, label: string): void {
  const fighter = asObject(value, label);
  const requiredNumbers = ['x', 'y', 'vx', 'vy', 'hp', 'wins', 'attackFrame', 'stun',
    'invulnerabilityFrames', 'armorFrames', 'thrownFrames'];
  if (fighter.character !== expectedCharacter
      || !requiredNumbers.every((key) => Number.isFinite(fighter[key]))
      || ![-1, 1].includes(Number(fighter.facing))
      || typeof fighter.attack !== 'string' || typeof fighter.movePhase !== 'string'
      || typeof fighter.hitboxActive !== 'boolean' || typeof fighter.attackConnected !== 'boolean'
      || typeof fighter.blocking !== 'boolean' || typeof fighter.invulnerable !== 'boolean'
      || typeof fighter.armored !== 'boolean' || typeof fighter.actionable !== 'boolean') {
    throw new Error(`${label} is not a complete protocol-2 fighter observation`);
  }
}

export function validateOfficial(
  payload: unknown, mid: string, binding: AgentBinding, match: JsonObject,
): JsonObject {
  const root = asObject(payload, 'official payload');
  const official = asObject(root.match, 'official match');
  if (official.id !== mid || official.mode !== 'versus' || official.engine_version !== EXPECTED_ENGINE
      || official.engine_commit !== EXPECTED_COMMIT || Number(official.engine_dirty) !== 0) {
    throw new Error('official result is not bound to the exact sf-8 match');
  }
  const role = match.role;
  const ownPrefix = role === 'a' ? 'a' : 'b';
  const oppPrefix = role === 'a' ? 'b' : 'a';
  if (official[`${ownPrefix}_name`] !== binding.handle
      || official[`${ownPrefix}_char`] !== binding.character
      || Number(official[`${ownPrefix}_is_bot`]) !== 1
      || official[`${oppPrefix}_name`] !== match.oppName
      || official[`${oppPrefix}_char`] !== match.oppCharacter
      || Number(official[`${oppPrefix}_is_bot`]) !== 1) {
    throw new Error('official result identity, character, or bot-pool mismatch');
  }
  return root;
}

export function createStandingController(
  options: RunnerOptions, policy: PolicyBinding, io: ControllerIo,
) {
  const binding = AGENTS[options.agent];
  const implementationSha256 = computeRunnerImplementationHash();
  let activeMatch: JsonObject | null = null;
  let localSeq = 0;
  let matchSeqBase = 0;
  let connectionAckHighWater = 0;
  let matchAckBase = 0;
  let lastAck = 0;
  let lastFrame = -1;
  let completed = 0;
  let wins = 0;
  let losses = 0;
  let stopping = false;

  const queue = (): void => {
    if (!stopping) io.send({ t: 'queue', char: binding.character, opponents: 'bots' });
  };
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    io.audit.append('stop-requested', { completed, wins, losses });
    io.send({ t: 'leave' });
  };

  async function handle(message: JsonObject): Promise<void> {
    switch (message.t) {
      case 'hi':
        assertExactBuild(message, 'hi');
        if (message.service !== 'ringside-bot') throw new Error('unexpected SSH play service');
        io.audit.append('transport-attested', { build: message.build, protocol: message.protocol });
        return;
      case 'welcome':
        assertExactBuild(message, 'welcome');
        if (message.name !== binding.handle || message.fp !== binding.fingerprint
            || message.channel !== 'bot-api' || message.playerType !== 'bot'
            || !exactArray(message.roster, PINNED_ROSTER)) {
          throw new Error('authenticated identity or roster mismatch');
        }
        io.audit.append('identity-attested', {
          handle: binding.handle, fingerprint: binding.fingerprint, character: binding.character,
        });
        queue();
        return;
      case 'queued':
        if (message.char !== binding.character || message.opponents !== 'bots') {
          throw new Error('server did not accept exact bot-only queue');
        }
        io.audit.append('queued', { character: binding.character, opponents: 'bots' });
        return;
      case 'matchStart': {
        assertExactBuild(message, 'matchStart');
        const role = message.role;
        const mid = String(message.mid ?? '');
        const oppCursor = Number(message.oppCursor);
        const ownCursor = Number(message.yourCursor);
        if (!/^[A-Za-z0-9_-]+$/.test(mid)
            || (role !== 'a' && role !== 'b') || message.oppType !== 'bot'
            || PINNED_ROSTER[ownCursor] !== binding.character
            || !Number.isInteger(oppCursor) || !PINNED_ROSTER[oppCursor]) {
          throw new Error('matchStart violated character or bot-only binding');
        }
        activeMatch = {
          mid, role, oppName: String(message.oppName),
          oppCharacter: PINNED_ROSTER[oppCursor], stage: String(message.stage),
        };
        matchSeqBase = localSeq;
        matchAckBase = connectionAckHighWater;
        lastAck = 0;
        lastFrame = -1;
        policy.reset();
        io.audit.beginMatch(mid, {
          ...activeMatch, runnerSchema: RUNNER_SCHEMA, build: EXPECTED_BUILD,
          protocol: EXPECTED_PROTOCOL, schemaSha256: EXPECTED_SCHEMA_SHA256,
          agent: options.agent, handle: binding.handle, fingerprint: binding.fingerprint,
          character: binding.character, policyId: binding.policyId, seed: options.seed,
          implementationSha256,
        });
        return;
      }
      case 'state': {
        if (!activeMatch || stopping) return;
        const frame = Number(message.frame);
        const ack = Number(message.ack);
        const validAck = Number.isInteger(ack) && ack >= 0 && ack <= localSeq
          && (ack === 0
            ? lastAck === 0
            : ack >= connectionAckHighWater && (lastAck === 0 || ack >= lastAck));
        if (!Number.isInteger(frame) || frame <= lastFrame || !validAck
            || !Array.isArray(message.projectiles)) {
          throw new Error(`state ordering, ack, or projectile contract violation: frame=${String(message.frame)} lastFrame=${lastFrame} ack=${String(message.ack)} lastAck=${lastAck} connectionAckHighWater=${connectionAckHighWater} localSeq=${localSeq} matchSeqBase=${matchSeqBase} matchAckBase=${matchAckBase} projectilesArray=${Array.isArray(message.projectiles)}`);
        }
        if (!['countdown', 'fight', 'round-over', 'match-over'].includes(String(message.phase))
            || !Number.isInteger(message.round) || !Number.isFinite(message.roundTime)
            || !Number.isInteger(message.hitStop)) {
          throw new Error('state phase, round, clock, or hit-stop contract violation');
        }
        assertFighter(message.you, binding.character, 'state.you');
        assertFighter(message.opp, String(activeMatch.oppCharacter), 'state.opp');
        for (const projectile of message.projectiles) {
          const p = asObject(projectile, 'projectile');
          if (!Number.isInteger(p.id) || !['you', 'opponent'].includes(String(p.ownedBy))
              || typeof p.dangerous !== 'boolean' || typeof p.canHit !== 'boolean'
              || !Number.isFinite(p.x) || !Number.isFinite(p.y)
              || !Number.isFinite(p.vx) || !Number.isFinite(p.vy)) {
            throw new Error('incomplete protocol-2 projectile observation');
          }
        }
        const skipped = lastFrame < 0 ? 0 : Math.max(0, frame - lastFrame - 1);
        const policyState = { ...message, transportSkippedFrames: skipped };
        const started = io.nowNs();
        const decision = policy.decide(policyState);
        const action = normalizeInput(decision.action);
        const decisionNs = io.nowNs() - started;
        localSeq++;
        if (ack > 0) connectionAckHighWater = ack;
        lastAck = ack;
        lastFrame = frame;
        const matchSent = localSeq - matchSeqBase;
        const matchAcknowledged = Math.min(matchSent, Math.max(0, ack - matchAckBase));
        io.send(action);
        io.audit.trace({
          t: 'state-decision', receivedAtNs: started.toString(), frame, ack,
          localSeq, matchSeqBase, connectionAckHighWater, matchAckBase,
          unackedInputs: matchSent - matchAcknowledged, skippedFrames: skipped,
          decisionNs: decisionNs.toString(), reason: decision.reason,
          state: message, action, policy: policy.status(),
        });
        return;
      }
      case 'matchEnd': {
        if (!activeMatch) throw new Error('matchEnd without an active match');
        const match = activeMatch;
        activeMatch = null;
        const result = asObject(message.result, 'match result');
        if (typeof result.youWon !== 'boolean' || typeof result.winner !== 'string'
            || typeof result.loser !== 'string') throw new Error('incomplete matchEnd result');
        const official = validateOfficial(
          await io.fetchOfficial(String(match.mid)), String(match.mid), binding, match,
        );
        const officialMatch = asObject(official.match, 'official match');
        const expectedWinnerSide = result.youWon ? match.role : match.role === 'a' ? 'b' : 'a';
        if (officialMatch.winner !== expectedWinnerSide
            || result.winner !== officialMatch[`${expectedWinnerSide}_name`]
            || result.loser !== officialMatch[`${expectedWinnerSide === 'a' ? 'b' : 'a'}_name`]) {
          throw new Error('matchEnd winner does not match official result');
        }
        result.youWon === true ? wins++ : losses++;
        completed++;
        io.audit.endMatch({ result, official, policy: policy.status(), completed, wins, losses });
        if (!stopping) io.schedule(queue, options.requeueDelayMs);
        return;
      }
      case 'left':
        if (stopping) io.close();
        return;
      case 'error':
        throw new Error(`server error ${String(message.code ?? '')}: ${String(message.msg ?? '')}`);
      default:
        io.audit.append('server-message', message);
    }
  }

  return {
    handle, stop,
    status: () => ({
      activeMatch, localSeq, matchSeqBase, connectionAckHighWater, matchAckBase,
      lastAck, lastFrame, completed, wins, losses, stopping,
    }),
  };
}

function writeRow(fd: number, event: string, payload: unknown): void {
  writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), event, payload })}\n`);
}

export class DirectoryAudit implements AuditSink {
  private lifecycleFd: number;
  private matchFd: number | null = null;

  constructor(private readonly outDir: string, sessionId = new Date().toISOString().replace(/[:.]/g, '-')) {
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    this.lifecycleFd = openSync(resolve(outDir, `session-${sessionId}.jsonl`), 'ax', 0o600);
  }

  append(event: string, payload: unknown = {}): void { writeRow(this.lifecycleFd, event, payload); }
  beginMatch(mid: string, payload: unknown): void {
    if (this.matchFd !== null) throw new Error('trace rotation attempted with open match');
    if (!/^[A-Za-z0-9_-]+$/.test(mid)) throw new Error('unsafe match id');
    this.matchFd = openSync(resolve(this.outDir, `match-${mid}.jsonl`), 'ax', 0o600);
    writeRow(this.matchFd, 'match-start', payload);
    this.append('match-start', payload);
  }
  trace(payload: unknown): void {
    if (this.matchFd === null) throw new Error('trace without open match');
    writeRow(this.matchFd, 'trace', payload);
  }
  endMatch(payload: unknown): void {
    if (this.matchFd === null) throw new Error('match end without open trace');
    writeRow(this.matchFd, 'match-end', payload);
    closeSync(this.matchFd); this.matchFd = null;
    this.append('match-end', payload);
  }
  close(): void {
    if (this.matchFd !== null) { closeSync(this.matchFd); this.matchFd = null; }
    closeSync(this.lifecycleFd);
  }
}

export function parseArgs(argv: readonly string[]): RunnerOptions {
  const values: Record<string, string> = {};
  let armed = false, dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--armed') { armed = true; continue; }
    if (key === '--dry-run') { dryRun = true; continue; }
    if (!key?.startsWith('--')) throw new Error(`unexpected argument: ${String(key)}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    values[key.slice(2)] = value;
  }
  const agent = values.agent as AgentId;
  if (!AGENTS[agent]) throw new Error('--agent must be blank or megawatts');
  if (!values.identity) throw new Error('--identity is required');
  if (!values['out-dir']) throw new Error('--out-dir is required');
  const seed = values.seed === undefined ? AGENTS[agent].defaultSeed : Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be uint32');
  if (!dryRun && !armed) throw new Error('live standing execution requires --armed');
  return {
    agent, identity: resolve(values.identity), outDir: resolve(values['out-dir']),
    host: values.host ?? 'sshfighter.com', seed, armed, dryRun,
    requeueDelayMs: 800,
  };
}

export function validateIdentity(path: string): void {
  if (!existsSync(path)) throw new Error(`identity does not exist: ${path}`);
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error('identity must be a regular file with no group/world permissions');
    }
  } finally { closeSync(fd); }
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export async function preflight(host: string): Promise<JsonObject> {
  const base = `https://${host}`;
  const [version, health, schema] = await Promise.all([
    getJson(`${base}/version`), getJson(`${base}/api/health`), getJson(`${base}${EXPECTED_SCHEMA_PATH}`),
  ]);
  return validatePreflight(version, health, schema);
}

async function fetchOfficial(host: string, mid: string): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return await getJson(`https://${host}/api/matches/${encodeURIComponent(mid)}`); }
    catch (error) { last = error; await new Promise((done) => setTimeout(done, 250 * (attempt + 1))); }
  }
  throw last instanceof Error ? last : new Error('official match unavailable');
}

export async function executeRunner(
  options: RunnerOptions,
  deps: { spawnSsh?: SpawnSsh } = {},
): Promise<void> {
  validateIdentity(options.identity);
  const policy = createPolicyBinding(options.agent, options.seed);
  const binding = AGENTS[options.agent];
  const implementationSha256 = computeRunnerImplementationHash();
  if (options.dryRun) {
    console.log(JSON.stringify({
      runnerSchema: RUNNER_SCHEMA, dryRun: true, agent: options.agent,
      handle: binding.handle, fingerprint: binding.fingerprint, character: binding.character,
      policyId: binding.policyId, seed: options.seed, build: EXPECTED_BUILD,
      commit: EXPECTED_COMMIT, protocol: EXPECTED_PROTOCOL, schemaSha256: EXPECTED_SCHEMA_SHA256,
      implementationSha256,
      transport: 'ssh-play', opponents: 'bots', identity: basename(options.identity),
    }, null, 2));
    return;
  }
  const preflightEvidence = await preflight(options.host);
  const audit = new DirectoryAudit(options.outDir);
  audit.append('session-manifest', {
    runnerSchema: RUNNER_SCHEMA, agent: options.agent, handle: binding.handle,
    fingerprint: binding.fingerprint, character: binding.character, policyId: binding.policyId,
    seed: options.seed, transport: 'ssh-play', opponents: 'bots', preflight: preflightEvidence,
    implementationSha256,
  });
  const sshArgs = [
    '-T', '-i', options.identity, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    `${binding.handle}@${options.host}`, 'play',
  ];
  const spawnSsh = deps.spawnSsh ?? ((command, args) => spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as SshChild);
  const child = spawnSsh('ssh', sshArgs);
  let done!: () => void;
  let fail!: (error: Error) => void;
  const completion = new Promise<void>((resolvePromise, rejectPromise) => {
    done = resolvePromise; fail = rejectPromise;
  });
  let closed = false;
  let fatalError: Error | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    try { child.stdin.end(); } catch { /* already closed */ }
  };
  const controller = createStandingController(options, policy, {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    close,
    audit,
    fetchOfficial: (mid) => fetchOfficial(options.host, mid),
    schedule: (fn, delay) => setTimeout(fn, delay),
    nowNs: () => process.hrtime.bigint(),
  });
  const lines = readline.createInterface({ input: child.stdout });
  let chain = Promise.resolve();
  lines.on('line', (raw) => {
    const line = raw.trim();
    if (!line || !line.startsWith('{')) return;
    chain = chain.then(async () => controller.handle(JSON.parse(line) as JsonObject)).catch((error) => {
      fatalError = error instanceof Error ? error : new Error(String(error));
      audit.append('fatal', { message: fatalError.message });
      controller.stop();
    });
  });
  const keepalive = setInterval(() => {
    if (!controller.status().stopping) child.stdin.write(`${JSON.stringify({ t: 'ping' })}\n`);
  }, 30_000);
  const onSignal = (): void => controller.stop();
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  child.on('error', (error) => {
    fatalError = error;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  });
  child.on('exit', (code) => {
    clearInterval(keepalive); lines.close();
    audit.append('transport-exit', { code, status: controller.status() });
    if (fatalError) fail(fatalError);
    else if (code === 0 || controller.status().stopping) done();
    else fail(new Error(`ssh exited with code ${String(code)}`));
  });
  try { await completion; }
  finally {
    clearInterval(keepalive);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    audit.close();
  }
}

const main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (main) {
  executeRunner(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
