// Wire-visible adaptive controller for MEGA's existing BYU/GYLE/MNEME
// profiles. It deliberately leaves the frozen static router untouched and
// exposes adaptation only through an explicit runner mode.
import {
  DEFAULT_POLICY_SEED, createSeededRandom, createStaticGymPolicy, staticProfile,
} from './static-router-gym.mjs';

export const MEGA_POLICY_MODES = Object.freeze([
  'static', 'innovation-boundary', 'innovation-resonant',
]);

export const DEFAULT_MEGA_INNOVATION_CONFIG = Object.freeze({
  damageFailureThreshold: 24,
  oscillatorOmega: 0.105,
  oscillatorGamma: 0.0025,
  oscillatorThreshold: 0.72,
  cueWindowFrames: 90,
  kickWindowFrames: 32,
  retuneEveryFrames: 18,
  minimumDwellFrames: 36,
});

const TAU = Math.PI * 2;
const STRATEGIES = Object.freeze(['baseline', 'guard', 'pressure']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class MegaKickModel {
  constructor(omega, gamma) {
    if (!Number.isFinite(omega) || omega <= 0) throw new Error('oscillator omega must be positive');
    if (!Number.isFinite(gamma) || gamma <= 0) throw new Error('oscillator gamma must be positive');
    this.omega = omega;
    this.gamma = gamma;
    this.q = 0;
    this.p = 0;
  }

  reset() { this.q = 0; this.p = 0; }

  step(frames) {
    const dt = clamp(Number(frames) || 0, 0, 12);
    if (dt <= 0) return;
    const angle = this.omega * dt;
    const decay = Math.exp(-this.gamma * dt);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const q = this.q, p = this.p;
    this.q = decay * (q * cos - p * sin);
    this.p = decay * (q * sin + p * cos);
  }

  kick(angle, strength) {
    this.q += Math.cos(angle) * strength;
    this.p += Math.sin(angle) * strength;
    const amplitude = this.amplitude();
    if (amplitude > 3.5) {
      this.q *= 3.5 / amplitude;
      this.p *= 3.5 / amplitude;
    }
  }

  invert(retainedAmplitude = 0.55) {
    this.q *= -retainedAmplitude;
    this.p *= -retainedAmplitude;
  }

  damp(factor) { this.q *= factor; this.p *= factor; }
  amplitude() { return Math.hypot(this.q, this.p); }
  phase() {
    const value = Math.atan2(this.p, this.q);
    return value < 0 ? value + TAU : value;
  }
}

function neutral() { return { t: 'input', moveX: 0, motion: 'N' }; }

function freshEvidence() {
  return {
    damageTaken: 0, damageDealt: 0, confirmedHits: 0,
    kickAttempts: 0, kickHits: 0, kickMisses: 0,
    transportGaps: 0, skippedDecisionFrames: 0,
  };
}

function confirmedHit(previousHp, currentHp, opponent) {
  const damage = previousHp - currentHp;
  return damage > 0 && (Number(opponent?.stun ?? 0) >= 10 || damage >= 4 || opponent?.pose === 'thrown');
}

function projectileApproaching(state, self) {
  return (state.projectiles ?? []).some((projectile) => {
    const dx = self.x - Number(projectile.x ?? self.x);
    return Math.abs(dx) < 82 && Math.sign(dx) === Math.sign(Number(projectile.vx ?? 0));
  });
}

export function createMegaInnovationPolicy(
  profileId,
  mode = 'innovation-boundary',
  seed = DEFAULT_POLICY_SEED,
  overrides = {},
) {
  if (!MEGA_POLICY_MODES.includes(mode) || mode === 'static') {
    throw new Error(`adaptive MEGA policy mode required; got ${String(mode)}`);
  }
  const profile = staticProfile(profileId);
  const variant = mode === 'innovation-resonant' ? 'resonant' : 'boundary';
  const config = { ...DEFAULT_MEGA_INNOVATION_CONFIG, ...overrides };
  if (!(config.oscillatorGamma > 0)) throw new Error('oscillatorGamma must remain positive');
  const baseline = createStaticGymPolicy(profileId, (seed ^ 0x53544154) >>> 0);
  const random = createSeededRandom((seed ^ 0x4d454741) >>> 0);
  const oscillator = new MegaKickModel(config.oscillatorOmega, config.oscillatorGamma);

  let strategy = 'baseline';
  let evidence = freshEvidence();
  let cues = [];
  let round = 1;
  let finalizedRound = 0;
  let lastFrame = -1;
  let strategySinceFrame = 0;
  let lastRetuneFrame = -999;
  let previousSelfHp = 100;
  let previousOppHp = 100;
  let previousDistance = 0;
  let previousOpponentAttack = 'none';
  let previousProjectileCount = 0;
  let pendingKick = null;
  let innovationCount = 0;
  let liveRetunes = 0;
  let lastTransition = 'initial frozen baseline';

  function addCue(kind, frame, strength, angle) {
    cues.push({ kind, frame, strength });
    if (cues.length > 32) cues.shift();
    oscillator.kick(angle, strength);
  }

  function snapshot() {
    return {
      model: 'mega-wire-damped-kick-v1',
      variant,
      seed: seed >>> 0,
      profile: profile.id,
      strategy,
      round,
      evidence: { ...evidence },
      oscillator: {
        q: oscillator.q, p: oscillator.p,
        amplitude: oscillator.amplitude(), phase: oscillator.phase(),
      },
      activeCues: [...new Set(cues.map((cue) => cue.kind))],
      innovationCount,
      liveRetunes,
      lastTransition,
      config: { ...config },
    };
  }

  function beginRound(state) {
    round = Number.isInteger(state.round) ? state.round : round;
    finalizedRound = 0;
    evidence = freshEvidence();
    cues = [];
    previousSelfHp = Number(state.you?.hp ?? 100);
    previousOppHp = Number(state.opp?.hp ?? 100);
    previousDistance = Math.abs(Number(state.opp?.x ?? 0) - Number(state.you?.x ?? 0));
    previousOpponentAttack = state.opp?.attack ?? 'none';
    previousProjectileCount = state.projectiles?.length ?? 0;
    pendingKick = null;
  }

  function observe(state) {
    const elapsed = lastFrame < 0 ? 1 : Math.max(1, state.frame - lastFrame);
    oscillator.step(elapsed);
    cues = cues.filter((cue) => state.frame - cue.frame <= config.cueWindowFrames);

    // Offline frame-step controllers see elapsed=1. Under the live ACK gate,
    // elapsed>1 records policy-visible action-opportunity loss without
    // pretending to know server-internal latency.
    if (elapsed > 1) {
      evidence.transportGaps++;
      evidence.skippedDecisionFrames += elapsed - 1;
      addCue('transport-gap', state.frame, Math.min(0.55, (elapsed - 1) / 10), -Math.PI / 3);
    }

    const selfHp = Number(state.you?.hp ?? previousSelfHp);
    const oppHp = Number(state.opp?.hp ?? previousOppHp);
    const selfDamage = Math.max(0, previousSelfHp - selfHp);
    const dealt = Math.max(0, previousOppHp - oppHp);
    if (selfDamage > 0) {
      evidence.damageTaken += selfDamage;
      addCue('damage', state.frame, selfDamage / 18, 0);
    }
    if (dealt > 0) {
      evidence.damageDealt += dealt;
      if (confirmedHit(previousOppHp, oppHp, state.opp)) {
        evidence.confirmedHits++;
        oscillator.damp(0.42);
        addCue('hit', state.frame, Math.min(0.7, dealt / 16), Math.PI);
        if (pendingKick && !pendingKick.resolved
            && state.frame - pendingKick.frame <= config.kickWindowFrames) {
          pendingKick.resolved = true;
          evidence.kickHits++;
          addCue('kick-hit', state.frame, 0.42, Math.PI);
        }
      }
    }
    if (pendingKick && !pendingKick.resolved
        && state.frame - pendingKick.frame > config.kickWindowFrames) {
      pendingKick.resolved = true;
      evidence.kickMisses++;
      addCue('kick-miss', state.frame, 0.2, Math.PI / 3);
    }

    const distance = Math.abs(Number(state.opp?.x ?? 0) - Number(state.you?.x ?? 0));
    if (previousDistance > 0 && previousDistance - distance > 2 && distance < 66) {
      addCue('compression', state.frame, 0.08, Math.PI / 4);
    }
    if (state.opp?.attack !== 'none' && state.opp?.attack !== previousOpponentAttack) {
      addCue('commitment', state.frame, 0.16, Math.PI / 2);
    }
    const projectileCount = state.projectiles?.length ?? 0;
    if (projectileCount > previousProjectileCount) {
      addCue('projectile', state.frame, 0.12, -Math.PI / 2);
    }

    previousSelfHp = selfHp;
    previousOppHp = oppHp;
    previousDistance = distance;
    previousOpponentAttack = state.opp?.attack ?? 'none';
    previousProjectileCount = projectileCount;
  }

  function finalizeRound(frame) {
    if (finalizedRound === round) return;
    finalizedRound = round;
    const failureVote = evidence.damageTaken >= config.damageFailureThreshold
      && evidence.confirmedHits === 0;
    const oscillatorVote = oscillator.amplitude() >= config.oscillatorThreshold;
    if (!failureVote || !oscillatorVote) return;
    const from = strategy;
    strategy = strategy === 'baseline' ? 'pressure'
      : strategy === 'pressure' ? 'guard' : 'baseline';
    oscillator.invert();
    strategySinceFrame = frame;
    innovationCount++;
    lastTransition = `round ${round} unanswered-damage flip ${from}->${strategy}`;
  }

  function cueAgreement(state) {
    const kinds = new Set(cues.map((cue) => cue.kind));
    const distance = Math.abs(state.opp.x - state.you.x);
    if (evidence.damageTaken >= config.damageFailureThreshold / 2 && evidence.confirmedHits === 0) {
      kinds.add('damage');
    }
    if (distance < 56 && Math.sign(state.you.x - state.opp.x) === Math.sign(state.opp.vx ?? 0)) {
      kinds.add('compression');
    }
    if (state.opp.attack !== 'none') kinds.add('commitment');
    return [...kinds];
  }

  function retune(state) {
    if (variant !== 'resonant') return;
    if (state.frame - lastRetuneFrame < config.retuneEveryFrames) return;
    if (state.frame - strategySinceFrame < config.minimumDwellFrames) return;
    const agreement = cueAgreement(state);
    if (agreement.length < 2) return;
    lastRetuneFrame = state.frame;

    const distance = Math.abs(state.opp.x - state.you.x);
    const amplitude = oscillator.amplitude();
    const phase = oscillator.phase();
    const pressure = clamp(evidence.damageTaken / config.damageFailureThreshold, 0, 2);
    const commitment = state.opp.attack !== 'none' ? 1 : 0;
    const projectile = agreement.includes('projectile') ? 1 : 0;
    const transport = agreement.includes('transport-gap') ? 1 : 0;
    const kickConversion = evidence.kickAttempts > 0 ? evidence.kickHits / evidence.kickAttempts : 0;
    const utility = {
      baseline: (distance > 72 ? 0.7 : 0.1) + (state.you.hp > state.opp.hp ? 0.35 : 0)
        + Math.cos(phase) * 0.25 - transport * 0.3,
      guard: pressure * 0.5 + projectile * 0.8 + transport * 0.75
        + (distance < 58 ? 0.4 : 0.1) + Math.sin(phase) * 0.2,
      pressure: (distance < 78 ? 0.65 : 0.1) + commitment * 0.5
        + kickConversion * 0.65 + pressure * 0.35 - transport * 0.15,
    };
    const switchProbability = clamp(0.05 + (agreement.length - 2) * 0.09 + amplitude * 0.055, 0.05, 0.52);
    if (random.next() >= switchProbability) return;
    const candidates = STRATEGIES.filter((candidate) => candidate !== strategy);
    const chosen = candidates.map((candidate) => {
      const u = clamp(random.next(), 1e-9, 1 - 1e-9);
      return { candidate, score: utility[candidate] - Math.log(-Math.log(u)) * 0.32 };
    }).sort((a, b) => b.score - a.score)[0]?.candidate;
    if (!chosen) return;
    const from = strategy;
    strategy = chosen;
    strategySinceFrame = state.frame;
    liveRetunes++;
    lastTransition = `frame ${state.frame} retune ${from}->${strategy} (${agreement.join('+')})`;
  }

  function guardedHead(state) {
    const action = neutral();
    const self = state.you, opponent = state.opp;
    const dx = opponent.x - self.x;
    const distance = Math.abs(dx);
    const toward = Math.sign(dx) || self.facing;
    const away = -toward;
    if (self.stun > 0) {
      action.moveX = away; action.down = true;
      return { action, reason: 'guard_stun' };
    }
    if (self.attack !== 'none') return { action, reason: 'guard_committed_neutral' };
    if (projectileApproaching(state, self) || (opponent.attack !== 'none' && distance < 62)) {
      action.moveX = away; action.down = true;
      return { action, reason: 'guard_threat' };
    }
    if (opponent.y > 6 && distance < 46) {
      action.kick = true;
      return { action, reason: 'guard_anti_air_kick' };
    }
    if (distance <= 34) {
      action.kick = true;
      return { action, reason: 'guard_check_kick' };
    }
    action.moveX = distance > 82 ? toward : away;
    return { action, reason: distance > 82 ? 'guard_reacquire' : 'guard_reset_space' };
  }

  function pressureHead(state) {
    const action = neutral();
    const self = state.you, opponent = state.opp;
    const dx = opponent.x - self.x;
    const distance = Math.abs(dx);
    const toward = Math.sign(dx) || self.facing;
    const away = -toward;
    if (self.stun > 0) {
      action.moveX = away; action.down = true;
      return { action, reason: 'pressure_stun' };
    }
    if (self.attack !== 'none') return { action, reason: 'pressure_committed_neutral' };
    if (projectileApproaching(state, self)) {
      action.moveX = away; action.down = true;
      return { action, reason: 'pressure_projectile_guard' };
    }
    if (opponent.active && distance < 48) {
      action.moveX = away; action.down = true;
      return { action, reason: 'pressure_active_guard' };
    }
    if (distance <= 25) {
      if (random.next() < 0.35) action.throw = true;
      else action.kick = true;
      return { action, reason: action.throw ? 'pressure_throw' : 'pressure_close_kick' };
    }
    if (distance <= 43) {
      action.kick = true;
      return { action, reason: 'pressure_kick' };
    }
    action.moveX = toward;
    if (distance > 92 && self.y <= 1 && random.next() < 0.18) action.jump = true;
    return { action, reason: action.jump ? 'pressure_jump_advance' : 'pressure_advance' };
  }

  function commitResult(result, state) {
    const action = result.action;
    if (action.kick && action.motion === 'N' && (!pendingKick || pendingKick.resolved)) {
      pendingKick = { frame: state.frame, resolved: false };
      evidence.kickAttempts++;
    }
    return { ...result, reason: `${strategy}:${result.reason}`, status: snapshot() };
  }

  function decide(state) {
    if (lastFrame >= 0 && state.frame < lastFrame) reset();
    if (lastFrame < 0) beginRound(state);
    if (Number.isInteger(state.round) && state.round !== round) {
      finalizeRound(state.frame);
      beginRound(state);
    }
    if (state.phase === 'fight') observe(state);
    else if (lastFrame >= 0) finalizeRound(state.frame);
    if (state.phase === 'fight') retune(state);
    lastFrame = state.frame;

    if (state.phase !== 'fight' || !state.you || !state.opp) {
      return commitResult({ action: neutral(), reason: 'inactive' }, state);
    }
    if (strategy === 'baseline') {
      if (state.you.attack !== 'none') {
        return commitResult({ action: neutral(), reason: 'baseline_committed_neutral' }, state);
      }
      return commitResult(baseline.decide(state), state);
    }
    return commitResult(strategy === 'guard' ? guardedHead(state) : pressureHead(state), state);
  }

  function reset() {
    baseline.reset();
    random.reset();
    oscillator.reset();
    strategy = 'baseline';
    evidence = freshEvidence();
    cues = [];
    round = 1;
    finalizedRound = 0;
    lastFrame = -1;
    strategySinceFrame = 0;
    lastRetuneFrame = -999;
    previousSelfHp = 100;
    previousOppHp = 100;
    previousDistance = 0;
    previousOpponentAttack = 'none';
    previousProjectileCount = 0;
    pendingKick = null;
    innovationCount = 0;
    liveRetunes = 0;
    lastTransition = 'initial frozen baseline';
  }

  return {
    profile, mode, seed: seed >>> 0, config,
    decide, reset, status: snapshot,
    rngState: () => ({ gate: random.state(), baseline: baseline.rngState() }),
  };
}
