import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeFighter, makeMatch, stepMatch } from '../../vendor/sshfighter/src/game/engine.js';
import { specialMoveMotionCode, specialMovesFor } from '../../vendor/sshfighter/src/game/moves.js';
import { ROSTER } from '../../vendor/sshfighter/src/game/roster.js';
import { STAGES } from '../../vendor/sshfighter/src/game/stage-set.js';
import type { Fighter, Inputs, Match, Projectile } from '../../vendor/sshfighter/src/game/types.js';
import { ENGINE_VERSION } from '../../vendor/sshfighter/src/telemetry/recorder.js';
import {
  gymFighterView, gymInputs, gymStyles, seededGymRandom,
} from '../../vendor/sshfighter/src/tools/omega-gym.js';

import {
  PINNED_ENGINE_VERSION,
  PINNED_ROSTER,
  PINNED_VENDOR_COMMIT,
  PINNED_VENDOR_FILES,
  SSH_GYM_V2_IMPLEMENTATION_SHA256,
  SSH_GYM_V2_SCHEMA,
} from './ssh-gym-v2-provenance.js';

export const OBSERVATION_PROFILES = ['bot-wire-v1', 'engine-oracle-v1'] as const;
export type ObservationProfile = typeof OBSERVATION_PROFILES[number];
export const ACTUATION_PROFILES = ['direct-engine-input-v1', 'round-safe-fifo-v1'] as const;
export type ActuationProfile = typeof ACTUATION_PROFILES[number];
export type Side = 'a' | 'b';

export interface GymInput {
  moveX?: number;
  down?: boolean;
  jump?: boolean;
  punch?: boolean;
  kick?: boolean;
  throw?: boolean;
  motion?: string;
}

export interface ResetRequest {
  a: string;
  b: string;
  seed: number;
  stage: string;
  observationProfile?: ObservationProfile;
  actuationProfile?: ActuationProfile;
  inputDelayA?: number;
  inputDelayB?: number;
}

export interface StepRequest {
  n?: number;
  inputsA?: GymInput;
  inputsB?: GymInput;
  styleA?: string;
  styleB?: string;
}

export interface GymCommand extends Partial<ResetRequest>, Partial<StepRequest> {
  cmd?: string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(moduleDir, '../..');
const vendorRoot = resolve(sourceRoot, 'vendor/sshfighter');
const IMPLEMENTATION_FILES = [
  'src/gym/ssh-gym-v2.ts',
  'src/tools/ssh-gym-v2.ts',
] as const;

const sha256Bytes = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const sha256File = (path: string): string => sha256Bytes(readFileSync(path));
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
});

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function implementationDigest(): string {
  const files = Object.fromEntries(IMPLEMENTATION_FILES.map((relative) => [
    relative, sha256File(resolve(sourceRoot, relative)),
  ]));
  return sha256Bytes(canonicalJson(files));
}

function vendorHashes(): Record<string, string> {
  return Object.fromEntries(Object.keys(PINNED_VENDOR_FILES).map((relative) => [
    relative, sha256File(resolve(vendorRoot, relative)),
  ]));
}

export interface SshGymProvenance {
  schema: string;
  implementationSha256: string;
  source: { commit: string; dirty: boolean };
  vendor: {
    repository: string;
    commit: string;
    dirty: boolean;
    engineVersion: string;
    files: Record<string, string>;
    combinedSourceSha256: string;
  };
  runtimeProfile: {
    id: string;
    canonicalDeployCommitAttested: false;
    observationProfiles: readonly ObservationProfile[];
    actuationProfiles: readonly ActuationProfile[];
    roster: readonly string[];
    stages: string[];
    styles: string[];
  };
}

export function sshGymProvenance(): SshGymProvenance {
  const implementationSha256 = implementationDigest();
  const files = vendorHashes();
  const vendorCommit = git('-C', vendorRoot, 'rev-parse', 'HEAD');
  const vendorDirty = git('-C', vendorRoot, 'status', '--porcelain', '--untracked-files=no') !== '';
  const sourceCommit = git('-C', sourceRoot, 'rev-parse', 'HEAD');
  const sourceDirty = git('-C', sourceRoot, 'status', '--porcelain', '--untracked-files=no') !== '';
  const combinedSourceSha256 = sha256Bytes(canonicalJson(files));
  const roster = ROSTER.map((fighter) => fighter.name);
  const profileId = [
    ENGINE_VERSION,
    `roster-${roster.length}`,
    `mechanics-${combinedSourceSha256.slice(0, 16)}`,
    `gym-${implementationSha256.slice(0, 16)}`,
  ].join('/');
  return {
    schema: SSH_GYM_V2_SCHEMA,
    implementationSha256,
    source: { commit: sourceCommit, dirty: sourceDirty },
    vendor: {
      repository: 'https://github.com/thomasdavis/sshfighter.com.git',
      commit: vendorCommit,
      dirty: vendorDirty,
      engineVersion: ENGINE_VERSION,
      files,
      combinedSourceSha256,
    },
    runtimeProfile: {
      id: profileId,
      canonicalDeployCommitAttested: false,
      observationProfiles: OBSERVATION_PROFILES,
      actuationProfiles: ACTUATION_PROFILES,
      roster,
      stages: STAGES.ids().sort(),
      styles: Object.keys(gymStyles).sort(),
    },
  };
}

export function assertSshGymProvenance(): SshGymProvenance {
  const provenance = sshGymProvenance();
  const problems: string[] = [];
  if (provenance.implementationSha256 !== SSH_GYM_V2_IMPLEMENTATION_SHA256) {
    problems.push(`implementation ${provenance.implementationSha256} != ${SSH_GYM_V2_IMPLEMENTATION_SHA256}`);
  }
  if (provenance.vendor.commit !== PINNED_VENDOR_COMMIT) {
    problems.push(`vendor commit ${provenance.vendor.commit} != ${PINNED_VENDOR_COMMIT}`);
  }
  if (provenance.vendor.dirty) problems.push('vendor checkout has tracked modifications');
  if (provenance.vendor.engineVersion !== PINNED_ENGINE_VERSION) {
    problems.push(`engine version ${provenance.vendor.engineVersion} != ${PINNED_ENGINE_VERSION}`);
  }
  if (canonicalJson(provenance.runtimeProfile.roster) !== canonicalJson(PINNED_ROSTER)) {
    problems.push('runtime roster does not match the reviewed ordered roster');
  }
  for (const [relative, expected] of Object.entries(PINNED_VENDOR_FILES)) {
    if (provenance.vendor.files[relative] !== expected) {
      problems.push(`${relative} ${provenance.vendor.files[relative]} != ${expected}`);
    }
  }
  if (problems.length) throw new Error(`SSH Gym v2 provenance mismatch: ${problems.join('; ')}`);
  return provenance;
}

export function normalizeGymInput(command: GymInput | undefined): Inputs {
  return gymInputs(command ?? {});
}

const neutralInput = (): Inputs => gymInputs({});
const cloneInput = (input: Inputs): Inputs => ({ ...input });

/** Deterministic synthetic delay that cannot carry stale edges across rounds. */
export class RoundSafeFifo {
  private readonly queue: Inputs[] = [];

  constructor(public readonly delay: number) {
    if (!Number.isInteger(delay) || delay < 0 || delay > 120) {
      throw new Error('input delay must be an integer from 0 to 120');
    }
  }

  reset(): void { this.queue.length = 0; }

  emit(input: Inputs, phase: string): Inputs {
    if (phase !== 'fight') {
      this.reset();
      return neutralInput();
    }
    if (this.delay === 0) return cloneInput(input);
    this.queue.push(cloneInput(input));
    return this.queue.length > this.delay ? this.queue.shift()! : neutralInput();
  }
}

function isObservationProfile(value: unknown): value is ObservationProfile {
  return typeof value === 'string' && (OBSERVATION_PROFILES as readonly string[]).includes(value);
}

function isActuationProfile(value: unknown): value is ActuationProfile {
  return typeof value === 'string' && (ACTUATION_PROFILES as readonly string[]).includes(value);
}

function wireProjectiles(match: Match): object[] {
  return match.projectiles.filter((projectile) => projectile.active).map((projectile) => ({
    owner: projectile.owner,
    x: Math.round(projectile.x),
    y: Math.round(projectile.y),
    vx: projectile.vx,
    style: projectile.style,
  }));
}

function oracleFighter(fighter: Fighter): object {
  const derived = gymFighterView(fighter) as { special: boolean; active: boolean; casting: boolean };
  return { ...fighter, special: derived.special, active: derived.active, casting: derived.casting };
}

function oracleProjectile(projectile: Projectile): object { return { ...projectile }; }

export class SshGymV2 {
  private match: Match | null = null;
  private random: () => number = seededGymRandom(0);
  private observationProfile: ObservationProfile = 'bot-wire-v1';
  private actuationProfile: ActuationProfile = 'direct-engine-input-v1';
  private fifoA = new RoundSafeFifo(0);
  private fifoB = new RoundSafeFifo(0);

  private withRandom<T>(action: () => T): T {
    const previous = Math.random;
    Math.random = this.random;
    try { return action(); } finally { Math.random = previous; }
  }

  private requireMatch(): Match {
    if (!this.match) throw new Error('match is not initialized; call reset first');
    return this.match;
  }

  state(): object {
    const match = this.requireMatch();
    const common = {
      frame: match.frame,
      phase: match.phase,
      round: match.round,
      roundTime: this.observationProfile === 'bot-wire-v1' ? Math.round(match.roundTime) : match.roundTime,
      hitStop: match.hitStop,
      stage: match.stage,
    };
    if (this.observationProfile === 'bot-wire-v1') {
      return {
        ...common,
        a: gymFighterView(match.a),
        b: gymFighterView(match.b),
        projectiles: wireProjectiles(match),
      };
    }
    return {
      ...common,
      a: oracleFighter(match.a),
      b: oracleFighter(match.b),
      projectiles: match.projectiles.map(oracleProjectile),
    };
  }

  version(): object {
    const provenance = assertSshGymProvenance();
    return {
      schema: SSH_GYM_V2_SCHEMA,
      engineVersion: ENGINE_VERSION,
      implementationSha256: provenance.implementationSha256,
      runtimeProfile: provenance.runtimeProfile,
      transportClaim: 'none-offline-exact-engine-only',
    };
  }

  roster(): object[] {
    return ROSTER.map((fighter) => ({
      name: fighter.name,
      specials: specialMovesFor(fighter.name).map((move) => ({
        attack: move.attack,
        button: move.button,
        motionRight: specialMoveMotionCode(move, 1),
        motionLeft: specialMoveMotionCode(move, -1),
      })),
    }));
  }

  reset(request: ResetRequest): object {
    if (!Number.isInteger(request.seed)) throw new Error('reset seed must be an integer');
    const a = String(request.a).toUpperCase();
    const b = String(request.b).toUpperCase();
    const names = new Set(ROSTER.map((fighter) => fighter.name));
    if (!names.has(a)) throw new Error(`unknown fighter: ${request.a}`);
    if (!names.has(b)) throw new Error(`unknown fighter: ${request.b}`);
    if (typeof request.stage !== 'string' || !STAGES.has(request.stage)) {
      throw new Error(`unknown stage: ${String(request.stage)}`);
    }
    const observationProfile = request.observationProfile ?? 'bot-wire-v1';
    if (!isObservationProfile(observationProfile)) {
      throw new Error(`unknown observation profile: ${String(observationProfile)}`);
    }
    const actuationProfile = request.actuationProfile ?? 'direct-engine-input-v1';
    if (!isActuationProfile(actuationProfile)) {
      throw new Error(`unknown actuation profile: ${String(actuationProfile)}`);
    }
    const delayA = request.inputDelayA ?? 0;
    const delayB = request.inputDelayB ?? 0;
    if (actuationProfile === 'direct-engine-input-v1' && (delayA !== 0 || delayB !== 0)) {
      throw new Error('direct-engine-input-v1 requires zero input delays');
    }
    this.random = seededGymRandom(request.seed);
    this.observationProfile = observationProfile;
    this.actuationProfile = actuationProfile;
    this.fifoA = new RoundSafeFifo(delayA);
    this.fifoB = new RoundSafeFifo(delayB);
    this.match = this.withRandom(() => makeMatch(
      makeFighter('a', a, 'a'),
      makeFighter('b', b, 'b'),
    ));
    this.match.stage = request.stage;
    return this.state();
  }

  private styleInput(styleName: string, role: Side): Inputs {
    const match = this.requireMatch();
    const style = gymStyles[styleName];
    if (!style) throw new Error(`unknown gym style: ${styleName}`);
    const self = role === 'a' ? match.a : match.b;
    const opponent = role === 'a' ? match.b : match.a;
    const command = this.withRandom(() => style(
      gymFighterView(self), gymFighterView(opponent), match.phase,
      wireProjectiles(match), role,
    ));
    return gymInputs(command ?? {});
  }

  private requestedInput(request: StepRequest, role: Side): Inputs {
    const fixed = role === 'a' ? request.inputsA : request.inputsB;
    const styleName = role === 'a' ? request.styleA : request.styleB;
    if (fixed !== undefined && styleName !== undefined) {
      throw new Error(`step ${role} must choose fixed inputs or a style, not both`);
    }
    if (fixed !== undefined) return normalizeGymInput(fixed);
    if (styleName !== undefined) return this.styleInput(styleName, role);
    return neutralInput();
  }

  step(request: StepRequest): { state: object; appliedA: Inputs; appliedB: Inputs } {
    const match = this.requireMatch();
    const n = request.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error('step n must be 1..10000');
    let appliedA = neutralInput();
    let appliedB = neutralInput();
    for (let index = 0; index < n; index++) {
      const requestedA = this.requestedInput(request, 'a');
      const requestedB = this.requestedInput(request, 'b');
      if (this.actuationProfile === 'round-safe-fifo-v1') {
        appliedA = this.fifoA.emit(requestedA, match.phase);
        appliedB = this.fifoB.emit(requestedB, match.phase);
      } else {
        appliedA = requestedA;
        appliedB = requestedB;
      }
      this.withRandom(() => stepMatch(match, appliedA, appliedB));
    }
    return { state: this.state(), appliedA, appliedB };
  }

  handle(message: GymCommand): object {
    switch (message?.cmd) {
      case 'ping': return { ok: true, pong: true };
      case 'version': return { ok: true, ...this.version() };
      case 'provenance': return { ok: true, provenance: assertSshGymProvenance() };
      case 'roster': return { ok: true, roster: this.roster() };
      case 'reset': return { ok: true, state: this.reset(message as unknown as ResetRequest) };
      case 'state': return { ok: true, state: this.state() };
      case 'step': return { ok: true, ...this.step(message) };
      default: throw new Error(`unknown command: ${String(message?.cmd)}`);
    }
  }
}
