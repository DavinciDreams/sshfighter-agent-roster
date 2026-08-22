import { randomBytes } from 'node:crypto';

// Agent-owned wire contract. Keeping it here avoids making policy execution
// depend on a server checkout while preserving the ordinary bot input shape.
export interface Inputs {
  t: 'input';
  moveX: number;
  down: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  throw: boolean;
  motion: string;
}

function emptyInputs(): Inputs {
  return {
    t: 'input', moveX: 0, down: false, jump: false,
    punch: false, kick: false, throw: false, motion: 'N',
  };
}

export type MegawattsStrategy = 'survey' | 'bombard' | 'breach';
export type MegawattsPolicyVariant = 'boundary' | 'resonant';

export interface MegawattsFighterView {
  character?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  wins: number;
  attack: string;
  attackFrame: number;
  stun: number;
  crouching?: boolean;
  active?: boolean;
  casting?: boolean;
  movePhase?: 'neutral' | 'startup' | 'active' | 'recovery';
  hitboxActive?: boolean;
  attackConnected?: boolean;
  blocking?: boolean;
  invulnerable?: boolean;
  invulnerabilityFrames?: number;
  armored?: boolean;
  armorFrames?: number;
  thrownFrames?: number;
  actionable?: boolean;
  pose?: string;
}

export interface MegawattsProjectileView {
  owner?: 'a' | 'b';
  ownedBy?: 'you' | 'opponent';
  x: number;
  y: number;
  vx: number;
  vy?: number;
  dangerous?: boolean;
  canHit?: boolean;
  style?: string;
}

export interface MegawattsPolicyState {
  frame: number;
  phase: string;
  round: number;
  roundTime: number;
  you: MegawattsFighterView;
  opp: MegawattsFighterView;
  projectiles?: readonly MegawattsProjectileView[];
}

export interface MegawattsInnovationConfig {
  variant: MegawattsPolicyVariant;
  seed?: number;
  damageFailureThreshold: number;
  oscillatorOmega: number;
  oscillatorGamma: number;
  oscillatorThreshold: number;
  cueWindowFrames: number;
  actionCooldown: number;
  retuneEveryFrames: number;
  minimumDwellFrames: number;
}

export const DEFAULT_MEGAWATTS_BOUNDARY_CONFIG: MegawattsInnovationConfig = {
  variant: 'boundary',
  seed: 0x4d454741,
  damageFailureThreshold: 24,
  oscillatorOmega: 0.105,
  oscillatorGamma: 0.0025,
  oscillatorThreshold: 0.72,
  cueWindowFrames: 90,
  actionCooldown: 9,
  retuneEveryFrames: 18,
  minimumDwellFrames: 36,
};

export const DEFAULT_MEGAWATTS_RESONANT_CONFIG: MegawattsInnovationConfig = {
  ...DEFAULT_MEGAWATTS_BOUNDARY_CONFIG,
  variant: 'resonant',
  seed: undefined,
  oscillatorGamma: 0.0015,
  oscillatorThreshold: 0.6,
  retuneEveryFrames: 15,
  minimumDwellFrames: 30,
};

type CueKind = 'damage' | 'hit' | 'kick-hit' | 'kick-miss' | 'commitment' | 'compression' | 'projectile';
interface Cue { kind: CueKind; frame: number; strength: number; }
interface RoundEvidence {
  damageTaken: number;
  damageDealt: number;
  confirmedHits: number;
  kickAttempts: number;
  kickHits: number;
  kickMisses: number;
}

export interface MegawattsPolicySnapshot {
  model: 'megawatts-damped-kick-v1';
  variant: MegawattsPolicyVariant;
  seed: number;
  strategy: MegawattsStrategy;
  round: number;
  evidence: RoundEvidence;
  oscillator: { q: number; p: number; amplitude: number; phase: number };
  activeCues: CueKind[];
  innovationCount: number;
  liveRetunes: number;
  lastTransition: string;
}

const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function freshSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deliberately small damped oscillator. Cue events arrive as directional
 * kicks; between kicks the state rotates and contracts. This is a pragmatic 2D
 * analogue of the HAM Kick lineage, not a claim to reproduce its Clifford core.
 */
export class MegawattsKickModel {
  q = 0;
  p = 0;

  constructor(private readonly omega: number, private readonly gamma: number) {}

  reset(): void { this.q = 0; this.p = 0; }

  step(frames: number): void {
    const dt = clamp(frames, 0, 12);
    if (dt <= 0) return;
    const angle = this.omega * dt;
    const decay = Math.exp(-this.gamma * dt);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const q = this.q, p = this.p;
    this.q = decay * (q * cos - p * sin);
    this.p = decay * (q * sin + p * cos);
  }

  kick(angle: number, strength: number): void {
    this.q += Math.cos(angle) * strength;
    this.p += Math.sin(angle) * strength;
    const amplitude = this.amplitude();
    if (amplitude > 3.5) { this.q *= 3.5 / amplitude; this.p *= 3.5 / amplitude; }
  }

  invert(retainedAmplitude = 0.55): void {
    this.q *= -retainedAmplitude;
    this.p *= -retainedAmplitude;
  }

  damp(factor: number): void { this.q *= factor; this.p *= factor; }
  amplitude(): number { return Math.hypot(this.q, this.p); }
  phase(): number { const phase = Math.atan2(this.p, this.q); return phase < 0 ? phase + TAU : phase; }
}

function special(kind: 'citation' | 'knowledgebomb' | 'groundtruth', facing: 1 | -1): Inputs {
  const input = emptyInputs();
  if (kind === 'citation') {
    input.motion = facing === 1 ? 'DR' : 'DL';
    input.punch = true;
  } else if (kind === 'knowledgebomb') {
    input.motion = 'DU';
    input.punch = true;
  } else {
    input.motion = 'DU';
    input.kick = true;
  }
  return input;
}

function confirmedHit(previousHp: number, currentHp: number, opponent: MegawattsFighterView): boolean {
  const damage = previousHp - currentHp;
  // Actual engine hits carry 12+ stun (throws carry 24); blocked attacks carry 7.
  // The damage fallback also catches an armored hit, which intentionally does not flinch.
  return damage > 0 && (opponent.stun >= 10 || damage >= 4 || opponent.pose === 'thrown');
}

export class MegawattsInnovationPolicy {
  readonly config: MegawattsInnovationConfig;
  readonly seed: number;
  private random: () => number;
  private oscillator: MegawattsKickModel;
  private strategy: MegawattsStrategy = 'survey';
  private evidence: RoundEvidence = {
    damageTaken: 0, damageDealt: 0, confirmedHits: 0,
    kickAttempts: 0, kickHits: 0, kickMisses: 0,
  };
  private cues: Cue[] = [];
  private round = 1;
  private finalizedRound = 0;
  private lastFrame = -1;
  private lastActionFrame = -999;
  private lastRetuneFrame = -999;
  private strategySinceFrame = 0;
  private previousSelfHp = 100;
  private previousOppHp = 100;
  private previousDistance = 0;
  private previousOpponentAttack = 'none';
  private previousProjectileCount = 0;
  private pendingKick: { frame: number; resolved: boolean } | null = null;
  private innovationCount = 0;
  private liveRetunes = 0;
  private lastTransition = 'initial survey';

  constructor(config: Partial<MegawattsInnovationConfig> = {}) {
    const base = config.variant === 'resonant' ? DEFAULT_MEGAWATTS_RESONANT_CONFIG : DEFAULT_MEGAWATTS_BOUNDARY_CONFIG;
    this.config = { ...base, ...config };
    if (!(this.config.oscillatorOmega > 0)) throw new Error('oscillatorOmega must be positive');
    if (!(this.config.oscillatorGamma > 0)) throw new Error('oscillatorGamma must remain positive');
    this.seed = (config.seed ?? base.seed ?? freshSeed()) >>> 0;
    this.random = mulberry32(this.seed);
    this.oscillator = new MegawattsKickModel(this.config.oscillatorOmega, this.config.oscillatorGamma);
  }

  reset(): void {
    this.random = mulberry32(this.seed);
    this.oscillator.reset();
    this.strategy = 'survey';
    this.evidence = {
      damageTaken: 0, damageDealt: 0, confirmedHits: 0,
      kickAttempts: 0, kickHits: 0, kickMisses: 0,
    };
    this.cues = [];
    this.round = 1;
    this.finalizedRound = 0;
    this.lastFrame = -1;
    this.lastActionFrame = -999;
    this.lastRetuneFrame = -999;
    this.strategySinceFrame = 0;
    this.previousSelfHp = 100;
    this.previousOppHp = 100;
    this.previousDistance = 0;
    this.previousOpponentAttack = 'none';
    this.previousProjectileCount = 0;
    this.pendingKick = null;
    this.innovationCount = 0;
    this.liveRetunes = 0;
    this.lastTransition = 'initial survey';
  }

  snapshot(): MegawattsPolicySnapshot {
    const recent = new Set(this.cues.map((cue) => cue.kind));
    return {
      model: 'megawatts-damped-kick-v1',
      variant: this.config.variant,
      seed: this.seed,
      strategy: this.strategy,
      round: this.round,
      evidence: { ...this.evidence },
      oscillator: {
        q: this.oscillator.q,
        p: this.oscillator.p,
        amplitude: this.oscillator.amplitude(),
        phase: this.oscillator.phase(),
      },
      activeCues: [...recent],
      innovationCount: this.innovationCount,
      liveRetunes: this.liveRetunes,
      lastTransition: this.lastTransition,
    };
  }

  private addCue(kind: CueKind, frame: number, strength: number, angle: number): void {
    this.cues.push({ kind, frame, strength });
    if (this.cues.length > 24) this.cues.shift();
    this.oscillator.kick(angle, strength);
  }

  private beginRound(state: MegawattsPolicyState): void {
    this.round = state.round;
    this.finalizedRound = 0;
    this.evidence = {
      damageTaken: 0, damageDealt: 0, confirmedHits: 0,
      kickAttempts: 0, kickHits: 0, kickMisses: 0,
    };
    this.previousSelfHp = state.you.hp;
    this.previousOppHp = state.opp.hp;
    this.previousDistance = Math.abs(state.opp.x - state.you.x);
    this.previousOpponentAttack = state.opp.attack;
    this.previousProjectileCount = state.projectiles?.length ?? 0;
    this.pendingKick = null;
  }

  private observe(state: MegawattsPolicyState): void {
    const elapsed = this.lastFrame < 0 ? 1 : Math.max(1, state.frame - this.lastFrame);
    this.oscillator.step(elapsed);
    this.cues = this.cues.filter((cue) => state.frame - cue.frame <= this.config.cueWindowFrames);

    const selfDamage = Math.max(0, this.previousSelfHp - state.you.hp);
    const dealt = Math.max(0, this.previousOppHp - state.opp.hp);
    if (selfDamage > 0) {
      this.evidence.damageTaken += selfDamage;
      this.addCue('damage', state.frame, selfDamage / 18, 0);
    }
    if (dealt > 0) {
      this.evidence.damageDealt += dealt;
      if (confirmedHit(this.previousOppHp, state.opp.hp, state.opp)) {
        this.evidence.confirmedHits++;
        this.oscillator.damp(0.42);
        this.addCue('hit', state.frame, Math.min(0.7, dealt / 16), Math.PI);
        if (this.pendingKick && !this.pendingKick.resolved && state.frame - this.pendingKick.frame <= 32) {
          this.pendingKick.resolved = true;
          this.evidence.kickHits++;
          // A literal kick conversion is a salient success primitive: reinforce
          // the opposite side of the unanswered-damage mode.
          this.addCue('kick-hit', state.frame, 0.42, Math.PI);
        }
      }
    }

    if (this.pendingKick && !this.pendingKick.resolved && state.frame - this.pendingKick.frame > 32) {
      this.pendingKick.resolved = true;
      this.evidence.kickMisses++;
      this.addCue('kick-miss', state.frame, 0.2, Math.PI / 3);
    }

    const distance = Math.abs(state.opp.x - state.you.x);
    if (this.previousDistance > 0 && this.previousDistance - distance > 2 && distance < 66) {
      this.addCue('compression', state.frame, 0.08, Math.PI / 4);
    }
    if (state.opp.attack !== 'none' && state.opp.attack !== this.previousOpponentAttack) {
      this.addCue('commitment', state.frame, 0.16, Math.PI / 2);
    }
    const projectileCount = state.projectiles?.length ?? 0;
    if (projectileCount > this.previousProjectileCount) {
      this.addCue('projectile', state.frame, 0.12, -Math.PI / 2);
    }

    this.previousSelfHp = state.you.hp;
    this.previousOppHp = state.opp.hp;
    this.previousDistance = distance;
    this.previousOpponentAttack = state.opp.attack;
    this.previousProjectileCount = projectileCount;
  }

  private boundaryInnovation(frame: number): void {
    if (this.finalizedRound === this.round) return;
    this.finalizedRound = this.round;
    const failureVote = this.evidence.damageTaken >= this.config.damageFailureThreshold
      && this.evidence.confirmedHits === 0;
    const oscillatorVote = this.oscillator.amplitude() >= this.config.oscillatorThreshold;
    if (!failureVote || !oscillatorVote) return;

    if (this.config.variant === 'boundary') {
      this.strategy = this.strategy === 'survey' ? 'breach' : 'survey';
    } else {
      const choices: MegawattsStrategy[] = ['survey', 'bombard', 'breach'].filter((x) => x !== this.strategy) as MegawattsStrategy[];
      this.strategy = choices[Math.floor(this.random() * choices.length)] ?? 'bombard';
    }
    this.oscillator.invert();
    this.strategySinceFrame = frame;
    this.innovationCount++;
    this.lastTransition = `round ${this.round} unanswered-damage innovation`;
  }

  private cueAgreement(state: MegawattsPolicyState): { count: number; kinds: CueKind[] } {
    const kinds = new Set(this.cues.map((cue) => cue.kind));
    const distance = Math.abs(state.opp.x - state.you.x);
    if (this.evidence.damageTaken >= this.config.damageFailureThreshold / 2 && this.evidence.confirmedHits === 0) kinds.add('damage');
    if (distance < 56 && Math.sign(state.you.x - state.opp.x) === Math.sign(state.opp.vx)) kinds.add('compression');
    if (state.opp.attack !== 'none') kinds.add('commitment');
    return { count: kinds.size, kinds: [...kinds] };
  }

  private retuneOnTheFly(state: MegawattsPolicyState): void {
    if (this.config.variant !== 'resonant') return;
    if (state.frame - this.lastRetuneFrame < this.config.retuneEveryFrames) return;
    if (state.frame - this.strategySinceFrame < this.config.minimumDwellFrames) return;
    const agreement = this.cueAgreement(state);
    if (agreement.count < 2) return;
    this.lastRetuneFrame = state.frame;

    const distance = Math.abs(state.opp.x - state.you.x);
    const phase = this.oscillator.phase();
    const amplitude = this.oscillator.amplitude();
    const pressure = clamp(this.evidence.damageTaken / this.config.damageFailureThreshold, 0, 2);
    const commitment = state.opp.attack !== 'none' ? 1 : 0;
    const reflect = state.opp.attack === 'reflect' ? 1 : 0;
    const kickConversion = this.evidence.kickAttempts > 0
      ? this.evidence.kickHits / this.evidence.kickAttempts
      : 0;
    const utilities: Record<MegawattsStrategy, number> = {
      survey: (distance > 82 ? 1.1 : 0.1) + (state.you.hp > state.opp.hp ? 0.5 : 0)
        + this.evidence.kickMisses * 0.12 + Math.cos(phase) * 0.3,
      bombard: (distance > 46 && distance < 132 ? 0.8 : 0.1) + reflect * 1.4
        + commitment * 0.35 + this.evidence.kickMisses * 0.16 + Math.sin(phase) * 0.35,
      breach: (distance < 76 ? 0.75 : 0.15) + pressure * 0.55 + commitment * 0.45
        + kickConversion * 0.75 - Math.cos(phase) * 0.25,
    };
    const switchProbability = clamp(0.05 + (agreement.count - 2) * 0.09 + amplitude * 0.055, 0.05, 0.52);
    if (this.random() >= switchProbability) return;

    // Gumbel perturbations provide exploration without hiding provenance: the
    // generated seed is public in snapshot() and reproduces the whole run.
    const candidates = (Object.keys(utilities) as MegawattsStrategy[]).filter((candidate) => candidate !== this.strategy);
    const chosen = candidates.map((candidate) => {
      const u = clamp(this.random(), 1e-9, 1 - 1e-9);
      return { candidate, score: utilities[candidate] - Math.log(-Math.log(u)) * 0.32 };
    }).sort((a, b) => b.score - a.score)[0]?.candidate;
    if (!chosen) return;
    this.strategy = chosen;
    this.strategySinceFrame = state.frame;
    this.liveRetunes++;
    this.lastTransition = `frame ${state.frame} resonant retune (${agreement.kinds.join('+')})`;
  }

  private commit(input: Inputs, frame: number): Inputs {
    if (input.punch || input.kick || input.throw || input.jump) this.lastActionFrame = frame;
    if (input.kick && input.motion === 'N') {
      this.pendingKick = { frame, resolved: false };
      this.evidence.kickAttempts++;
    }
    return input;
  }

  private act(state: MegawattsPolicyState): Inputs {
    const input = emptyInputs();
    const { you, opp } = state;
    if (state.phase !== 'fight' || you.stun > 0 || you.attack !== 'none') return input;
    const dx = opp.x - you.x;
    const distance = Math.abs(dx);
    const toward = Math.sign(dx) || you.facing;
    const away = -toward;
    const grounded = you.y <= 0.5 && you.vy <= 0;
    const ready = state.frame - this.lastActionFrame >= this.config.actionCooldown;
    const incoming = (state.projectiles ?? []).some((projectile) =>
      (projectile.ownedBy === undefined || projectile.ownedBy === 'opponent')
      && projectile.dangerous !== false && projectile.canHit !== false
      && Math.abs(projectile.x - you.x) < 76
      && Math.sign(you.x - projectile.x) === Math.sign(projectile.vx));

    if (incoming && grounded && distance < 70) {
      input.moveX = away;
      input.down = true;
      return input;
    }
    if ((opp.hitboxActive ?? opp.active) && distance < 48 && grounded) {
      input.moveX = away;
      input.down = distance < 36;
      return input;
    }

    // Scripted commitments are the reliable signal: answer XENON's tangible
    // recovery/exit, not its identity. Guard Blink's live frames first; Ground
    // Truth then becomes a punish instead of a startup race MEGA cannot win.
    const phaseExit = opp.attack === 'phase' && opp.attackFrame >= 13 && distance < 76;
    const blinkRecovery = opp.attack === 'blink' && opp.attackFrame >= 8 && distance < 92;
    const descending = opp.y > 9 && opp.vy <= 0.5 && distance < 54;
    if (grounded && ready && (phaseExit || blinkRecovery || descending)) {
      return this.commit(special('groundtruth', you.facing), state.frame);
    }

    // REFLECT defeats the honest bolt, so MEGA changes lane. The two diagonal
    // cores are individually reflectable, but their 17-frame spacing outlasts
    // one 15-frame Reflect activation.
    if (grounded && ready && opp.attack === 'reflect' && distance >= 42 && distance <= 142) {
      return this.commit(special('knowledgebomb', you.facing), state.frame);
    }

    const normalRecovery = (opp.attack === 'punch' && opp.attackFrame >= 6)
      || (opp.attack === 'kick' && opp.attackFrame >= 10);
    if (grounded && ready && normalRecovery && distance <= 42) {
      if (distance <= 28) input.throw = true;
      else input.kick = true;
      return this.commit(input, state.frame);
    }
    const opponentClosing = Math.abs(opp.vx) > 0.2
      && Math.sign(you.x - opp.x) === Math.sign(opp.vx);
    if (grounded && ready && opp.attack === 'none' && opponentClosing && distance <= 40) {
      input.kick = true;
      return this.commit(input, state.frame);
    }

    const phase = this.oscillator.phase();
    if (this.strategy === 'survey') {
      if (distance <= 27 && ready) { input.throw = true; return this.commit(input, state.frame); }
      if (distance < 58) { input.moveX = away; return input; }
      if (distance > 126) { input.moveX = toward; return input; }
      if (ready && distance >= 64 && distance <= 118) {
        if (Math.sin(phase) < -0.15) return this.commit(special('knowledgebomb', you.facing), state.frame);
        return this.commit(special('citation', you.facing), state.frame);
      }
      input.moveX = distance > 94 ? toward : away;
      return input;
    }

    if (this.strategy === 'bombard') {
      if (distance <= 28 && ready) { input.throw = true; return this.commit(input, state.frame); }
      if (ready && distance >= 46 && distance <= 124) return this.commit(special('knowledgebomb', you.facing), state.frame);
      if (distance < 56) input.moveX = away;
      else if (distance > 86) input.moveX = toward;
      return input;
    }

    // Breach mode is deliberately orthogonal to survey: close, contest the
    // predicted exit with Ground Truth, and cash out with normals/throws.
    if (distance <= 27 && ready) { input.throw = true; return this.commit(input, state.frame); }
    if (distance <= 43 && ready) { input.kick = true; return this.commit(input, state.frame); }
    if (distance <= 70 && grounded && ready
        && ((opp.movePhase === 'startup' && opp.attack !== 'none') || opp.casting || Math.sin(phase) > 0.35)) {
      return this.commit(special('groundtruth', you.facing), state.frame);
    }
    if (distance >= 48 && distance <= 86 && grounded && ready && Math.cos(phase) < -0.15) {
      return this.commit(special('knowledgebomb', you.facing), state.frame);
    }
    input.moveX = toward;
    return input;
  }

  decide(state: MegawattsPolicyState): Inputs {
    if (state.frame < this.lastFrame) this.reset();
    if (state.round !== this.round) {
      // Some transports can skip the decorative round-over snapshots. Commit
      // the prior round's update before replacing its evidence in that case.
      this.boundaryInnovation(state.frame);
      this.beginRound(state);
    }
    if (this.lastFrame < 0) this.beginRound(state);

    if (state.phase === 'fight') this.observe(state);
    else if (this.lastFrame >= 0) this.boundaryInnovation(state.frame);

    this.retuneOnTheFly(state);
    this.lastFrame = state.frame;
    return this.act(state);
  }
}

export interface WirePolicy {
  decide(state: MegawattsPolicyState): Inputs;
  reset(): void;
  status(): MegawattsPolicySnapshot;
}

export function createWirePolicy(config: Partial<MegawattsInnovationConfig> = {}): WirePolicy {
  const policy = new MegawattsInnovationPolicy(config);
  return {
    decide: (state) => policy.decide(state),
    reset: () => policy.reset(),
    status: () => policy.snapshot(),
  };
}

// Portable gym interface expected by src/tools/omega-gym.ts.
const gymPolicy = new MegawattsInnovationPolicy(DEFAULT_MEGAWATTS_BOUNDARY_CONFIG);
let gymFrame = 0;
export function reset(): void { gymFrame = 0; gymPolicy.reset(); }
export function decide(
  self: MegawattsFighterView,
  opp: MegawattsFighterView,
  phase: string,
  projectiles: readonly MegawattsProjectileView[] = [],
): Inputs {
  gymFrame++;
  return gymPolicy.decide({
    frame: gymFrame,
    phase,
    round: self.wins + opp.wins + 1,
    roundTime: 0,
    you: self,
    opp,
    projectiles,
  });
}
