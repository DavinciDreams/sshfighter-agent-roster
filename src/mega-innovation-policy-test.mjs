#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  MegaKickModel, createMegaInnovationPolicy,
} from './policies/mega-innovation-router.mjs';
import {
  createPolicyForArgs, parseArgs,
} from './tools/static-router-quickmatch.mjs';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };

function fighter(overrides = {}) {
  return {
    x: 40, y: 0, vx: 0, vy: 0, facing: 1, hp: 100, wins: 0,
    attack: 'none', attackFrame: 0, stun: 0, active: false,
    ...overrides,
  };
}

function state(frame, overrides = {}) {
  return {
    t: 'state', frame, ack: Math.max(0, frame - 1), phase: 'fight', round: 1,
    roundTime: 60, hitStop: 0, you: fighter(), opp: fighter({ x: 100, facing: -1 }),
    projectiles: [], ...overrides,
  };
}

const oscillator = new MegaKickModel(0.1, 0.02);
oscillator.kick(0, 1);
const initialAmplitude = oscillator.amplitude();
oscillator.step(12);
check(oscillator.amplitude() < initialAmplitude, 'positive damping contracts the kick oscillator');
assert.throws(() => new MegaKickModel(0.1, 0), /gamma/); checks++;

const boundary = createMegaInnovationPolicy('static-byu-jumper', 'innovation-boundary', 73);
boundary.decide(state(1));
boundary.decide(state(2, { you: fighter({ hp: 70 }) }));
check(boundary.status().strategy === 'baseline', 'boundary policy does not retune inside a failing round');
boundary.decide(state(3, { phase: 'round-over', you: fighter({ hp: 70 }) }));
check(boundary.status().strategy === 'pressure'
  && boundary.status().innovationCount === 1,
'unanswered damage flips the complete tactical head at round boundary');

const hitVeto = createMegaInnovationPolicy('static-byu-jumper', 'innovation-boundary', 73);
hitVeto.decide(state(1));
hitVeto.decide(state(2, {
  you: fighter({ hp: 70 }), opp: fighter({ x: 100, facing: -1, hp: 92, stun: 12 }),
}));
hitVeto.decide(state(3, {
  phase: 'round-over', you: fighter({ hp: 70 }),
  opp: fighter({ x: 100, facing: -1, hp: 92, stun: 12 }),
}));
check(hitVeto.status().strategy === 'baseline' && hitVeto.status().evidence.confirmedHits === 1,
  'one confirmed hit vetoes the unanswered-damage boundary flip');

boundary.decide(state(4, {
  round: 2, you: fighter({ hp: 100 }), opp: fighter({ x: 72, facing: -1, hp: 100 }),
}));
check(boundary.status().evidence.kickAttempts === 1, 'pressure head emits and records a literal normal kick');
boundary.decide(state(5, {
  round: 2, you: fighter({ hp: 100, attack: 'kick', attackFrame: 1 }),
  opp: fighter({ x: 72, facing: -1, hp: 92, stun: 12 }),
}));
check(boundary.status().evidence.kickHits === 1,
  'authoritative opponent damage feeds a pending normal kick back as kick-hit');

const gap = createMegaInnovationPolicy('static-gyle-jumper', 'innovation-resonant', 991);
gap.decide(state(1));
gap.decide(state(9, { you: fighter({ hp: 88 }), opp: fighter({ x: 86, facing: -1, attack: 'kick' }) }));
check(gap.status().evidence.transportGaps === 1
  && gap.status().activeCues.includes('transport-gap'),
'wire-visible action-opportunity loss is an explicit transport cue');

function resonantTrace(seed) {
  const policy = createMegaInnovationPolicy('static-mneme-zoner', 'innovation-resonant', seed);
  const trace = [];
  for (let index = 0; index < 64; index++) {
    const frame = 1 + index * 6;
    const hp = index < 8 ? 100 - index * 7 : 51;
    const opponent = fighter({
      x: index % 3 === 0 ? 82 : 118, facing: -1,
      attack: index % 2 === 0 ? 'kick' : 'none', vx: index % 3 === 0 ? -3 : 0,
    });
    const projectiles = index % 4 === 0 ? [{ owner: 'b', x: 75, y: 0, vx: -4, style: 'fixture' }] : [];
    const result = policy.decide(state(frame, { you: fighter({ hp }), opp: opponent, projectiles }));
    trace.push({ action: result.action, reason: result.reason, status: policy.status() });
  }
  return trace;
}

const resonantA = resonantTrace(0xdecafbad);
const resonantB = resonantTrace(0xdecafbad);
check(JSON.stringify(resonantA) === JSON.stringify(resonantB),
  'a recorded resonant seed exactly replays actions and oscillator state');
check(resonantA.at(-1).status.liveRetunes > 0,
  'overlapping wire cues can retune the resonant policy inside a round');

const parsedBoundary = parseArgs([
  '--dry-run', '--profile', 'static-byu-jumper', '--policy-mode', 'innovation-boundary', '--seed', '73',
]);
check(parsedBoundary.policyMode === 'innovation-boundary' && parsedBoundary.seedSource === 'explicit',
  'runner binds explicit adaptive mode and replay seed');
const parsedResonant = parseArgs([
  '--dry-run', '--profile', 'static-byu-jumper', '--policy-mode', 'innovation-resonant',
]);
check(parsedResonant.seedSource === 'entropy' && Number.isInteger(parsedResonant.seed),
  'resonant mode generates and records entropy when no seed is supplied');
check(createPolicyForArgs(parsedBoundary).status().variant === 'boundary',
  'runner factory selects the adaptive controller only when requested');

const blankoArgs = parseArgs([
  '--dry-run', '--profile', 'blanko-oscillator-v1', '--policy-mode', 'innovation-resonant',
  '--opponents', 'bots', '--seed', '20260822',
]);
check(blankoArgs.profile.character === 'BLANKO' && blankoArgs.opponents === 'bots',
  'BLANKO candidate binds the bot-only pool explicitly');
const blanko = createPolicyForArgs(blankoArgs);
const rolling = blanko.decide(state(1, {
  you: fighter({ x: 40, facing: 1 }), opp: fighter({ x: 110, facing: -1 }),
}));
check(rolling.action.motion === 'LR' && rolling.action.punch === true,
  'BLANKO baseline converts spacing into a facing-relative Rolling Attack');
blanko.reset();
const antiAir = blanko.decide(state(1, {
  you: fighter({ x: 80, facing: -1 }), opp: fighter({ x: 118, y: 18, facing: 1 }),
}));
check(antiAir.action.motion === 'DU' && antiAir.action.kick === true,
  'BLANKO baseline converts an airborne approach into Vertical Roll');
blanko.reset();
const electric = blanko.decide(state(1, {
  you: fighter({ x: 80, facing: 1 }), opp: fighter({ x: 118, facing: -1 }),
}));
check(electric.action.motion === 'DU' && electric.action.punch === true,
  'BLANKO baseline uses Electric Thunder inside pressure range');
assert.throws(() => parseArgs([
  '--dry-run', '--profile', 'static-byu-jumper', '--policy-mode', 'unhinged',
]), /policy-mode/); checks++;

console.log(`MEGA INNOVATION POLICY TEST: PASS (${checks} checks)`);
