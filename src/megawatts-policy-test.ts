import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MegawattsInnovationPolicy,
  MegawattsKickModel,
  type MegawattsFighterView,
  type MegawattsPolicyState,
} from './policies/megawatts-innovation-policy.js';
import { createWirePolicy as createResonantWirePolicy } from './policies/megawatts-resonant-policy.js';

let checks = 0;
const check = (condition: unknown, message: string): void => {
  assert(condition, message);
  checks++;
};

const fighter = (overrides: Partial<MegawattsFighterView> = {}): MegawattsFighterView => ({
  x: 90, y: 0, vx: 0, vy: 0, facing: 1, hp: 100, wins: 0,
  attack: 'none', attackFrame: 0, stun: 0, crouching: false,
  active: false, casting: false, pose: 'idle', ...overrides,
});

const state = (
  frame: number,
  phase = 'fight',
  round = 1,
  you: Partial<MegawattsFighterView> = {},
  opp: Partial<MegawattsFighterView> = {},
): MegawattsPolicyState => ({
  frame, phase, round, roundTime: 50,
  you: fighter(you), opp: fighter({ x: 180, facing: -1, ...opp }), projectiles: [],
});

const oscillator = new MegawattsKickModel(0.1, 0.02);
oscillator.kick(0, 1);
const initialAmplitude = oscillator.amplitude();
oscillator.step(12);
check(oscillator.amplitude() < initialAmplitude, 'positive damping contracts the kick oscillator');
assert.throws(() => new MegawattsInnovationPolicy({ oscillatorGamma: 0 }), /positive/); checks++;

const boundary = new MegawattsInnovationPolicy();
boundary.decide(state(1));
boundary.decide(state(2, 'fight', 1, { hp: 70 }));
check(boundary.snapshot().strategy === 'survey', 'boundary policy cannot change strategy in-round');
boundary.decide(state(3, 'round-over', 1, { hp: 70 }));
check(boundary.snapshot().strategy === 'breach' && boundary.snapshot().innovationCount === 1,
  'unanswered damage flips the complete strategy at round close');

const answered = new MegawattsInnovationPolicy();
answered.decide(state(1));
answered.decide(state(2, 'fight', 1, { hp: 68 }, { hp: 88, stun: 12, pose: 'hit' }));
answered.decide(state(3, 'round-over', 1, { hp: 68 }, { hp: 88, stun: 12, pose: 'hit' }));
check(answered.snapshot().strategy === 'survey' && answered.snapshot().evidence.confirmedHits === 1,
  'one confirmed hit vetoes the unanswered-damage flip');

const reflectAnswer = new MegawattsInnovationPolicy();
const reflectInput = reflectAnswer.decide(state(1, 'fight', 1, {}, {
  attack: 'reflect', attackFrame: 5, active: true,
}));
check(reflectInput.t === 'input' && reflectInput.motion === 'DU' && reflectInput.punch,
  'Reflect commitment selects the spaced diagonal bombardment lane');

const phaseAnswer = new MegawattsInnovationPolicy();
const phaseInput = phaseAnswer.decide(state(1, 'fight', 1, { x: 100 }, {
  x: 158, attack: 'phase', attackFrame: 14,
}));
check(phaseInput.motion === 'DU' && phaseInput.kick,
  'predicted Phase exit selects Ground Truth');

const blinkGuard = new MegawattsInnovationPolicy();
const blinkLiveInput = blinkGuard.decide(state(1, 'fight', 1, { x: 100 }, {
  x: 130, attack: 'blink', attackFrame: 4, active: true,
}));
check(blinkLiveInput.moveX === -1, 'live Blink frames are guarded');

const blinkPunish = new MegawattsInnovationPolicy();
const blinkRecoveryInput = blinkPunish.decide(state(1, 'fight', 1, { x: 100 }, {
  x: 130, attack: 'blink', attackFrame: 8,
}));
check(blinkRecoveryInput.motion === 'DU' && blinkRecoveryInput.kick,
  'tangible Blink recovery selects Ground Truth');

const actualKick = new MegawattsInnovationPolicy();
actualKick.decide(state(1));
actualKick.decide(state(2, 'fight', 1, { hp: 68 }));
actualKick.decide(state(3, 'round-over', 1, { hp: 68 }));
const kickInput = actualKick.decide(state(20, 'fight', 2, { x: 100 }, { x: 140 }));
check(kickInput.kick && kickInput.motion === 'N', 'breach emits a literal normal kick');
actualKick.decide(state(21, 'fight', 2,
  { x: 100, attack: 'kick', attackFrame: 1 },
  { x: 140, hp: 92, stun: 12, pose: 'hit' }));
check(actualKick.snapshot().evidence.kickAttempts === 1
  && actualKick.snapshot().evidence.kickHits === 1
  && actualKick.snapshot().activeCues.includes('kick-hit'),
'authoritative damage and stun feed a pending normal kick back as kick-hit');

const resonantConfig = {
  variant: 'resonant' as const, seed: 0xdecafbad,
  retuneEveryFrames: 4, minimumDwellFrames: 4, cueWindowFrames: 120,
};
const resonantA = new MegawattsInnovationPolicy(resonantConfig);
const resonantB = new MegawattsInnovationPolicy(resonantConfig);
let replayedActions = true;
for (let frameNo = 1; frameNo <= 180; frameNo++) {
  const hp = 100 - Math.min(45, Math.floor(frameNo / 12) * 4);
  const distance = 94 - (frameNo % 24);
  const attack = frameNo % 10 < 5 ? 'reflect' : 'none';
  const projectiles = frameNo % 9 === 0
    ? [{ owner: 'b' as const, x: 130, y: 30, vx: -3, style: 'blue' }]
    : [];
  const sample: MegawattsPolicyState = {
    ...state(frameNo, 'fight', 1, { hp, x: 90 }, {
      x: 90 + distance, vx: -2.5, attack, attackFrame: frameNo % 5,
      casting: attack !== 'none', active: false,
    }),
    projectiles,
  };
  const left = resonantA.decide(sample);
  const right = resonantB.decide(structuredClone(sample));
  replayedActions &&= JSON.stringify(left) === JSON.stringify(right);
}
check(replayedActions && JSON.stringify(resonantA.snapshot()) === JSON.stringify(resonantB.snapshot()),
  'the same seed replays stochastic actions and full adaptive state');
check(resonantA.snapshot().liveRetunes > 0,
  'multi-cue agreement can retune the resonant strategy inside a round');
check(createResonantWirePolicy({ seed: 73 }).status().variant === 'resonant',
  'the resonant entrypoint cannot silently select the boundary variant');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'roster/agents.json'), 'utf8')) as {
  policyArtifacts?: Array<{
    id: string;
    implementationFiles: string[];
    implementationSha256: string;
    activation: string;
  }>;
};
const hashFiles = (files: string[]): string => {
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file).update('\0');
    digest.update(readFileSync(resolve(root, file))).update('\0');
  }
  return digest.digest('hex');
};
for (const id of ['megawatts-boundary-v1', 'megawatts-resonant-v1']) {
  const artifact = catalog.policyArtifacts?.find((candidate) => candidate.id === id);
  check(artifact?.implementationSha256 === hashFiles(artifact?.implementationFiles ?? []),
    `${id} catalog pins its complete implementation bytes`);
  check(artifact?.activation === 'review-gated-sf8-standing-runner',
    `${id} remains independently review-gated after exact sf-8 attestation`);
}

console.log(`MEGAWATTS POLICY TEST: PASS (${checks} checks)`);
