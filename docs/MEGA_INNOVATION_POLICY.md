# MEGA innovation policy experiment

MEGA's durable default remains the frozen character-static router. The
one-match child exposes two optional policy modes for controlled evaluation:

| mode | adaptation boundary | randomness | tactical heads |
|---|---|---|---|
| `innovation-boundary` | round boundary only | fixed recorded seed | frozen baseline, guard, pressure |
| `innovation-resonant` | inside a round after multi-cue agreement and minimum dwell | entropy seed by default; exact replay with `--seed` | frozen baseline, guard, pressure |

The heads drive the existing BYU, GYLE, or MNEME profiles. They do not assume
that MEGAWATTS exists on the live roster and do not branch on the opponent's
character name. The `baseline` head is the unchanged frozen static policy.
`guard` and `pressure` are wire-safe generic heads whose normal kicks have
literal attempt/hit/miss feedback.

## Signal model

`MegaKickModel` is a small two-state damped oscillator. Between observations it
rotates and contracts by `exp(-gamma * dt)`, with `gamma > 0`. Damage, confirmed
hits, normal-kick outcomes, opponent commitment, compression, projectile
traffic, and policy-visible action-opportunity gaps apply directional kicks.

An action-opportunity gap means the policy was next invoked more than one game
frame after its previous decision. Offline frame-step evaluation normally sees
no such gap. Under the one-input-in-flight live runner, it can reflect ACK
waiting or state coalescing. It is intentionally not described as a server
latency measurement.

The boundary controller flips its complete tactical head only when both votes
agree at round close:

1. MEGA took at least 24 damage with zero confirmed hits.
2. Oscillator amplitude crossed the configured threshold.

The resonant controller additionally requires at least two recent cue families,
a minimum strategy dwell, and a retune interval. It uses seeded Gumbel
perturbation to select a different head. Omitting `--seed` draws a fresh 32-bit
seed and records it in the manifest; supplying that seed replays the run.

This is a pragmatic 2D analogue of the HAM Kick lineage, not its Clifford
implementation. The complete adaptive state is exposed in `adaptive_state`
ledger rows: seed, configuration, oscillator state, cue families, evidence,
strategy, and transition counters.

## Local checks

```bash
pnpm test:mega-innovation-policy

pnpm runner:mega-quickmatch --dry-run \
  --profile static-byu-jumper \
  --policy-mode innovation-boundary \
  --seed 73

pnpm runner:mega-quickmatch --dry-run \
  --profile static-byu-jumper \
  --policy-mode innovation-resonant
```

The durable supervisor does not forward an adaptive policy mode. This keeps
the installed service on `static` and makes accidental durable activation of a
candidate impossible. A candidate test must be a separately reviewed,
explicitly armed one-match child.

## Live-evaluation gate

Do not infer live efficacy from exact-engine Gym results. Prior work established
four distinct failure modes that a predeclared live block must preserve:

- asymmetric target/opponent delay can reverse an apparently robust result;
- the public wire rounds fighter state and normalizes absolute projectile owners;
- several unacknowledged inputs can split a special motion from its sticky edge;
- a public engine label is not exact deploy-commit attestation.

The frozen gx10 ACK/sticky matrix has now completed all 749,088 matches with
zero technical failures. Raw-queue static/linear/Chebyshev points were
0.5941/0.6122/0.6060, while the ACK/sticky realizations fell to
0.1392/0.1924/0.1958. Dynamic heads helped relative to static inside that
realization, but every controller collapsed in absolute terms. This is a
controller/deployment-model negative, not promotion evidence.

Before any live bout, rebase this candidate onto the separate live-evaluation
telemetry work, freeze the runner commit and policy/config hashes, bind an exact
opponent and character, and predeclare a matched static baseline. Keep official
match rows and transport ledgers separate from offline Gym evidence. Do not
reuse the completed matrix seeds or mix its evidence into this candidate's
post-intervention diagnostic block.
