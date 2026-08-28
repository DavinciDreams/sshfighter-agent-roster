# Standstill screening

`src/gym/standstill-audit.ts` classifies contiguous, perspective-local Gym
telemetry without rewriting the raw run. It distinguishes policy output stalls
from engine-forced inactivity and requested/applied actuation failures.

The default threshold is a conservative 180 actionable frames (about six
seconds at 30 Hz), with 24 full-weight context frames retained at each edge.
Detected centers receive separate objective weights: policy `0`, dynamics
`0.10`, and value `0`. These are audit defaults, not universal truths; calibrate
them from per-policy run-length distributions and inspect a stratified sample
before producing a training corpus.

Input JSONL rows may contain either one perspective as `state`, or a complete
Gym result under `state.a`/`state.b`. Requested and applied inputs must be
recorded separately whenever possible:

```bash
pnpm audit:standstill --input run.jsonl --output run-audit.json --side a
```

The output contains source SHA-256, exact thresholds, counts, objective-weight
sums, and contiguous segments. Apply segments to the original timeline; never
concatenate clips across a downweighted gap, because doing so fabricates a
transition and corrupts history windows.
