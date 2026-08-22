# SSH Fighter Agent Roster

Agent-owned runners, policies, provenance manifests, fixtures, and compatibility
tests for [SSH Fighter](https://github.com/thomasdavis/sshfighter.com).

This repository preserves the ownership boundary agreed with the SSH Fighter
maintainer:

- agents execute their own bots from infrastructure they control;
- the game server is only the authenticated protocol and match surface;
- no runner, policy, credential, checkpoint, or private decision trace is
  deployed into the server repository;
- upstream game code is consumed through a commit-pinned, read-only submodule;
- every runner fails closed on the reviewed compatibility profile before it
  joins the Lounge or emits combat input.

## Roster

| Runner | Role | Bound identity | Scope |
| --- | --- | --- | --- |
| XENON | outgoing direct challenger | `XENON_DGX` / XENON | one exact coordinated target, 15 supported opponents |
| CODEX | incoming passive opponent | `CODEX_DGX` / CODEX | one challenge from `XENON_DGX` / XENON |
| OMEGA | outgoing bounded Quick Match | `CODEX_DGX` / OMEGA | explicit arm, dual empty-queue gate, one match |
| MEGA | durable sequential Quick Match | `MEGA_BOT` / BYU, GYLE, MNEME | dedicated bot-labeled identity; frozen static-router profiles; fresh one-match child per bout |

Every runner is bounded to one match per invocation and never requeues. The
XENON and CODEX runners use direct Lounge challenges only. OMEGA and MEGA use
Quick Match. OMEGA requires an explicit arm and runs one bout; MEGA's durable
supervisor launches a fresh one-bout child for each rotation entry. Both paths
require empty-queue checks before and after authentication. Live runners write
an exclusive mode-`0600` redacted JSONL ledger.

## Checkout

```bash
git clone --recurse-submodules https://github.com/DavinciDreams/sshfighter-agent-roster.git
cd sshfighter-agent-roster
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

If the repository was cloned without submodules:

```bash
git submodule update --init --recursive
```

The compatibility pin is intentionally strict. Updating
`vendor/sshfighter` requires a dedicated PR, regenerated provenance hashes,
the complete test suite, and fresh review. The public `sf-6` label alone is
not a deploy-commit attestation.

## Current-live Gym

SSH Gym v3 pins exact `sf-8@8a4e06fd424d`, protocol 2, and reuses upstream's
canonical `botStateFor` observation projection and `botApiSchema` contract.
It is a separate epoch from historical Gym v2 evidence. See
[`docs/SSH_GYM_V3.md`](docs/SSH_GYM_V3.md).

```bash
pnpm test:ssh-gym-v3
pnpm ssh-gym-v3
```

## Dry runs

Dry runs validate local configuration without health, token, SSH, Lounge, or
match access:

```bash
pnpm runner:xenon --identity /path/to/xenon.key --handle XENON_DGX \
  --target AGREED_HANDLE --opponent FABLE --profile new-wave \
  --output /tmp/xenon-dry.jsonl --dry-run

pnpm runner:codex-dgx -- --identity /path/to/codex.key \
  --output /tmp/codex-dry.jsonl --dry-run

pnpm runner:omega-quickmatch --dry-run

pnpm runner:mega-quickmatch --dry-run --profile static-byu-jumper \
  --handle MEGA_BOT --expected-fingerprint SHA256:NoCiA/EN3QjY4iBoGRjExbvAqgfYNLKk7cJKWCui8W4
pnpm runner:mega --dry-run --handle MEGA_BOT \
  --expected-fingerprint SHA256:NoCiA/EN3QjY4iBoGRjExbvAqgfYNLKk7cJKWCui8W4
```

MEGA expands to **Multi-Expert Gym Agent**. Its supervisor is durable, but
each bout is still isolated inside the reviewed one-match Quick Match child.
See `docs/MEGA_DURABLE_QUICKMATCH.md` for the rotation, evidence boundary,
activation, monitoring, and stop commands.

Identity files and ledgers are deliberately ignored by Git. Never commit
tokens, SSH private keys, unreviewed connection metadata, raw private Lounge
traffic, or local traces. A deliberately public key fingerprint may be pinned
only when it is part of a reviewed identity gate.

## Live-use boundary

A successful test suite does not authorize a live match. Live execution still
requires a separately coordinated opponent, explicit consent, an exact
character/profile binding, a fresh ledger path, and the runner's one-match
bound. Results are transport evidence unless an efficacy experiment was
separately predeclared.
