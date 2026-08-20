// Reviewed pins live outside the hashed implementation files so validation can
// include the complete runner source without a self-referential hash.
export const FROZEN_TARGET_COMMIT = '8b2438bc2c633c98e2e86923fc8f0eaeacda0340';
export const APPROVED_CROSS_COMMIT = 'ebb0495f0846211bcdbef20a42701295670df266';
export const APPROVED_CROSS_POLICY_SOURCE_HASH = '0ca16d112b292090e19d5606b47aa612a961862b6175fd5833c727690c80bc79';
// The runtime was extracted from the independently reviewed universal-runner
// head into the owner repository. Mechanics/protocol source is not copied: it
// is read from the exact pinned sshfighter submodule commit below.
export const RUNNER_SOURCE_BASE_COMMIT = '22839b24ec0d01777a9835c6272ccea0d92fcf31';
export const TARGET_DEPLOYMENT_PROFILE = 'sshfighter-3caedf-unclose-17';
export const TARGET_ENGINE_COMMIT = '3caedf3435c12996cf4d34fb5ac76c7cd7b75076';
export const RUNNER_IMPLEMENTATION_FILES = [
  'src/policies/xenon-matchup.ts',
  'src/policies/xenon-actuation.ts',
  'src/policies/xenon-legacy-runtime.ts',
  'src/policies/xenon-universal.ts',
  'src/tools/xenon-bounded-runner.ts',
  'src/fixtures/xenon-matchup-golden-trace.json',
  'vendor/sshfighter/src/game/moves.ts',
  'vendor/sshfighter/src/game/engine.ts',
  'vendor/sshfighter/src/game/types.ts',
  'vendor/sshfighter/src/api/bot-server.ts',
  'vendor/sshfighter/src/cluster/coordinator.ts',
  'vendor/sshfighter/src/cluster/messages.ts',
] as const;

// Updated only after independent review of all files above. Runtime validation
// recomputes the digest from disk and fails closed before health/network access.
export const EXPECTED_RUNNER_IMPLEMENTATION_HASH = '1f7d69009c16980ee36f4fb6bce6ccda033402d46c21a5dfdae42b1d935c630a';
