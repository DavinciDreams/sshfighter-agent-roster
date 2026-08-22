# MEGAWATTS policy artifacts

The agent roster owns two character-specific MEGAWATTS controllers. Neither is
deployed in the SSH Fighter server repository.

| artifact | adaptation boundary | randomness | strategies |
|---|---|---|---|
| `megawatts-boundary-v1` | round boundary only | fixed default seed | survey, bombard, breach |
| `megawatts-resonant-v1` | live, after multi-cue agreement and minimum dwell | fresh entropy by default; exactly replayable with a recorded seed | survey, bombard, breach |

Both use the same positively damped two-state kick oscillator and observe actual
damage, confirmed hits, literal normal-kick conversion, opponent commitments,
spacing compression, and projectile traffic. The boundary controller changes
its complete strategy only after a round in which it took at least 24 damage
without confirming a hit. The resonant controller may retune inside a round,
but only after at least two cue families agree and its dwell/retune gates pass.

The policies do not inspect an opponent character name. They answer observable
mechanics: late Phase and tangible Blink recovery invite Ground Truth; live
Blink is guarded; and Reflect commitment changes the attack lane to Bombs of
Knowledge. Each knowledge core remains reflectable. The counter-pressure comes
from two fixed diagonal releases spaced 17 frames apart, which is longer than a
single 15-frame Reflect activation.

The stochastic controller records its 32-bit seed in `status()`. Supplying the
same seed reproduces its actions, oscillator state, cue history summary, and
strategy transitions.

## Protocol-2 activation boundary

The live server now attests exact clean `sf-8@838924f24b17`, bot protocol 2,
and an 18-fighter roster including MEGAWATTS. The separate standing-runner
change binds that exact schema and deployment. Activation remains review-gated
until all of the following are reviewed together:

1. the exact sf-8 schema and source commit are reviewed (Gym v3 is a separate
   profile rather than a relabel of the historical sf-6 Gym);
2. the standing runner binds `MEGAWATTSBOT`, MEGAWATTS, protocol 2, bot-only
   matchmaking, and records policy/configuration hashes;
3. wire delay, frame gaps, and ACK depth are recorded separately from offline
   results; and
4. the service units are enabled only from an independently approved merge.

The existing durable MEGA supervisor remains stopped on its historical frozen
BYU/GYLE/MNEME static-router rotation. The new `MEGAWATTSBOT` identity and unit
do not activate or modify that service. See `STANDING_BOTS_V2.md`.

## Local verification

```bash
pnpm test:megawatts-policy
```

The test covers the round-boundary flip, confirmed-hit veto, structural XENON
answers, literal kick hit feedback, positive damping, seeded stochastic replay,
live multi-cue retuning, and catalog provenance hashes.
