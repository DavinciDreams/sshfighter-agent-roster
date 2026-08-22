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

## Activation boundary

These are stored candidate artifacts, not live-enabled runner profiles. The
live server now attests `sf-7@26591bce698d` and includes MEGAWATTS, while this
repository deliberately retains the previously reviewed 17-fighter `sf-6`
vendor checkout. Activation remains blocked until all of the following are
reviewed together:

1. the live MEGAWATTS implementation and attested runtime profile are reviewed;
2. the roster's vendor submodule is updated to that exact reviewed source;
3. a one-match runner binds MEGAWATTS plus the reviewed `compatibility_id` or
   exact `profile_id` and records policy/configuration hashes;
4. wire-delay and ACK behavior are evaluated separately from offline engine
   results; and
5. any live bout is explicitly armed and predeclared under the normal
   live-evaluation contract.

The existing durable MEGA supervisor remains on its frozen BYU/GYLE/MNEME
static-router rotation. Adding these artifacts does not activate or modify that
service.

## Local verification

```bash
pnpm test:megawatts-policy
```

The test covers the round-boundary flip, confirmed-hit veto, structural XENON
answers, literal kick hit feedback, positive damping, seeded stochastic replay,
live multi-cue retuning, and catalog provenance hashes.
