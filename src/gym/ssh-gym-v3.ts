import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { botApiSchema } from '../../vendor/sshfighter-sf8/src/api/bot-schema.js';
import { botStateFor } from '../../vendor/sshfighter-sf8/src/api/bot-server.js';
import { makeFighter, makeMatch, stepMatch } from '../../vendor/sshfighter-sf8/src/game/engine.js';
import { specialMoveMotionCode, specialMovesFor } from '../../vendor/sshfighter-sf8/src/game/moves.js';
import { ROSTER } from '../../vendor/sshfighter-sf8/src/game/roster.js';
import { STAGES } from '../../vendor/sshfighter-sf8/src/game/stage-set.js';
import { emptyInputs, type Inputs, type Match } from '../../vendor/sshfighter-sf8/src/game/types.js';
import { VERSION_INFO } from '../../vendor/sshfighter-sf8/src/version.js';
import {
  PINNED_BOT_PROTOCOL, PINNED_BUILD, PINNED_ENGINE_VERSION, PINNED_ROSTER,
  PINNED_SCHEMA_PATH, PINNED_SCHEMA_SHA256, PINNED_VENDOR_COMMIT,
  PINNED_VENDOR_FILES, SSH_GYM_V3_IMPLEMENTATION_SHA256, SSH_GYM_V3_SCHEMA,
} from './ssh-gym-v3-provenance.js';

export type Side = 'a' | 'b';
export type ObservationProfile = 'bot-protocol-v2' | 'engine-oracle-v1';
export type ActuationProfile = 'snapshot-input-v2' | 'round-safe-fifo-v2';
export interface GymInput {
  moveX?: number; down?: boolean; jump?: boolean; punch?: boolean;
  kick?: boolean; throw?: boolean; motion?: string;
}
export interface ResetRequest {
  a: string; b: string; seed: number; stage: string;
  observationProfile?: ObservationProfile; actuationProfile?: ActuationProfile;
  inputDelayA?: number; inputDelayB?: number;
}
export interface StepRequest { n?: number; inputsA?: GymInput; inputsB?: GymInput }
export interface GymCommand extends Partial<ResetRequest>, Partial<StepRequest> { cmd?: string }

const moduleDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(moduleDir, '../..');
const vendorRoot = resolve(sourceRoot, 'vendor/sshfighter-sf8');
const IMPLEMENTATION_FILES = ['src/gym/ssh-gym-v3.ts', 'src/tools/ssh-gym-v3.ts'] as const;
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const sha256File = (path: string): string => sha256(readFileSync(path));
export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)));
});
const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function normalizeSnapshotInput(command: GymInput | undefined): Inputs {
  const raw = command ?? {};
  const moveX = Number(raw.moveX ?? 0);
  if (![-1, 0, 1].includes(moveX)) throw new Error('moveX must be -1, 0, or 1');
  const motion = String(raw.motion ?? 'N');
  if (!/^[LRDU]{1,8}$|^N$/.test(motion)) throw new Error('motion must be N or an absolute LRDU suffix');
  return {
    ...emptyInputs(), moveX, down: raw.down === true, jump: raw.jump === true,
    punch: raw.punch === true, kick: raw.kick === true, throw: raw.throw === true, motion,
  };
}

export class RoundSafeSnapshotFifo {
  private readonly queue: Inputs[] = [];
  constructor(public readonly delay: number) {
    if (!Number.isInteger(delay) || delay < 0 || delay > 120)
      throw new Error('input delay must be an integer from 0 to 120');
  }
  reset(): void { this.queue.length = 0; }
  emit(input: Inputs, phase: string): Inputs {
    if (phase !== 'fight') { this.reset(); return normalizeSnapshotInput({}); }
    if (this.delay === 0) return { ...input };
    this.queue.push({ ...input });
    return this.queue.length > this.delay ? this.queue.shift()! : normalizeSnapshotInput({});
  }
}

export function validateAgainstSchema(value: unknown, schema: any, root: any = schema, path = '$'): void {
  if (schema?.$ref) {
    const target = String(schema.$ref).split('/').slice(1)
      .reduce((cursor: any, key: string) => cursor?.[key], root);
    if (!target) throw new Error(`${path}: unresolved schema ref ${schema.$ref}`);
    return validateAgainstSchema(value, target, root, path);
  }
  const types = Array.isArray(schema?.type) ? schema.type : schema?.type ? [schema.type] : [];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const typeMatches = types.includes(actual) || (types.includes('integer') && actual === 'number' && Number.isInteger(value));
  if (types.length && !typeMatches) throw new Error(`${path}: expected ${types.join('|')}, got ${actual}`);
  if (actual === 'number' && schema?.minimum !== undefined && (value as number) < schema.minimum)
    throw new Error(`${path}: below minimum`);
  if (actual === 'number' && schema?.maximum !== undefined && (value as number) > schema.maximum)
    throw new Error(`${path}: above maximum`);
  if (schema?.const !== undefined && value !== schema.const) throw new Error(`${path}: const mismatch`);
  if (schema?.enum && !schema.enum.includes(value)) throw new Error(`${path}: enum mismatch`);
  if (actual === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) throw new Error(`${path}.${key}: required field missing`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in object) validateAgainstSchema(object[key], child, root, `${path}.${key}`);
    }
  }
  if (actual === 'array' && schema.items) {
    (value as unknown[]).forEach((item, index) => validateAgainstSchema(item, schema.items, root, `${path}[${index}]`));
  }
}

export function sshGymV3Provenance(): any {
  const files = Object.fromEntries(Object.keys(PINNED_VENDOR_FILES).map((relative) => [
    relative, sha256File(resolve(vendorRoot, relative)),
  ]));
  const implementationFiles = Object.fromEntries(IMPLEMENTATION_FILES.map((relative) => [
    relative, sha256File(resolve(sourceRoot, relative)),
  ]));
  const schemaSha256 = sha256(canonicalJson(botApiSchema()));
  return {
    schema: SSH_GYM_V3_SCHEMA,
    implementationSha256: sha256(canonicalJson(implementationFiles)),
    source: {
      commit: git('-C', sourceRoot, 'rev-parse', 'HEAD'),
      dirty: git('-C', sourceRoot, 'status', '--porcelain', '--untracked-files=no') !== '',
    },
    vendor: {
      repository: 'https://github.com/thomasdavis/sshfighter.com.git',
      commit: git('-C', vendorRoot, 'rev-parse', 'HEAD'),
      dirty: git('-C', vendorRoot, 'status', '--porcelain', '--untracked-files=no') !== '',
      engine: VERSION_INFO.engine, build: VERSION_INFO.build, botProtocol: VERSION_INFO.botProtocol,
      schemaPath: PINNED_SCHEMA_PATH, schemaSha256, files,
      combinedSourceSha256: sha256(canonicalJson(files)),
    },
    runtimeProfile: {
      id: `${VERSION_INFO.build}/bot-protocol-${VERSION_INFO.botProtocol}`,
      canonicalDeployCommitAttested: true,
      observationProfiles: ['bot-protocol-v2', 'engine-oracle-v1'],
      actuationProfiles: ['snapshot-input-v2', 'round-safe-fifo-v2'],
      roster: ROSTER.map((fighter) => fighter.name), stages: STAGES.ids().sort(),
    },
  };
}

export function assertSshGymV3Provenance(): any {
  const p = sshGymV3Provenance();
  const problems: string[] = [];
  if (p.implementationSha256 !== SSH_GYM_V3_IMPLEMENTATION_SHA256) problems.push('implementation digest mismatch');
  if (p.vendor.commit !== PINNED_VENDOR_COMMIT || p.vendor.dirty) problems.push('vendor commit/cleanliness mismatch');
  if (p.vendor.engine !== PINNED_ENGINE_VERSION || p.vendor.build !== PINNED_BUILD
      || p.vendor.botProtocol !== PINNED_BOT_PROTOCOL) problems.push('engine/build/protocol mismatch');
  if (p.vendor.schemaSha256 !== PINNED_SCHEMA_SHA256) problems.push('bot schema digest mismatch');
  if (canonicalJson(p.runtimeProfile.roster) !== canonicalJson(PINNED_ROSTER)) problems.push('ordered roster mismatch');
  for (const [relative, expected] of Object.entries(PINNED_VENDOR_FILES)) {
    if (p.vendor.files[relative] !== expected) problems.push(`${relative} digest mismatch`);
  }
  if (problems.length) throw new Error(`SSH Gym v3 provenance mismatch: ${problems.join('; ')}`);
  return p;
}

function oracle(match: Match): object {
  return { frame: match.frame, phase: match.phase, round: match.round, roundTime: match.roundTime,
    hitStop: match.hitStop, stage: match.stage, a: match.a, b: match.b, projectiles: match.projectiles };
}

export class SshGymV3 {
  private match: Match | null = null;
  private observationProfile: ObservationProfile = 'bot-protocol-v2';
  private actuationProfile: ActuationProfile = 'snapshot-input-v2';
  private fifoA = new RoundSafeSnapshotFifo(0);
  private fifoB = new RoundSafeSnapshotFifo(0);
  private ackA = 0;
  private ackB = 0;
  private random: () => number = () => 0;

  private withRandom<T>(action: () => T): T {
    const prior = Math.random; Math.random = this.random;
    try { return action(); } finally { Math.random = prior; }
  }
  private requireMatch(): Match {
    if (!this.match) throw new Error('match is not initialized; call reset first');
    return this.match;
  }
  state(): object {
    const match = this.requireMatch();
    if (this.observationProfile === 'engine-oracle-v1') return oracle(match);
    const schema = botApiSchema() as any;
    const a = botStateFor('a', match, this.ackA);
    const b = botStateFor('b', match, this.ackB);
    validateAgainstSchema(a, schema.serverMessages.state, schema);
    validateAgainstSchema(b, schema.serverMessages.state, schema);
    return { profile: 'bot-protocol-v2', a, b };
  }
  version(): object { return { schema: SSH_GYM_V3_SCHEMA, provenance: assertSshGymV3Provenance(), transportClaim: 'none-offline-live-observation-parity' }; }
  schema(): object { assertSshGymV3Provenance(); return botApiSchema(); }
  roster(): object[] {
    return ROSTER.map((fighter) => ({ name: fighter.name, specials: specialMovesFor(fighter.name).map((move) => ({
      attack: move.attack, button: move.button,
      motionRight: specialMoveMotionCode(move, 1), motionLeft: specialMoveMotionCode(move, -1),
    })) }));
  }
  reset(request: ResetRequest): object {
    if (!Number.isInteger(request.seed)) throw new Error('reset seed must be an integer');
    const a = String(request.a).toUpperCase(), b = String(request.b).toUpperCase();
    const roster = new Set(ROSTER.map((fighter) => fighter.name));
    if (!roster.has(a) || !roster.has(b)) throw new Error('unknown fighter');
    if (!STAGES.has(request.stage)) throw new Error('unknown stage');
    const observation = request.observationProfile ?? 'bot-protocol-v2';
    const actuation = request.actuationProfile ?? 'snapshot-input-v2';
    if (!['bot-protocol-v2', 'engine-oracle-v1'].includes(observation)) throw new Error('unknown observation profile');
    if (!['snapshot-input-v2', 'round-safe-fifo-v2'].includes(actuation)) throw new Error('unknown actuation profile');
    const delayA = request.inputDelayA ?? 0, delayB = request.inputDelayB ?? 0;
    if (actuation === 'snapshot-input-v2' && (delayA !== 0 || delayB !== 0)) throw new Error('snapshot-input-v2 requires zero delay');
    let state = request.seed >>> 0;
    this.random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.observationProfile = observation as ObservationProfile;
    this.actuationProfile = actuation as ActuationProfile;
    this.fifoA = new RoundSafeSnapshotFifo(delayA); this.fifoB = new RoundSafeSnapshotFifo(delayB);
    this.ackA = 0; this.ackB = 0;
    this.match = this.withRandom(() => makeMatch(makeFighter('a', a, 'a'), makeFighter('b', b, 'b')));
    this.match.stage = request.stage;
    return this.state();
  }
  step(request: StepRequest): { state: object; appliedA: Inputs; appliedB: Inputs } {
    const match = this.requireMatch();
    const n = request.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error('step n must be 1..10000');
    let appliedA = normalizeSnapshotInput({}), appliedB = normalizeSnapshotInput({});
    for (let index = 0; index < n; index++) {
      const requestedA = normalizeSnapshotInput(request.inputsA), requestedB = normalizeSnapshotInput(request.inputsB);
      appliedA = this.actuationProfile === 'round-safe-fifo-v2' ? this.fifoA.emit(requestedA, match.phase) : requestedA;
      appliedB = this.actuationProfile === 'round-safe-fifo-v2' ? this.fifoB.emit(requestedB, match.phase) : requestedB;
      this.ackA++; this.ackB++;
      this.withRandom(() => stepMatch(match, appliedA, appliedB));
    }
    return { state: this.state(), appliedA, appliedB };
  }
  handle(message: GymCommand): object {
    switch (message?.cmd) {
      case 'ping': return { ok: true, pong: true };
      case 'version': return { ok: true, ...this.version() };
      case 'provenance': return { ok: true, provenance: assertSshGymV3Provenance() };
      case 'schema': return { ok: true, schema: this.schema() };
      case 'roster': return { ok: true, roster: this.roster() };
      case 'reset': return { ok: true, state: this.reset(message as unknown as ResetRequest) };
      case 'state': return { ok: true, state: this.state() };
      case 'step': return { ok: true, ...this.step(message) };
      default: throw new Error(`unknown command: ${String(message?.cmd)}`);
    }
  }
}
