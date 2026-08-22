# Protocol-2 standing bots

`BLANK-BOT` and `MEGAWATTSBOT` are agent-owned standing runners for the exact
clean SSH Fighter deployment `sf-8@614fc431c214` (commit
`614fc431c214c74dbc32741d1e25a39b4084acf2`) and bot protocol 2. They run on
Wife AI infrastructure; no policy, key, or trace is installed in the game
server repository.

| agent | authenticated identity | fighter | policy |
| --- | --- | --- | --- |
| BLANK | `BLANK-BOT` / `SHA256:xd/3Gvx2khlsWD2qBEU2kR7CUaMn1TDUTIV7qxNK7R8` | BLANKO | damped oscillator, resonant transfer |
| MEGAWATTS | `MEGAWATTSBOT` / `SHA256:Zb/rg2d5XEjD6tU5a3aS6CLjrAiDOAh41Tlj55TeFRE` | MEGAWATTS | character-native resonant controller |

## Protocol and API boundary

The runner treats `GET /api/bot/schema` as the canonical contract and requires
its exact canonical SHA-256,
`b4eeecb42f32f6f217c23ead2997681d49a68158f4da2a2e5d5e9ad6f21f3a2a`.
It also checks `/version` and `/api/health` before opening a transport. The
recommended `ssh HANDLE@sshfighter.com play` path remains the data plane: it
authenticates the key and tunnels to the loopback-only bot server. Direct TCP
is intentionally absent because the operator has not advertised a public bot
endpoint; a minted API token is not a reason to guess one.

Every state produces exactly one complete input snapshot. The runner does not
gate decisions on ACK. It checks that ACK is monotonic and cannot acknowledge
more inputs than were sent. Server input sequence is connection-global, while a
new match can initially report ACK `0`; inputs ignored between matches are not
assigned a server sequence. The runner therefore keeps separate client-send and
server-ACK high-water marks plus per-match baselines. Outstanding depth is a
baseline-relative estimate, not a literal per-input acknowledgment binding,
because protocol 2 does not accept a client sequence or echo the assigned one.
Protocol-2 fighter identity, move phase, live hitbox, actionability, and
projectile ownership/lifecycle fields are validated before policy use.
Own, inert, and temporarily non-hitting projectiles are not treated as threats.

The Quick Match request is fixed to `opponents: bots`. `matchStart` must report
`oppType: bot`, and the public official result must independently bind both bot
identities, characters, exact engine commit, and clean-build flag. A mismatch
fails closed and relies on the service manager for a fresh connection.

After each completed match, the runners wait for a deterministic seeded jitter
before rejoining the bot pool. BLANK-BOT uses a 1–6 second cooldown and
MEGAWATTSBOT uses a non-overlapping 9–18 second cooldown. The stagger prevents
the two local runners from immediately requeueing as a pair after every match,
while retaining reproducible audit evidence. Matchmaking still depends on which
other bots are available, so varied partners are encouraged rather than
guaranteed. Each `requeue-scheduled` lifecycle row records the selected delay,
base, jitter, and completed-match count.

## Training traces

Each match gets an exclusive mode-`0600` JSONL file containing the received
state, full action snapshot, policy state, monotonic decision duration,
state-frame gap, ACK, sent sequence, and outstanding-input depth. Session and
official-result boundaries are stored separately. This is live transport data
for the protocol-2 Gym profile; it is not automatically labeled as efficacy
evidence and is never committed.

## Dry run

```bash
pnpm runner:blank-standing \
  --identity /home/ubuntu/Dev/.sshfighter/blank_bot_ed25519 \
  --out-dir /tmp/blank-standing --dry-run

pnpm runner:megawatts-standing \
  --identity /home/ubuntu/Dev/.sshfighter/watts_bot_ed25519 \
  --out-dir /tmp/megawatts-standing --dry-run
```

Live execution additionally requires `--armed`. The checked-in user units
include it, but must not be enabled from an unmerged or unreviewed checkout.

## Reviewed activation

After independent approval and merge, update the stable checkout, install the
units, and then enable them:

```bash
install -Dm644 deploy/systemd/user/sshfighter-blank-bot.service \
  ~/.config/systemd/user/sshfighter-blank-bot.service
install -Dm644 deploy/systemd/user/sshfighter-megawattsbot.service \
  ~/.config/systemd/user/sshfighter-megawattsbot.service
systemctl --user daemon-reload
systemctl --user enable --now sshfighter-blank-bot.service sshfighter-megawattsbot.service
```

Stop both without touching the retired MEGA service:

```bash
systemctl --user disable --now sshfighter-blank-bot.service sshfighter-megawattsbot.service
```

The historical BLANK sf-7 one-bout runner remains evidence for match
`mmt3v8d2729`; it cannot arm against sf-8. The legacy `MEGA_BOT` supervisor is
not re-enabled or modified by these units.
