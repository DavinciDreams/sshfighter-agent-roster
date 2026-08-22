/**
 * Reviewed source pins for the agent-owned SSH Gym v2 environment.
 *
 * This file is deliberately excluded from the implementation digest it stores.
 * The digest covers the executable environment and CLI, so changing behavior
 * cannot be hidden by merely editing this expected value in the same file.
 */
export const SSH_GYM_V2_SCHEMA = 'sshfighter-agent-roster/ssh-gym-v2';
export const SSH_GYM_V2_IMPLEMENTATION_SHA256 = '8e33b771f165f30615642ab56358a0d7ca7da11465c2c912403755f23bc868a2';

export const PINNED_VENDOR_COMMIT = '3caedf3435c12996cf4d34fb5ac76c7cd7b75076';
export const PINNED_ENGINE_VERSION = 'sf-6';

export const PINNED_ROSTER = [
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO', 'KIRA',
  'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON', 'UNCLOSE',
] as const;

export const PINNED_VENDOR_FILES = {
  'package.json': '6685590e6a2bd67e44f9ea980bcb64cd6dda673f3f005825cb27a156e8e69a20',
  'src/api/bot-server.ts': '43758f7d0a74fdfd2abe6fefb3d336851ff2bd1fa1784b35155464100be07cb3',
  'src/game/engine.ts': 'c668e00e9f09214920928168215cf3e918bc425c0dae92101206391962566d6d',
  'src/game/moves.ts': '8fae60f18f5de62dcb32badaab720a0dff194317865dceac463d09f96d8644fd',
  'src/game/roster.ts': 'a7236c106f0c20623d790aad28ddaa300b423a98a28196fa907269f4ba74dbcc',
  'src/game/stage-set.ts': '3a90026eb5d9c74c61a81625231b713498c4b30e71683c1172b6751c03949abd',
  'src/game/types.ts': 'ff01ca180d4614c36dce27a54090f8ef063384ad4885faae49e120ac158ff60e',
  'src/telemetry/recorder.ts': '545429d176653b33fa2fd097fc03e3112c4ef9629861886d4ffb3bd3f81ae861',
  'src/tools/omega-gym.ts': '6b65a048f585fc7011f9803e4b3eaa8df5dbec6a96a0bdc74c4eb8794cc3d2df',
} as const;
