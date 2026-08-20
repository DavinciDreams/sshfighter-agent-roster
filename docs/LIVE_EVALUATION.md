# Live evaluation contract

Live match records are the acceptance evidence for live policy behavior.
Exact-engine gym results remain useful diagnostics, but they are not calibrated
predictions of the ladder: deterministic opponent styles, action-only delay,
and a fixed frame horizon differ materially from SSH play.

Every efficacy block must be predeclared and frozen before either runner joins
the Lounge or Quick Match:

- exact runner commit and clean-source implementation hashes;
- policy module/config hash, or checkpoint SHA-256 plus inference-wrapper hash;
- own handle/character and exact expected opponent handle/character/profile;
- match cap, targeting mechanism, stop conditions, and analysis horizon;
- official match IDs and per-match box scores/replay references.

Copied upstream weight/Hugging Face/source-commit constants are evidence
metadata, not proof of loaded runtime bytes. The deployed behavior binding is
the locally recomputed policy-module hash, or a locally recomputed checkpoint
and inference-wrapper hash pair.

Never substitute a random queued opponent for a declared target. For an
efficacy block, use a coordinated direct Lounge challenge and, if the target is
unavailable, record a constraint result without joining matchmaking. A
quick-match runner may enforce the expected opponent again at `matchStart` with
`--expected-opponent HANDLE --expected-opponent-character CHARACTER`, but that guard
only prevents combat and evidence inclusion. It is not exact targeting, and
aborting after random pairing can create an official forfeit.

## Transport measurements

Runner v2 ledgers add monotonic timestamps plus one `transport_sample` per
received state. Each sample records frame/ACK progression, skipped frames,
unacknowledged inputs, and the first observed acknowledgment for each locally
numbered input. Decisions record their duration and input sequence. Use
`summarizeLiveLedger` from `src/live-eval-metrics.mjs` for p50/p95/max decision
and ACK latency, ACK frame lag, and skipped-frame rate.

Decision-in-flight state messages are recorded as suppressed/coalesced and do
not produce another action before the prior decision completes. These are
client observations, not server-internal timestamps. Public replays
contain applied inputs but no client receive/send clocks or ACK timeline, so
they cannot reconstruct transport latency after the fact.

## Outcome measurements

Report match wins, round differential, damage differential, hits, specials,
end reason, and duration from each official match record. Do not use the player
profile's `rounds_won` as a literal round total: the current server increments
that aggregate only for the match winner. Sum `a_rounds`/`b_rounds` from the
authoritative match rows instead.

Offline trials stopped at a frame horizon are right-censored. Report terminal
rate, nominal win rate, conditional win rate among resolved trials, and horizon
HP/round margin separately. A fixed delayed-action FIFO is a sensitivity cell,
not a model of delayed observation, inference time, state coalescing, or SSH
jitter.
