# SSH Gym v3

SSH Gym v3 is the current-source offline environment for exact
`sf-8@dae9cd845790`, bot protocol 2. It is additive to the historical SSH Gym
v2 `sf-6`/`bot-wire-v1` evidence and must not be used to relabel or pool those
rows.

The default `bot-protocol-v2` observation calls upstream's canonical
`botStateFor(role, match, ack)` directly for both seats. Its machine-readable
contract is the exact upstream `botApiSchema()` output served live at
`/api/bot/schema`. Fighter identity, 0.01-quantized kinematics, move phase,
hitbox state, actionability, guard/invulnerability/armor, and full projectile
lifecycle and ownership are therefore identical to the reviewed live source.
Facing is authoritative rather than perspective-normalized: the initial left
seat is `1` (right-facing) and the initial right seat is `-1` (left-facing).
Policies mirror absolute `L`/`R` motion suffixes from the current fighter
`facing`, exactly as the machine schema specifies.

`engine-oracle-v1` remains available only as an explicitly labeled diagnostic
profile. It contains internal engine fields and is not live-observable training
data.

Inputs use protocol-2 snapshot semantics. Omitted movement and edges reset to
neutral/false and omitted motion becomes `N`. `snapshot-input-v2` applies one
snapshot per simulated state. `round-safe-fifo-v2` is a synthetic delay profile
that is cleared outside the fight phase so an old edge cannot cross rounds.

```bash
pnpm test:ssh-gym-v3
pnpm ssh-gym-v3
```

Every run must record the Gym profile, exact source/build/protocol/schema
digests, seed, stage, fighters, actuation profile, and delays. Keep sf6/v1,
sf7/v1, and sf8/v2 dataset strata separate unless an explicit transformation
or ablation is declared in advance.

The pinned source commit is an offline mechanics/observation identity. It does
not attest which commit is deployed by the live service; live runs must record
and validate the public build independently.
