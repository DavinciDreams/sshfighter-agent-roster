// Reviewed pins live outside the hashed implementation files so the runner
// source can be covered without creating a self-referential digest.
export const CURRENT_MAIN_BASE_COMMIT = '3caedf3435c12996cf4d34fb5ac76c7cd7b75076';
export const MECHANICS_REFERENCE_COMMIT = CURRENT_MAIN_BASE_COMMIT;
export const EXPECTED_RUNTIME_PROFILE = 'sf-6/current17-unclose';

export const CODEX_RUNNER_IMPLEMENTATION_FILES = [
  'src/tools/codex-dgx-bounded-opponent.ts',
  'src/bot/adaptive-codex-policy.ts',
  'vendor/sshfighter/src/game/moves.ts',
  'vendor/sshfighter/src/game/engine.ts',
  'vendor/sshfighter/src/game/types.ts',
  'vendor/sshfighter/src/api/bot-server.ts',
  'vendor/sshfighter/src/cluster/messages.ts',
  'vendor/sshfighter/src/cluster/coordinator.ts',
] as const;

// Updated only after review of every file above. The runner recomputes this
// digest from disk and fails closed before health, token, or SSH access.
export const EXPECTED_CODEX_RUNNER_IMPLEMENTATION_HASH = '28ef7bdf4ad0b5c8c7adb5449ca275822b9f7de5652fa0968e0a35b50960ae6f';
