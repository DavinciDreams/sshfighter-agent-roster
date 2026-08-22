/** Reviewed, non-self-referential pins for the current-source protocol-v2 Gym. */
export const SSH_GYM_V3_SCHEMA = 'sshfighter-agent-roster/ssh-gym-v3/bot-protocol-v2';
export const SSH_GYM_V3_IMPLEMENTATION_SHA256 = '98cdd7bd7027703bff150ec29a133c83840052a4444828b3c63d42fba4f51673';
export const PINNED_VENDOR_COMMIT = '8a4e06fd424d566fe11bf2202850e0ee9741c89a';
export const PINNED_ENGINE_VERSION = 'sf-8';
export const PINNED_BUILD = 'sf-8@8a4e06fd424d';
export const PINNED_BOT_PROTOCOL = 2;
export const PINNED_SCHEMA_PATH = '/api/bot/schema';
export const PINNED_SCHEMA_SHA256 = '735eea494e93c00377a4a34ff803d9d73a7b77a939a3e65b7fafdf927cf07f42';

export const PINNED_ROSTER = [
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO', 'KIRA',
  'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON', 'MEGAWATTS', 'UNCLOSE',
] as const;

export const PINNED_VENDOR_FILES = {
  'package.json': '7288f56d4218edf1b9432c130d66b62d970417fc211f7928c6ea660d0cbcb0e6',
  'src/api/bot-schema.ts': '3932b31a2c35db0a71a8f5507ddd7cc112729ef1fadd0d3ad5dbd2f75c8f8c0b',
  'src/api/bot-server.ts': 'ad286523fd95c01f4ffe7a7b84e3e7d09a6c5a565c5b56662627453b526c63c8',
  'src/cluster/coordinator.ts': 'f6b90485b3f1c09b63d85aa69a94fb2a9112f644ec93a1e30436fe1903efadf9',
  'src/game/engine.ts': '43c7de52b65d4ca99f63af234196342898d97ed27bd7f2b3968e7d78c79e5e61',
  'src/game/moves.ts': '7e6ece80dde381f7ab2cc6d343481b6539771f902e8ca7054d3853d7e0014921',
  'src/game/roster.ts': '5ea2d78d4fadc42aad5453d66d3db61b098d764b0e79efd7f0ce980874966299',
  'src/game/stage-set.ts': '3a90026eb5d9c74c61a81625231b713498c4b30e71683c1172b6751c03949abd',
  'src/game/types.ts': 'ca19ed499b9a76619098dc372d865fd6a966014e23f23b444571a9e845e9c49a',
  'src/version.ts': '5a1b9abd6e8b371f2730ee68c0867fe7263902cfb67d37f70ff56f2130e3ce3c',
} as const;
