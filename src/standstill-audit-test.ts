#!/usr/bin/env node
import assert from 'node:assert/strict';

import { auditManifest, auditStandstill, type AuditFrame } from './gym/standstill-audit.js';

const frame = (n: number, overrides: Partial<AuditFrame> = {}): AuditFrame => ({
  state: {
    frame: n, phase: 'fight', hitStop: 0,
    you: { x: 80, y: 0, hp: 100, stun: 0, attack: 'none', actionable: true, movePhase: 'neutral' },
    opp: { x: 160, y: 0, hp: 100, stun: 0, attack: 'none', actionable: true, movePhase: 'neutral' },
    projectiles: [],
  },
  requested: {}, applied: {}, ...overrides,
});

const longIdle = Array.from({ length: 12 }, (_, index) => frame(index));
const audit = auditStandstill(longIdle, { minStandstillFrames: 8, contextFrames: 2 });
assert.equal(audit.summary.counts['policy-standstill'], 8);
assert.equal(audit.summary.counts['legitimate-neutral'], 4);
assert.equal(audit.frameAudits[2]!.weights.policy, 0);
assert.equal(audit.frameAudits[2]!.weights.dynamics, 0.1);
assert.equal(audit.frameAudits[0]!.weights.policy, 1, 'context collar remains trainable');

const shortNeutral = auditStandstill(longIdle.slice(0, 7), { minStandstillFrames: 8, contextFrames: 2 });
assert.equal(shortNeutral.summary.counts['policy-standstill'], 0,
  'ordinary short neutral play is not called a standstill');

const forced = longIdle.map((item, index) => index === 5 ? frame(index, {
  state: { ...item.state, hitStop: 2 },
}) : item);
const forcedAudit = auditStandstill(forced, { minStandstillFrames: 8, contextFrames: 0 });
assert.equal(forcedAudit.summary.counts['policy-standstill'], 0,
  'engine-forced inactivity breaks a candidate tract');
assert.equal(forcedAudit.summary.counts['forced-inactivity'], 1);

const actuation = Array.from({ length: 10 }, (_, index) => frame(index, {
  requested: { moveX: 1 }, applied: {},
}));
const actuationAudit = auditStandstill(actuation, { minStandstillFrames: 8, contextFrames: 1 });
assert.equal(actuationAudit.summary.counts['actuation-stall'], 8,
  'requested-vs-applied disagreement is not blamed on the policy');

const active = Array.from({ length: 10 }, (_, index) => frame(index, {
  state: { ...frame(index).state, you: { ...frame(index).state.you, x: 80 + index } },
  requested: { moveX: 1 }, applied: { moveX: 1 },
}));
const activeAudit = auditStandstill(active, { minStandstillFrames: 8, contextFrames: 0 });
assert.equal(activeAudit.summary.counts['policy-standstill'], 0);
assert(activeAudit.summary.counts['active-combat'] >= 9);

const attacking = Array.from({ length: 10 }, (_, index) => frame(index, {
  state: { ...frame(index).state, you: { ...frame(index).state.you, attack: 'punch', active: true } },
}));
const attackingAudit = auditStandstill(attacking, { minStandstillFrames: 8, contextFrames: 0 });
assert.equal(attackingAudit.summary.counts['active-combat'], 10);
assert.equal(attackingAudit.summary.counts['policy-standstill'], 0);

const manifest = auditManifest(audit, 'same input', { engineCommit: 'fixture' }) as any;
assert.equal(manifest.source.engineCommit, 'fixture');
assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
assert(manifest.segments.every((segment: any) => segment.endFrame >= segment.frame));

assert.throws(() => auditStandstill([frame(2), frame(1)]), /strictly increasing/);
console.log('STANDSTILL AUDIT TEST: PASS');
