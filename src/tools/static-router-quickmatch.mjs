#!/usr/bin/env node
// One-match Quick Match child for the frozen character-static Gym slice.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import {
  PINNED_ROSTER, RUNNER_SCHEMA as CONTROL_SCHEMA,
  assertStrictQueueEmpty, createBoundedTransportSession, createExclusiveLedger,
  validateOfficialResult, validatePinnedRoster, verifyVendorProvenance,
} from './codex-dgx-omega-quickmatch.mjs';
import {
  DEFAULT_POLICY_SEED, DURABLE_PROFILES, STATIC_ROUTER_HF_REVISION,
  STATIC_ROUTER_SOURCE_COMMIT, STATIC_ROUTER_WEIGHT_SHA256, createStaticGymPolicy,
  staticProfile,
} from '../policies/static-router-gym.mjs';

export const RUNNER_SCHEMA = 'sshfighter-agent-roster/mega-quickmatch/v2';
export const SOURCE_FILE = fileURLToPath(import.meta.url);
export const DEFAULT_HANDLE = 'MEGA_BOT';

export function parseArgs(argv) {
  const values = {};
  let armed = false, dryRun = false;
  const allowed = new Set([
    'identity', 'handle', 'expected-fingerprint', 'expected-opponent',
    'expected-opponent-character', 'out', 'host', 'window-ms', 'profile', 'seed',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (raw === '--armed') { armed = true; continue; }
    if (raw === '--dry-run') { dryRun = true; continue; }
    if (!raw.startsWith('--') || !allowed.has(raw.slice(2))) throw new Error(`unknown argument: ${raw}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${raw} requires a value`);
    values[raw.slice(2)] = value;
  }
  if (armed === dryRun) throw new Error('choose exactly one of --armed or --dry-run');
  const profile = staticProfile(values.profile ?? DURABLE_PROFILES[0].id);
  const windowMs = Number(values['window-ms'] ?? 45_000);
  const seed = Number(values.seed ?? DEFAULT_POLICY_SEED);
  if (!Number.isInteger(windowMs) || windowMs < 5_000 || windowMs > 120_000)
    throw new Error('--window-ms must be an integer from 5000 to 120000');
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  if (armed && (!values.identity || !values.handle || !values['expected-fingerprint'] || !values.out)) {
    throw new Error('--armed requires --identity, --handle, --expected-fingerprint, and --out');
  }
  if (values.handle && !/^[A-Z0-9_-]{3,12}$/.test(values.handle)) {
    throw new Error('--handle must be 3-12 uppercase letters, numbers, underscores, or hyphens');
  }
  if (values['expected-fingerprint'] && !/^SHA256:[A-Za-z0-9+/=]+$/.test(values['expected-fingerprint'])) {
    throw new Error('--expected-fingerprint must be an SHA256 SSH fingerprint');
  }
  if (Boolean(values['expected-opponent']) !== Boolean(values['expected-opponent-character'])) {
    throw new Error('--expected-opponent and --expected-opponent-character must be provided together');
  }
  if (values['expected-opponent-character']
      && !PINNED_ROSTER.includes(values['expected-opponent-character'])) {
    throw new Error('--expected-opponent-character must be in the pinned roster');
  }
  return {
    armed, dryRun, profile, identity: values.identity,
    handle: values.handle ?? DEFAULT_HANDLE,
    expectedFingerprint: values['expected-fingerprint'] ?? '',
    expectedOpponent: values['expected-opponent'],
    expectedOpponentCharacter: values['expected-opponent-character'],
    out: values.out, host: values.host ?? 'sshfighter.com', windowMs, seed,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function runnerProvenance() {
  const root = dirname(dirname(dirname(SOURCE_FILE)));
  const policyFile = resolve(root, 'src/policies/static-router-gym.mjs');
  const transportFile = resolve(root, 'src/tools/codex-dgx-omega-quickmatch.mjs');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain', '--',
    'src/tools/static-router-quickmatch.mjs', 'src/policies/static-router-gym.mjs',
    'src/tools/codex-dgx-omega-quickmatch.mjs',
  ], { cwd: root, encoding: 'utf8' }).trim();
  return {
    head,
    status: status || 'clean',
    runnerSha256: createHash('sha256').update(readFileSync(SOURCE_FILE)).digest('hex'),
    policyModuleSha256: createHash('sha256').update(readFileSync(policyFile)).digest('hex'),
    sharedTransportSha256: createHash('sha256').update(readFileSync(transportFile)).digest('hex'),
  };
}

export function validateOfficial(payload, mid, character, handle = DEFAULT_HANDLE, target = {}) {
  return validateOfficialResult(payload, {
    matchId: mid, handle, character,
    expectedOpponent: target.handle,
    expectedOpponentCharacter: target.character,
  });
}

export async function run(args) {
  const policy = createStaticGymPolicy(args.profile.id, args.seed);
  const vendor = verifyVendorProvenance();
  const provenance = runnerProvenance();
  const manifest = {
    schema: RUNNER_SCHEMA,
    agent: 'MEGA',
    expansion: 'Multi-Expert Gym Agent',
    sharedBoundedTransportSchema: CONTROL_SCHEMA,
    handle: args.handle,
    character: args.profile.character,
    profile: args.profile,
    policySeed: args.seed,
    staticRouterWeightSha256: STATIC_ROUTER_WEIGHT_SHA256,
    staticRouterHfRevision: STATIC_ROUTER_HF_REVISION,
    staticRouterSourceCommit: STATIC_ROUTER_SOURCE_COMMIT,
    vendor,
    provenance,
    exactRoster: [...PINNED_ROSTER],
    maxMatches: 1,
    queueWindowMs: args.windowMs,
    expectedOpponent: args.expectedOpponent ?? null,
    expectedOpponentCharacter: args.expectedOpponentCharacter ?? null,
    dryRun: args.dryRun,
  };
  if (args.dryRun) {
    console.log(JSON.stringify({ ready: true, networkAccess: false, socketOpened: false, manifest }, null, 2));
    return;
  }
  if (provenance.status !== 'clean') throw new Error(`runner sources are not committed and clean: ${provenance.status}`);
  accessSync(resolve(args.identity));
  const outputPath = resolve(args.out);
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite ${outputPath}`);
  const [health, live] = await Promise.all([
    fetchJson(`https://${args.host}/api/health`), fetchJson(`https://${args.host}/api/live`),
  ]);
  if (health.ok !== true || health.service !== 'ringside' || health.engine !== 'sf-6')
    throw new Error('runtime health profile gate failed');
  assertStrictQueueEmpty(live, 'public preflight');
  mkdirSync(dirname(outputPath), { recursive: true });
  const ledger = createExclusiveLedger(outputPath);
  const append = (kind, payload = {}) => ledger.append(kind, payload);
  append('session', { manifest, health, initialLive: live });
  const ssh = spawn('ssh', [
    '-T', '-i', resolve(args.identity), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', 'NumberOfPasswordPrompts=0', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    `${args.handle}@${args.host}`, 'play',
  ], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: ssh.stdout });
  const send = (message) => { if (!ssh.stdin.destroyed) ssh.stdin.write(`${JSON.stringify(message)}\n`); };
  let currentMid = '';
  const session = createBoundedTransportSession({
    windowMs: args.windowMs,
    character: args.profile.character,
    handle: args.handle,
    expectedFingerprint: args.expectedFingerprint,
    expectedOpponent: args.expectedOpponent,
    expectedOpponentCharacter: args.expectedOpponentCharacter,
    decide: policy.decide,
    reset: policy.reset,
    rngState: policy.rngState,
    requireAckBeforeNextInput: true,
  }, {
    child: ssh, send, append,
    schedule: (fn, ms) => setTimeout(fn, ms), cancel: (timer) => clearTimeout(timer),
    addSignal: (handler) => process.once('SIGINT', handler),
    removeSignal: (handler) => process.off('SIGINT', handler),
    assertQueueSafe: async () => {
      const latest = await fetchJson(`https://${args.host}/api/live`);
      append('queue_gate', { live: latest });
      return latest;
    },
    fetchOfficial: async (mid) => {
      currentMid = mid;
      for (let attempt = 1; attempt <= 12; attempt++) {
        try {
          return validateOfficial(
            await fetchJson(`https://${args.host}/api/matches/${encodeURIComponent(mid)}`),
            mid, args.profile.character, args.handle,
            { handle: args.expectedOpponent, character: args.expectedOpponentCharacter },
          );
        }
        catch (error) {
          if (attempt === 12) throw error;
          await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 250));
        }
      }
    },
  });
  lines.on('line', (raw) => { void session.acceptLine(raw); });
  try { await session.done; }
  finally { lines.close(); ledger.close(); }
  console.log(JSON.stringify({ ...session.controller.status(), mid: currentMid, log: outputPath }, null, 2));
}

export function transientQueueError(error) {
  return /public preflight must report queued as numeric integer zero; got [1-9][0-9]*/.test(String(error))
    || /bounded_queue_window_expired/.test(String(error));
}

const isMain = process.argv[1] && SOURCE_FILE === resolve(process.argv[1]);
if (isMain) {
  try { await run(parseArgs(process.argv.slice(2))); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = transientQueueError(error) ? 75 : 1;
  }
}
