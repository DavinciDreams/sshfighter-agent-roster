// Import-safe deterministic deployment slice of the frozen character-static
// router. The learned weight artifact selected jumper for every character
// except MNEME, where it selected zoner. Only the predeclared live profiles
// below are exposed to the durable Quick Match worker.
import { createHash } from 'node:crypto';

export const STATIC_ROUTER_WEIGHT_SHA256 = 'ee1f5ffcb83b878bb02ce0c5b659f91a6b5b988ad971912972f9b0605b74ac4f';
export const STATIC_ROUTER_HF_REVISION = '4d5bd8beb2a1370583b0333f9ccb813821d51e59';
export const STATIC_ROUTER_SOURCE_COMMIT = '52baa30193fc197ae4e7ac1e1d080cf0624ac25e';
export const DEFAULT_POLICY_SEED = 0x53544154;
export const DURABLE_PROFILES = Object.freeze([
  Object.freeze({ id: 'static-byu-jumper', character: 'BYU', policy: 'jumper', cleanPointsRate: 0.8115 }),
  Object.freeze({ id: 'static-gyle-jumper', character: 'GYLE', policy: 'jumper', cleanPointsRate: 0.8105 }),
  Object.freeze({ id: 'static-mneme-zoner', character: 'MNEME', policy: 'zoner', cleanPointsRate: 0.9935 }),
]);

export function staticProfile(id) {
  const profile = DURABLE_PROFILES.find((entry) => entry.id === id);
  if (!profile) throw new Error(`unknown durable static-router profile: ${String(id)}`);
  return profile;
}

export function createSeededRandom(seed = DEFAULT_POLICY_SEED) {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    reset() { state = seed >>> 0; },
    state() { return state; },
  };
}

function baseAction() {
  return { t: 'input', moveX: 0, motion: 'N' };
}

function specialCode(self, kind) {
  const forward = self.facing === 1 ? 'R' : 'L';
  const back = self.facing === 1 ? 'L' : 'R';
  return kind === 'beam' ? `D${forward}` : `D${back}`;
}

export function createStaticGymPolicy(profileId, seed = DEFAULT_POLICY_SEED) {
  const profile = staticProfile(profileId);
  const rng = createSeededRandom(seed);
  const decide = (state) => {
    const { you: self, opp, phase } = state;
    const action = baseAction();
    if (phase !== 'fight' || !self || !opp) return { action, reason: 'inactive' };
    const dx = opp.x - self.x;
    const dist = Math.abs(dx);
    const toward = Math.sign(dx) || self.facing;
    const away = -toward;
    if (profile.policy === 'jumper') {
      if (self.stun > 0) {
        action.moveX = away; action.down = true;
        return { action, reason: 'jumper_stun_guard' };
      }
      if (self.y > 4) {
        if (dist < 40) action.kick = true;
        else action.moveX = toward;
        return { action, reason: dist < 40 ? 'jumper_air_kick' : 'jumper_air_advance' };
      }
      if (dist <= 30) {
        if (rng.next() < 0.5) action.throw = true;
        else action.kick = true;
        return { action, reason: action.throw ? 'jumper_close_throw' : 'jumper_close_kick' };
      }
      action.moveX = toward;
      if (rng.next() < 0.6) action.jump = true;
      return { action, reason: action.jump ? 'jumper_hop_advance' : 'jumper_advance' };
    }
    if (profile.policy !== 'zoner') throw new Error(`unsupported static policy: ${profile.policy}`);
    if (self.stun > 0) {
      action.moveX = away; action.down = true;
      return { action, reason: 'zoner_stun_guard' };
    }
    if (opp.y > 4 && dist < 44) {
      action.kick = true;
      return { action, reason: 'zoner_anti_air' };
    }
    if (dist > 90 && rng.next() < 0.4) {
      action.motion = specialCode(self, 'beam'); action.punch = true;
      return { action, reason: 'zoner_far_beam' };
    }
    if (dist > 55 && rng.next() < 0.25) {
      action.motion = specialCode(self, 'well'); action.punch = true;
      return { action, reason: 'zoner_mid_well' };
    }
    if (dist <= 30) {
      if (rng.next() < 0.4) action.throw = true;
      else action.kick = true;
      return { action, reason: action.throw ? 'zoner_close_throw' : 'zoner_close_kick' };
    }
    if (dist <= 42) {
      action.kick = true;
      return { action, reason: 'zoner_kick' };
    }
    action.moveX = dist > 60 ? toward : away;
    return { action, reason: dist > 60 ? 'zoner_advance' : 'zoner_retreat' };
  };
  return {
    profile,
    seed,
    decide,
    reset: () => rng.reset(),
    rngState: () => rng.state(),
  };
}

export function policyModuleHash(source) {
  return createHash('sha256').update(source).digest('hex');
}
