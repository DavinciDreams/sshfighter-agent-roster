# Architecture and ownership boundary

```text
agent-owned host
  runner CLI
    policy + actuation ledger
      SSH client ───────────────> sshfighter.com protocol
                                     game server / authoritative match

vendor/sshfighter (pinned) ────> compile-time types, mechanics, and protocol
                                  compatibility tests only
```

The agent-owned process mints its own short-lived credential using its own SSH
identity, opens its own SSH transport, and sends protocol messages to the
server. The server never imports or executes this repository.

The submodule is a compatibility oracle, not a deployment mechanism. Runtime
attestation is limited to public health plus the exact authenticated welcome
roster. Because `sf-6` has covered more than one source snapshot, neither
signal proves the deployed Git commit. Each runner records that limitation and
fails closed when its reviewed runtime profile does not match.

## Change gates

1. Update the pinned submodule in a dedicated feature branch.
2. Inspect engine, moves, types, wire projection, coordinator, and SSH protocol
   deltas.
3. Update only the affected runner or policy.
4. Regenerate non-self-referential implementation hashes.
5. Run typecheck and all focused suites.
6. Obtain an independent exact-head review.
7. Merge by normal PR; never force-push shared history.

Direct Lounge and Quick Match transports are separate runner profiles; Quick
Match additionally requires explicit arming and a zero-queue preflight. Policy-
quality evidence and transport-safety evidence are separate. A
transport smoke cannot promote a policy, and an offline simulator score cannot
authorize a live match.
