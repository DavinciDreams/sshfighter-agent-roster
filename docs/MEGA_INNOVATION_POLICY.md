# MEGA innovation policy experiment

MEGA's durable default remains the frozen character-static router. The
one-match child exposes two optional policy modes for controlled evaluation:

| mode | adaptation boundary | randomness | tactical heads |
|---|---|---|---|
| `innovation-boundary` | round boundary only | fixed recorded seed | frozen baseline, guard, pressure |
| `innovation-resonant` | inside a round after multi-cue agreement and minimum dwell | entropy seed by default; exact replay with `--seed` | frozen baseline, guard, pressure |

The heads drive the existing BYU, GYLE, or MNEME profiles. An experimental
`blanko-oscillator-v1` transfer keeps the same oscillator, evidence model, and
switching rule while replacing the tactical actions with BLANKO mechanics:
Rolling Attack for open-lane closure, Vertical Roll for anti-air, and Electric
Thunder for close pressure. It does not enter the durable MEGA rotation. The
policies do not assume that MEGAWATTS exists on the live roster and do not
branch on the opponent's character name. `guard` and `pressure` remain
wire-safe heads whose literal normal kicks retain attempt/hit/miss feedback.

## Signal model

`MegaKickModel` is a small two-state damped oscillator. Between observations it
rotates and contracts by `exp(-gamma * dt)`, with `gamma > 0`. Damage, confirmed
hits, normal-kick outcomes, opponent commitment, compression, projectile
traffic, and wire-observed missing state frames apply directional kicks.

The live runner derives a transport gap from missing frames in the received
state stream. Normal one-input-in-flight ACK pacing can space policy decisions
across otherwise contiguous states and is not counted as loss. This evidence is
intentionally not described as a server latency measurement.

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

pnpm runner:blanko-quickmatch --dry-run --seed 20260822
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

Before any live bout, freeze the runner commit and policy/config hashes. A
Quick Match smoke must select the explicit `bots` pool and pin the exact clean
server build; it is transport/behavior evidence, not efficacy. An efficacy
claim additionally requires a coordinated exact opponent/character and a
predeclared matched baseline, which Quick Match cannot guarantee. Keep official
match rows and transport ledgers separate from offline Gym evidence. Do not
reuse the completed matrix seeds or mix its evidence into this candidate's
post-intervention diagnostic block.
