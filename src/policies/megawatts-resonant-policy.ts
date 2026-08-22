import {
  DEFAULT_MEGAWATTS_RESONANT_CONFIG,
  MegawattsInnovationPolicy,
  type MegawattsFighterView,
  type MegawattsInnovationConfig,
  type MegawattsPolicyState,
  type MegawattsProjectileView,
  type Inputs,
  type WirePolicy,
} from './megawatts-innovation-policy.js';

function configuredSeed(): number | undefined {
  const raw = process.env.MEGAWATTS_POLICY_SEED;
  if (!raw) return undefined;
  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('MEGAWATTS_POLICY_SEED must be an unsigned 32-bit integer');
  }
  return seed;
}

export function createWirePolicy(config: Partial<MegawattsInnovationConfig> = {}): WirePolicy {
  const policy = new MegawattsInnovationPolicy({
    ...DEFAULT_MEGAWATTS_RESONANT_CONFIG,
    seed: config.seed ?? configuredSeed(),
    ...config,
    variant: 'resonant',
  });
  return {
    decide: (state: MegawattsPolicyState) => policy.decide(state),
    reset: () => policy.reset(),
    status: () => policy.snapshot(),
  };
}

// Portable stochastic gym interface. Set MEGAWATTS_POLICY_SEED to replay a run.
const gym = createWirePolicy();
let gymFrame = 0;
export function reset(): void { gymFrame = 0; gym.reset(); }
export function decide(
  self: MegawattsFighterView,
  opp: MegawattsFighterView,
  phase: string,
  projectiles: readonly MegawattsProjectileView[] = [],
): Inputs {
  gymFrame++;
  return gym.decide({
    frame: gymFrame,
    phase,
    round: self.wins + opp.wins + 1,
    roundTime: 0,
    you: self,
    opp,
    projectiles,
  });
}

export const POLICY_VARIANT = 'resonant-stochastic-v1';
