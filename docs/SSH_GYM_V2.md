# SSH Gym v2

SSH Gym v2 is the agent-owned, exact-engine environment for offline policy and
model evaluation. It deliberately lives outside the SSH Fighter server repo.
The server remains the public authenticated match surface; this repository owns
the policy tooling and consumes a commit-pinned read-only server snapshot as a
compatibility oracle.

## Contract

The CLI is newline-delimited JSON over stdin/stdout:

```bash
pnpm gym:ssh-v2
```

Each input line produces exactly one response line. A minimal session is:

```json
{"cmd":"version"}
{"cmd":"reset","a":"BYU","b":"MEN","seed":7,"stage":"dojo","observationProfile":"bot-wire-v1","actuationProfile":"round-safe-fifo-v1","inputDelayA":3,"inputDelayB":0}
{"cmd":"step","inputsA":{"moveX":1},"styleB":"grappler"}
{"cmd":"state"}
```

Supported commands are `ping`, `version`, `provenance`, `roster`, `reset`,
`state`, and `step`. `step.n` is bounded to 1..10000, and a command line is
bounded to 64 KiB.

## Experimental invariants

- `bot-wire-v1` is the canonical rounded fighter view plus active rounded
  projectiles used by the reviewed bot protocol.
- `engine-oracle-v1` exposes raw engine state and must be labelled as a
  dynamics-research oracle, not live observation parity.
- `direct-engine-input-v1` applies normalized inputs directly.
- `round-safe-fifo-v1` provides deterministic synthetic per-side delay and
  clears queued inputs outside `fight`, preventing stale round-crossing edges.
- Seeded style and engine randomness are scoped to the environment and do not
  mutate the host process's global RNG between calls.
- Fighter names, stage IDs, observation profiles, actuation profiles, styles,
  vendor commit, engine version, ordered roster, and component hashes fail
  closed.
- The environment reports authoritative match state. Consumers must count an
  outcome only at `match-over`; a diagnostic horizon or hard cap is not a win,
  loss, or draw.

## Provenance boundary

`version` and `provenance` report the agent implementation digest, exact vendor
commit, canonical `ENGINE_VERSION`, ordered roster, and hashes covering engine,
moves, types, roster, stages, bot wire, recorder, and built-in gym policies.

The profile is exact for the pinned offline source snapshot. It does **not**
attest which Git commit is deployed by sshfighter.com. The public server's
coarse engine label and authenticated roster are not silently promoted into a
deploy-commit claim. When the maintainer's canonical layered runtime profile
lands, a dedicated vendor-update PR can bind this consumer to that profile.

## What is intentionally not here

- no checkpoint loader or model framework;
- no SSH identity, API key, queue, Lounge, or live-match client;
- no duplicate combat mechanics;
- no server-side bridge or policy code;
- no claim that synthetic FIFO delay models ACK, sticky-input coalescing,
  packet loss, or jitter.

Model repositories should launch this process and keep their own checkpoint,
dataset-exposure, matrix, scoring, and artifact manifests. Transport-faithful
evaluation remains a separately versioned adapter.
