# MEGA durable Quick Match

MEGA is the **Multi-Expert Gym Agent**. It rotates three predeclared profiles
from the clean 62,424-match frozen-router matrix:

| profile | fighter | frozen expert | clean exact-engine points |
|---|---|---|---:|
| `static-byu-jumper` | BYU | jumper | 0.8115 |
| `static-gyle-jumper` | GYLE | jumper | 0.8105 |
| `static-mneme-zoner` | MNEME | zoner | 0.9935 |

Those rates are synthetic exact-engine evidence, not expected live win rates.
The source artifact is pinned by SHA-256 and Hugging Face revision in the
policy module and every live ledger.

MEGA uses its dedicated enrolled `MEGA_BOT` transport identity. The bot-labeled
handle distinguishes it from the separate `CODEX_DGX` player. The expected public
key fingerprint, agent label, profile, fighter, seed, source hashes, and
official result are recorded on every bout. OMEGA is not part of the rotation;
it remains a historical control.

## Safety model

- An exclusive mode-0600 supervisor lock enforces one MEGA process per output
  directory; a stale lock fails closed and requires an operator to verify no
  process remains before removal. MEGA never self-matches.
- Public and authenticated queue telemetry must both be numeric integer zero.
- The authenticated welcome must contain the exact ordered 17-fighter roster.
- Every bout executes in a new one-match child and a new exclusive mode-0600
  ledger. The child never requeues.
- The child emits no input while its previous input is unacknowledged, avoiding
  coordinator coalescing that can overwrite a special motion.
- Queue-busy/no-opponent conditions back off. Three consecutive fatal child
  failures open the circuit breaker; a service manager may restart only after
  its configured delay.
- `SIGINT`/`SIGTERM` stops the active child and prevents another launch.

## Local checks

```bash
pnpm test:static-router-quickmatch
pnpm runner:mega-quickmatch --dry-run --profile static-byu-jumper \
  --handle MEGA_BOT --expected-fingerprint SHA256:NoCiA/EN3QjY4iBoGRjExbvAqgfYNLKk7cJKWCui8W4
pnpm runner:mega --dry-run --handle MEGA_BOT \
  --expected-fingerprint SHA256:NoCiA/EN3QjY4iBoGRjExbvAqgfYNLKk7cJKWCui8W4
```

## Durable activation

Use a stable checkout, never a temporary worktree. The output directory must
be private and outside Git:

```bash
mkdir -p -m 700 "$HOME/experiments/sshfighter/mega-quickmatch"

systemd-run --user --unit=sshfighter-mega-quickmatch --collect \
  --property=Restart=on-failure --property=RestartSec=300 \
  --working-directory=/ABSOLUTE/PATH/TO/sshfighter-agent-roster \
  /usr/bin/env pnpm runner:mega \
    --identity "$HOME/.ssh/sshfighter_mega_bot_ed25519" \
    --handle MEGA_BOT \
    --expected-fingerprint SHA256:NoCiA/EN3QjY4iBoGRjExbvAqgfYNLKk7cJKWCui8W4 \
    --out-dir "$HOME/experiments/sshfighter/mega-quickmatch" \
    --cooldown-ms 15000 --idle-backoff-ms 30000 --max-failures 3 \
    --max-matches 0
```

Monitor and stop it with:

```bash
journalctl --user -fu sshfighter-mega-quickmatch
systemctl --user stop sshfighter-mega-quickmatch
```

`--max-matches 0` is the explicit durable setting. Use a positive value for a
finite data block. Activation remains a live external action and must be
separately authorized from code review or merge.
