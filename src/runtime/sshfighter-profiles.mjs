import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const SF6_ROSTER = Object.freeze([
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO',
  'KIRA', 'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON', 'UNCLOSE',
]);

const SF7_ROSTER = Object.freeze([
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO',
  'KIRA', 'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON',
  'MEGAWATTS', 'UNCLOSE',
]);

export const RUNTIME_PROFILE_FILES = Object.freeze([
  'src/game/moves.ts',
  'src/game/engine.ts',
  'src/game/types.ts',
  'src/game/roster.ts',
  'src/api/bot-server.ts',
  'src/cluster/messages.ts',
  'src/cluster/coordinator.ts',
  'src/version.ts',
]);

export const SSHFIGHTER_RUNTIME_PROFILES = Object.freeze([
  Object.freeze({
    id: 'sf6-ece8177-current17',
    engine: 'sf-6',
    commit: 'ece81777886d479f3e61ed74b0e05b20884ce386',
    dirty: false,
    build: 'sf-6@ece81777886d',
    api: null,
    botProtocol: null,
    roster: SF6_ROSTER,
    vendorPath: 'vendor/sshfighter-sf7',
    vendorCheckoutCommit: '26591bce698dad4516d59614feee67cc6d636572',
    implementationSha256: '61aa12185891690f3c49efe2db1fd4ac728ea021081afe7f38ae337271412e3f',
    attestation: 'public exact health build plus exact authenticated ordered roster',
  }),
  Object.freeze({
    id: 'sf7-26591bc-megawatts18',
    engine: 'sf-7',
    commit: '26591bce698dad4516d59614feee67cc6d636572',
    dirty: false,
    build: 'sf-7@26591bce698d',
    api: 1,
    botProtocol: 1,
    roster: SF7_ROSTER,
    vendorPath: 'vendor/sshfighter-sf7',
    vendorCheckoutCommit: '26591bce698dad4516d59614feee67cc6d636572',
    implementationSha256: 'c186fa4dbef6a9eba85ce984c96f138752885686347a3cd81d66a5ef2f93b6d9',
    attestation: 'public exact health build plus exact authenticated welcome/matchStart build and ordered roster',
  }),
]);

function hashProfileFiles(root, commit, files = RUNTIME_PROFILE_FILES) {
  const digest = createHash('sha256');
  for (const relative of files) {
    digest.update(relative).update('\0');
    try { digest.update(execFileSync('git', ['show', `${commit}:${relative}`], { cwd: root })); }
    catch { digest.update('[ABSENT]'); }
    digest.update('\0');
  }
  return digest.digest('hex');
}

export function verifyRuntimeProfileSource(profile) {
  const root = resolve(repoRoot, profile.vendorPath);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (commit !== profile.vendorCheckoutCommit) {
    throw new Error(`${profile.id} vendor commit mismatch: expected ${profile.vendorCheckoutCommit}, got ${commit}`);
  }
  const implementationSha256 = hashProfileFiles(root, profile.commit);
  if (implementationSha256 !== profile.implementationSha256) {
    throw new Error(`${profile.id} implementation hash mismatch: expected ${profile.implementationSha256}, got ${implementationSha256}`);
  }
  return { profileId: profile.id, vendorCheckoutCommit: commit, implementationSha256 };
}

function exactHealthMatch(health, profile) {
  return health?.ok === true
    && health?.service === 'ringside'
    && health?.engine === profile.engine
    && health?.commit === profile.commit
    && health?.dirty === profile.dirty
    && health?.build === profile.build;
}

export function selectRuntimeProfile(health) {
  const matches = SSHFIGHTER_RUNTIME_PROFILES.filter((profile) => exactHealthMatch(health, profile));
  if (matches.length !== 1) {
    throw new Error(`unsupported or ambiguous SSH Fighter runtime profile: ${JSON.stringify({
      engine: health?.engine, commit: health?.commit, dirty: health?.dirty, build: health?.build,
    })}`);
  }
  return matches[0];
}

export function validateRuntimeRoster(value, profile) {
  if (!Array.isArray(value) || value.length !== profile.roster.length
      || value.some((entry, index) => entry !== profile.roster[index])) {
    throw new Error(`runtime profile mismatch: expected ${profile.id} exact ordered ${profile.roster.length}-fighter roster`);
  }
  return [...profile.roster];
}

function validateBuildEnvelope(message, profile, source) {
  if (message?.engine !== profile.engine || message?.commit !== profile.commit
      || message?.dirty !== profile.dirty || message?.build !== profile.build
      || message?.protocol !== profile.botProtocol) {
    throw new Error(`${source} build does not match selected runtime profile ${profile.id}`);
  }
}

export function validateRuntimeWelcome(message, profile) {
  validateBuildEnvelope(message, profile, 'welcome');
  if (message?.channel !== 'bot-api' || message?.playerType !== 'bot') {
    throw new Error(`welcome identity type does not match selected runtime profile ${profile.id}`);
  }
}

export function validateRuntimeMatchStart(message, profile) {
  validateBuildEnvelope(message, profile, 'matchStart');
}
