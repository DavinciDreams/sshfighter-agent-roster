import { createHash } from 'node:crypto';

import type { GymInput } from './ssh-gym-v3.js';

export type ActivityClass =
  | 'out-of-fight'
  | 'forced-inactivity'
  | 'active-combat'
  | 'legitimate-neutral'
  | 'policy-standstill'
  | 'actuation-stall';

export interface BotFighterTelemetry {
  x: number; y: number; hp: number; stun?: number; attack?: string;
  active?: boolean; casting?: boolean; actionable?: boolean; movePhase?: string;
}

export interface BotStateTelemetry {
  frame: number; phase: string; hitStop?: number;
  you: BotFighterTelemetry; opp: BotFighterTelemetry;
  projectiles?: readonly unknown[];
}

export interface AuditFrame {
  state: BotStateTelemetry;
  requested?: GymInput;
  applied?: GymInput;
}

export interface StandstillOptions {
  minStandstillFrames: number;
  contextFrames: number;
  positionEpsilon: number;
  dynamicsStandstillWeight: number;
  valueStandstillWeight: number;
}

export interface ObjectiveWeights {
  policy: number; dynamics: number; value: number;
}

export interface FrameAudit {
  frame: number;
  classification: ActivityClass;
  reason: string;
  weights: ObjectiveWeights;
}

export interface AuditSegment extends FrameAudit {
  endFrame: number;
  frameCount: number;
}

export interface StandstillAudit {
  schema: 'sshfighter-agent-roster/standstill-audit/v1';
  config: StandstillOptions;
  frameAudits: FrameAudit[];
  segments: AuditSegment[];
  summary: {
    totalFrames: number;
    counts: Record<ActivityClass, number>;
    objectiveWeightSums: ObjectiveWeights;
  };
}

export const DEFAULT_STANDSTILL_OPTIONS: StandstillOptions = Object.freeze({
  // Six seconds at the engine's nominal 30 Hz. This is intentionally a
  // conservative starting point; corpus audits should calibrate it by policy.
  minStandstillFrames: 180,
  // Preserve anticipation and recovery context around every detected tract.
  contextFrames: 24,
  positionEpsilon: 0.05,
  dynamicsStandstillWeight: 0.10,
  valueStandstillWeight: 0.0,
});

const zeroWeights = (): ObjectiveWeights => ({ policy: 0, dynamics: 0, value: 0 });
const fullWeights = (): ObjectiveWeights => ({ policy: 1, dynamics: 1, value: 1 });

function inputSignature(input: GymInput | undefined): string {
  const value = input ?? {};
  return JSON.stringify({
    moveX: Number(value.moveX ?? 0), down: value.down === true, jump: value.jump === true,
    punch: value.punch === true, kick: value.kick === true, throw: value.throw === true,
    motion: String(value.motion ?? 'N'),
  });
}

function isNeutral(input: GymInput | undefined): boolean {
  return inputSignature(input) === inputSignature(undefined);
}

function ownsActivity(state: BotStateTelemetry): boolean {
  return Boolean(state.you.active || state.you.casting
    || (state.you.attack && state.you.attack !== 'none'));
}

function selfMoved(previous: BotStateTelemetry | undefined, current: BotStateTelemetry,
                   epsilon: number): boolean {
  if (!previous) return false;
  return Math.abs(current.you.x - previous.you.x) > epsilon
    || Math.abs(current.you.y - previous.you.y) > epsilon;
}

function isForced(state: BotStateTelemetry): boolean {
  return Number(state.hitStop ?? 0) > 0 || Number(state.you.stun ?? 0) > 0
    || state.you.actionable === false
    || Boolean(state.you.movePhase && state.you.movePhase !== 'neutral');
}

interface Candidate {
  index: number; kind: 'policy-standstill' | 'actuation-stall'; reason: string;
}

export function auditStandstill(frames: readonly AuditFrame[], partial: Partial<StandstillOptions> = {}): StandstillAudit {
  const config = { ...DEFAULT_STANDSTILL_OPTIONS, ...partial };
  if (!Number.isInteger(config.minStandstillFrames) || config.minStandstillFrames < 1)
    throw new Error('minStandstillFrames must be a positive integer');
  if (!Number.isInteger(config.contextFrames) || config.contextFrames < 0)
    throw new Error('contextFrames must be a non-negative integer');
  if (config.positionEpsilon < 0) throw new Error('positionEpsilon must be non-negative');

  for (let index = 1; index < frames.length; index++) {
    if (frames[index]!.state.frame <= frames[index - 1]!.state.frame)
      throw new Error('audit frames must be strictly increasing');
  }

  const frameAudits: FrameAudit[] = frames.map(({ state }) => {
    if (state.phase !== 'fight') return {
      frame: state.frame, classification: 'out-of-fight', reason: 'phase-not-fight', weights: zeroWeights(),
    };
    if (isForced(state)) return {
      frame: state.frame, classification: 'forced-inactivity', reason: 'engine-denied-agency',
      weights: { policy: 0, dynamics: 1, value: 1 },
    };
    return {
      frame: state.frame, classification: 'legitimate-neutral', reason: 'below-standstill-threshold',
      weights: fullWeights(),
    };
  });

  const candidates: Array<Candidate | undefined> = [];
  for (let index = 0; index < frames.length; index++) {
    const row = frames[index]!;
    const state = row.state;
    if (state.phase !== 'fight' || isForced(state)) continue;
    if (ownsActivity(state)) {
      frameAudits[index] = {
        frame: state.frame, classification: 'active-combat', reason: 'attack-or-projectile-activity',
        weights: fullWeights(),
      };
      continue;
    }
    const requestedNeutral = isNeutral(row.requested);
    const appliedNeutral = isNeutral(row.applied);
    if (row.requested !== undefined && !requestedNeutral && appliedNeutral) {
      candidates[index] = { index, kind: 'actuation-stall', reason: 'requested-input-not-applied' };
      continue;
    }
    const previous = frames[index - 1];
    const stableApplied = index > 0 && inputSignature(row.applied) === inputSignature(previous?.applied);
    const noSelfMotion = !selfMoved(previous?.state, state, config.positionEpsilon);
    if (appliedNeutral && (row.requested === undefined || requestedNeutral)) {
      candidates[index] = { index, kind: 'policy-standstill', reason: 'sustained-neutral-output' };
    } else if (stableApplied && noSelfMotion) {
      candidates[index] = { index, kind: 'policy-standstill', reason: 'sustained-nonprogressing-output' };
    } else {
      frameAudits[index] = {
        frame: state.frame, classification: 'active-combat', reason: 'purposeful-output-or-motion',
        weights: fullWeights(),
      };
    }
  }

  let start = 0;
  while (start < candidates.length) {
    const candidate = candidates[start];
    if (!candidate) { start++; continue; }
    let end = start;
    while (end + 1 < candidates.length
      && candidates[end + 1]?.kind === candidate.kind
      && candidates[end + 1]?.reason === candidate.reason
      && frames[end + 1]!.state.frame === frames[end]!.state.frame + 1) end++;
    const length = end - start + 1;
    if (length >= config.minStandstillFrames) {
      // Context is kept at full weight and clips are never stitched across the
      // central downweighted span. If a threshold is shorter than both collars,
      // retain at least one auditable center frame.
      const markedStart = Math.min(end, start + config.contextFrames);
      const markedEnd = Math.max(markedStart, end - config.contextFrames);
      for (let index = markedStart; index <= markedEnd; index++) {
        frameAudits[index] = {
          frame: frames[index]!.state.frame,
          classification: candidate.kind,
          reason: candidate.reason,
          weights: {
            policy: 0,
            dynamics: config.dynamicsStandstillWeight,
            value: config.valueStandstillWeight,
          },
        };
      }
    }
    start = end + 1;
  }

  const segments: AuditSegment[] = [];
  for (const item of frameAudits) {
    const previous = segments.at(-1);
    if (previous && previous.classification === item.classification
      && previous.reason === item.reason
      && JSON.stringify(previous.weights) === JSON.stringify(item.weights)
      && item.frame === previous.endFrame + 1) {
      previous.endFrame = item.frame;
      previous.frameCount++;
    } else {
      segments.push({ ...item, endFrame: item.frame, frameCount: 1 });
    }
  }

  const classes: ActivityClass[] = [
    'out-of-fight', 'forced-inactivity', 'active-combat', 'legitimate-neutral',
    'policy-standstill', 'actuation-stall',
  ];
  const counts = Object.fromEntries(classes.map((name) => [name, 0])) as Record<ActivityClass, number>;
  const objectiveWeightSums = zeroWeights();
  for (const item of frameAudits) {
    counts[item.classification]++;
    objectiveWeightSums.policy += item.weights.policy;
    objectiveWeightSums.dynamics += item.weights.dynamics;
    objectiveWeightSums.value += item.weights.value;
  }
  return {
    schema: 'sshfighter-agent-roster/standstill-audit/v1', config, frameAudits, segments,
    summary: { totalFrames: frames.length, counts, objectiveWeightSums },
  };
}

export function auditManifest(audit: StandstillAudit, sourceBytes: string | Buffer,
                              source: Record<string, unknown> = {}): object {
  return {
    schema: audit.schema,
    source: { ...source, sha256: createHash('sha256').update(sourceBytes).digest('hex') },
    config: audit.config,
    summary: audit.summary,
    segments: audit.segments,
  };
}
