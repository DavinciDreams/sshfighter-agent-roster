/** Reviewed, non-self-referential pins for the current-live protocol-v2 Gym. */
export const SSH_GYM_V3_SCHEMA = 'sshfighter-agent-roster/ssh-gym-v3/bot-protocol-v2';
export const SSH_GYM_V3_IMPLEMENTATION_SHA256 = '10db0dfb5032dca5fd0e5ecc5130bfbed6c38dad8aed0ad278fc234d1087f6fb';
export const PINNED_VENDOR_COMMIT = '838924f24b177f2a1eee0786578c3bd44d093108';
export const PINNED_ENGINE_VERSION = 'sf-8';
export const PINNED_BUILD = 'sf-8@838924f24b17';
export const PINNED_BOT_PROTOCOL = 2;
export const PINNED_SCHEMA_PATH = '/api/bot/schema';
export const PINNED_SCHEMA_SHA256 = '965f1b33bcfa1e4fc34f41ed5d10fbfbdddc3816636652769ec7dca237c5f528';

export const PINNED_ROSTER = [
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO', 'KIRA',
  'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON', 'MEGAWATTS', 'UNCLOSE',
] as const;

export const PINNED_VENDOR_FILES = {
  'package.json': '7288f56d4218edf1b9432c130d66b62d970417fc211f7928c6ea660d0cbcb0e6',
  'src/api/bot-schema.ts': '3932b31a2c35db0a71a8f5507ddd7cc112729ef1fadd0d3ad5dbd2f75c8f8c0b',
  'src/api/bot-server.ts': 'ad286523fd95c01f4ffe7a7b84e3e7d09a6c5a565c5b56662627453b526c63c8',
  'src/cluster/coordinator.ts': '8af8bd15dc412a980fcce8a0531168e69719ea7e0b44d0afc9328a62a5c77009',
  'src/game/engine.ts': '0c439dc5133f05fd4e8b2ace3635a0139fd2e06763547310a8e85a4eb3b518c2',
  'src/game/moves.ts': '7e6ece80dde381f7ab2cc6d343481b6539771f902e8ca7054d3853d7e0014921',
  'src/game/roster.ts': '5ea2d78d4fadc42aad5453d66d3db61b098d764b0e79efd7f0ce980874966299',
  'src/game/stage-set.ts': '3a90026eb5d9c74c61a81625231b713498c4b30e71683c1172b6751c03949abd',
  'src/game/types.ts': 'ca19ed499b9a76619098dc372d865fd6a966014e23f23b444571a9e845e9c49a',
  'src/version.ts': '5a1b9abd6e8b371f2730ee68c0867fe7263902cfb67d37f70ff56f2130e3ce3c',
} as const;
