#!/usr/bin/env node
// One-match Quick Match transport for the frozen omega-control-v1 policy.
// Live operation is impossible without explicit --armed and a zero-queue preflight.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

export const HANDLE = 'CODEX_DGX';
export const CHARACTER = 'OMEGA';
export const POLICY = 'omega-control-v1-seeded-capture';
export const POLICY_SEED = 0x4f4d4547;
export const POLICY_FUNCTION_SHA256 = 'ab9b903e9ba74b046b1439adccfedc33224c8ed247355335931f026018f86497';
export const EXPECTED_FINGERPRINT = 'SHA256:w5cpyiWy6jpCFRaLxln5ZOvrWy1x+QoeWC0PAR4La+A';
export const MIGRATED_FROM_UPSTREAM_PR_HEAD = 'aa72038b4aa2068ea9d295fcd2f8778f6d61e874';
export const VENDOR_SOURCE_COMMIT = '3caedf3435c12996cf4d34fb5ac76c7cd7b75076';
export const RUNNER_SCHEMA = 'sshfighter-agent-roster/omega-quickmatch/v1';
export const DEPLOYED_COMMIT_ATTESTED = false;
export const RUNTIME_PROFILE_EVIDENCE = 'ringside/sf-6 health plus exact authenticated ordered 17-fighter welcome roster';
export const PINNED_ROSTER = [
  'BYU', 'MEN', 'BLANKO', 'CHONG', 'GYLE', 'ZANG', 'DHAL', 'HONDO',
  'KIRA', 'MAKO', 'OMEGA', 'CODEX', 'FABLE', 'MNEME', 'AJAX', 'XENON', 'UNCLOSE',
];
export const CHILD_TERM_GRACE_MS = 250;
export const CHILD_KILL_GRACE_MS = 1_000;
export const CHILD_HARD_DEADLINE_MS = 1_500;
export const GLOBAL_SESSION_TIMEOUT_MS = 10 * 60_000;
export const VENDOR_IMPLEMENTATION_FILES = [
  'src/game/moves.ts',
  'src/game/engine.ts',
  'src/game/types.ts',
  'src/api/bot-server.ts',
  'src/cluster/messages.ts',
  'src/cluster/coordinator.ts',
];
export const EXPECTED_VENDOR_IMPLEMENTATION_SHA256 = '9889175948fc0cf1d07b6847d49f55f9cce56cc08a10cc54c75fee1c3b78e4c7';

const agentRepoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const vendorRoot = resolve(agentRepoRoot, 'vendor/sshfighter');

function hashFiles(root, files) {
  const digest = createHash('sha256');
  for (const relative of files) {
    digest.update(relative).update('\0');
    digest.update(readFileSync(resolve(root, relative))).update('\0');
  }
  return digest.digest('hex');
}

export function computeVendorImplementationHash() {
  return hashFiles(vendorRoot, VENDOR_IMPLEMENTATION_FILES);
}

export function computeRunnerSourceHash() {
  return createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
}

export function assertStrictQueueEmpty(payload, source = 'queue telemetry') {
  const queued = payload?.queued;
  if (typeof queued !== 'number' || !Number.isInteger(queued) || queued !== 0) {
    throw new Error(`${source} must report queued as numeric integer zero; got ${String(queued)}`);
  }
  return payload;
}

export function validatePinnedRoster(value) {
  if (!Array.isArray(value) || value.length !== PINNED_ROSTER.length
      || value.some((entry, index) => entry !== PINNED_ROSTER[index])) {
    throw new Error(`runtime profile mismatch: expected exact ordered ${PINNED_ROSTER.length}-fighter roster`);
  }
  return [...PINNED_ROSTER];
}

function secretField(key) {
  const normalized = key.toLowerCase();
  return normalized === 'fp' || normalized.endsWith('_fp') || normalized.includes('fingerprint')
    || normalized.includes('token') || normalized.includes('identity')
    || normalized === 'key' || normalized.endsWith('key') || normalized.startsWith('key_');
}

export function redactLedgerValue(value, key = '') {
  if (secretField(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((entry) => redactLedgerValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
      nestedKey, redactLedgerValue(nestedValue, nestedKey),
    ]));
  }
  if (typeof value === 'string') {
    return value
      .replace(/SHA256:[A-Za-z0-9+/=]+/g, '[REDACTED]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]');
  }
  return value;
}

export function createExclusiveLedger(outputPath, dependencies = {}) {
  const open = dependencies.open ?? openSync;
  const write = dependencies.write ?? writeSync;
  const sync = dependencies.sync ?? fsyncSync;
  const closeFd = dependencies.close ?? closeSync;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const fd = open(outputPath, 'wx', 0o600);
  let seq = 0;
  let closed = false;
  return {
    append(kind, payload = {}) {
      if (closed) return;
      const safe = redactLedgerValue(payload);
      write(fd, `${JSON.stringify({ seq: seq++, at: now(), kind, ...safe })}\n`);
    },
    close() {
      if (closed) return;
      sync(fd);
      closeFd(fd);
      closed = true;
    },
  };
}

export function verifyVendorProvenance(
  actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vendorRoot, encoding: 'utf8' }).trim(),
  actualHash = computeVendorImplementationHash(),
) {
  if (actualCommit !== VENDOR_SOURCE_COMMIT) {
    throw new Error(`vendor/sshfighter commit mismatch: expected ${VENDOR_SOURCE_COMMIT}, got ${actualCommit}`);
  }
  if (actualHash !== EXPECTED_VENDOR_IMPLEMENTATION_SHA256) {
    throw new Error(`vendor implementation hash mismatch: expected ${EXPECTED_VENDOR_IMPLEMENTATION_SHA256}, got ${actualHash}`);
  }
  return { vendorSourceCommit: actualCommit, vendorImplementationSha256: actualHash };
}

export function agentRepoProvenance() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agentRepoRoot, encoding: 'utf8' }).trim();
  const runnerStatus = execFileSync('git', [
    'status', '--porcelain', '--',
    'src/tools/codex-dgx-omega-quickmatch.mjs',
    'src/codex-dgx-omega-quickmatch-test.mjs',
  ], { cwd: agentRepoRoot, encoding: 'utf8' }).trim();
  return {
    agentRepoHeadCommit: head,
    agentRepoRunnerStatus: runnerStatus || 'clean',
    runnerSourceSha256: computeRunnerSourceHash(),
    migratedFromUpstreamPrHead: MIGRATED_FROM_UPSTREAM_PR_HEAD,
  };
}

export function parseArgs(argv) {
  const args = { host: 'sshfighter.com', windowMs: 45_000, armed: false, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (name === '--armed') { args.armed = true; continue; }
    if (name === '--dry-run') { args.dryRun = true; continue; }
    if (!['--identity', '--out', '--host', '--window-ms'].includes(name)) throw new Error(`unknown argument: ${name}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (name === '--window-ms') args.windowMs = Number(value);
    else args[name.slice(2)] = value;
  }
  if (args.armed === args.dryRun) throw new Error('choose exactly one of --armed or --dry-run');
  if (!Number.isInteger(args.windowMs) || args.windowMs < 5_000 || args.windowMs > 120_000) {
    throw new Error('--window-ms must be an integer from 5000 to 120000');
  }
  if (args.armed && (!args.identity || !args.out)) throw new Error('--armed requires --identity and --out');
  return args;
}

let rngState = POLICY_SEED >>> 0;
export function resetRng() {
  rngState = POLICY_SEED >>> 0;
}
function random() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let value = rngState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

// Byte-preserved decision logic from PR #28 / c07eb20. Transport safety and
// matchmaking are outside this function and do not change the policy.
export function decide(state) {
  const { you, opp, phase } = state;
  const action = { t: 'input', moveX: 0, motion: 'N' };
  if (phase !== 'fight' || !you || !opp) return { action, reason: 'inactive' };

  const dx = opp.x - you.x;
  const dist = Math.abs(dx);
  const towards = Math.sign(dx) || you.facing;
  const facing = you.facing;
  const oppAir = opp.y > 8;
  const oppAttacking = opp.attack && opp.attack !== 'none';
  const forward = facing === 1 ? 'R' : 'L';
  const back = facing === 1 ? 'L' : 'R';
  const backForward = `${back}${forward}`;
  const downForward = `D${forward}`;
  const downBack = `D${back}`;
  let reason;

  if (dist < 38) {
    if (oppAttacking && random() < 0.62) {
      action.moveX = -towards;
      reason = 'close_guard';
    } else if (random() < 0.22) {
      action.motion = backForward; action.kick = true;
      reason = 'close_null_step';
    } else if (random() < 0.30) {
      action.throw = true;
      reason = 'close_throw';
    } else if (random() < 0.55) {
      action.kick = true;
      reason = 'close_kick';
    } else {
      action.punch = true;
      reason = 'close_punch';
    }
  } else if (dist < 105) {
    if (!oppAir && random() < 0.28) {
      action.motion = downBack; action.punch = true;
      reason = 'mid_entropy_well';
    } else if (oppAttacking && random() < 0.18) {
      action.motion = backForward; action.kick = true;
      reason = 'mid_null_step';
    } else {
      action.moveX = towards;
      reason = 'mid_advance';
    }
  } else if (!oppAir && random() < 0.46) {
    action.motion = downForward; action.punch = true;
    reason = 'far_final_testimony';
  } else {
    action.moveX = towards;
    if (random() < 0.025) {
      action.jump = true;
      reason = 'far_jump_advance';
    } else {
      reason = 'far_advance';
    }
  }
  return { action, reason };
}

export function deterministicFixture() {
  const fixture = {
    t: 'state', phase: 'fight', projectiles: [],
    you: { x: 80, y: 0, facing: 1, hp: 100, attack: 'none' },
    opp: { x: 140, y: 0, facing: -1, hp: 100, attack: 'kick' },
  };
  resetRng();
  return Array.from({ length: 8 }, () => {
    const rngBefore = rngState;
    const value = decide(fixture);
    return { rngBefore, rngAfter: rngState, ...value };
  });
}

export function createOneMatchController(options, io) {
  let matchId = '';
  let stopping = false;
  let stopCause = '';
  let ending = false;
  let matched = false;
  let queueTimer = null;
  let roster = [];
  const send = (message, cause) => { io.append('outbound', { cause, message }); io.send(message); };
  const stop = (cause) => {
    if (stopping) return;
    stopping = true;
    stopCause = cause;
    if (queueTimer !== null) io.cancel(queueTimer);
    send({ t: 'leave' }, cause);
    io.onStop?.(cause);
  };

  async function handle(message) {
    io.append('inbound', { message });
    if (message.t === 'welcome') {
      if (message.name !== HANDLE || message.fp !== EXPECTED_FINGERPRINT) {
        throw new Error(`identity mismatch: ${String(message.name)} / ${String(message.fp)}`);
      }
      io.append('identity_gate', { handle: message.name, fingerprint: message.fp });
      roster = validatePinnedRoster(message.roster);
      const cursor = roster.indexOf(CHARACTER);
      io.append('roster_gate', { cursor, rosterCount: roster.length });
      assertStrictQueueEmpty(await io.assertQueueSafe(), 'authenticated welcome queue gate');
      if (stopping) return;
      queueTimer = io.schedule(() => {
        io.append('queue_window_expired', { windowMs: options.windowMs });
        stop('bounded_queue_window_expired');
      }, options.windowMs);
      send({ t: 'queue', char: CHARACTER }, 'welcome_zero_queue_preflight');
    } else if (message.t === 'queued') {
      if (message.char !== CHARACTER) throw new Error(`queued wrong character: ${message.char}`);
    } else if (message.t === 'matchStart') {
      if (matched) throw new Error('second matchStart rejected');
      matched = true;
      if (queueTimer !== null) io.cancel(queueTimer);
      const ownCharacter = roster[Number(message.yourCursor)] ?? 'UNKNOWN';
      if (ownCharacter !== CHARACTER) throw new Error(`matchStart character mismatch: ${ownCharacter}`);
      matchId = String(message.mid ?? '');
      if (!matchId) throw new Error('matchStart missing match id');
      resetRng();
      io.append('match_start', {
        matchId, role: message.role, stage: message.stage, ownCharacter,
        opponent: message.oppName, opponentCharacter: roster[Number(message.oppCursor)] ?? 'UNKNOWN',
      });
    } else if (message.t === 'state' && matched && !stopping && !ending) {
      const rngBefore = rngState;
      const result = decide(message);
      io.append('decision', {
        matchId, frame: message.frame, ack: message.ack ?? null,
        rngBefore, rngAfter: rngState, reason: result.reason, action: result.action,
      });
      send(result.action, 'state_decision');
    } else if (message.t === 'matchEnd' && matched && !stopping && !ending) {
      ending = true;
      const official = await io.fetchOfficial(matchId);
      if (stopping) return;
      io.append('match_boundary', { matchId, clientResult: message.result ?? null, official });
      stop('one_match_complete');
    } else if (message.t === 'left') {
      io.finish({ matched, matchId, reason: stopCause || (matched ? 'one_match_complete' : 'server_left') });
    } else if (message.t === 'error') {
      throw new Error(`server error: ${message.msg}`);
    }
  }
  return {
    handle,
    stop,
    dispose: () => { if (queueTimer !== null) io.cancel(queueTimer); },
    status: () => ({ matchId, stopping, stopCause, ending, matched }),
  };
}

export function createBoundedChildLifecycle(child, options = {}) {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  const append = options.append ?? (() => {});
  const termMs = options.termMs ?? CHILD_TERM_GRACE_MS;
  const killMs = options.killMs ?? CHILD_KILL_GRACE_MS;
  const hardMs = options.hardMs ?? CHILD_HARD_DEADLINE_MS;
  let closing = false;
  let settled = false;
  let outcomeError = null;
  const timers = [];
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolvePromise, rejectPromise) => {
    resolveDone = resolvePromise;
    rejectDone = rejectPromise;
  });
  const clearTimers = () => { for (const timer of timers) cancel(timer); };
  const settle = (error = outcomeError) => {
    if (settled) return;
    settled = true;
    clearTimers();
    if (error) rejectDone(error); else resolveDone();
  };
  const onExit = (code, signal) => {
    append('transport_exit', { code, signal, expected: closing });
    settle(closing ? outcomeError : new Error(`ssh exited before bounded completion: ${String(code)} / ${String(signal)}`));
  };
  const onError = (error) => {
    append('transport_error', { error: String(error), expected: closing });
    settle(closing && !outcomeError ? null : (outcomeError ?? error));
  };
  child.once('exit', onExit);
  child.once('error', onError);

  const close = (cause, error = null) => {
    if (closing || settled) return;
    closing = true;
    outcomeError = error;
    append('transport_close', { cause, success: !error });
    if (!child.stdin?.destroyed) child.stdin?.end?.();
    if (settled) return;
    timers.push(schedule(() => {
      append('transport_signal', { signal: 'SIGTERM' });
      child.kill?.('SIGTERM');
    }, termMs));
    timers.push(schedule(() => {
      append('transport_signal', { signal: 'SIGKILL' });
      child.kill?.('SIGKILL');
    }, killMs));
    timers.push(schedule(() => {
      append('transport_hard_deadline', { hardMs });
      settle();
    }, hardMs));
  };
  return { close, done, status: () => ({ closing, settled }) };
}

export function createBoundedTransportSession(options, io) {
  const schedule = io.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = io.cancel ?? ((timer) => clearTimeout(timer));
  const lifecycle = createBoundedChildLifecycle(io.child, {
    schedule, cancel, append: io.append,
    termMs: options.termMs, killMs: options.killMs, hardMs: options.hardMs,
  });
  let completed = false;
  let controller;
  const controllerIo = {
    send: io.send,
    append: io.append,
    schedule,
    cancel,
    assertQueueSafe: io.assertQueueSafe,
    fetchOfficial: io.fetchOfficial,
    onStop: (cause) => lifecycle.close(
      cause,
      cause === 'one_match_complete' ? null : new Error(`bounded session stopped: ${cause}`),
    ),
    finish: (summary) => {
      if (completed) return;
      completed = true;
      io.append('complete', summary);
      lifecycle.close('server_left', summary.matched && summary.reason === 'one_match_complete'
        ? null : new Error(`server left before bounded match completion: ${summary.reason}`));
    },
  };
  controller = createOneMatchController({ windowMs: options.windowMs }, controllerIo);
  const globalTimer = schedule(() => controller.stop('global_timeout'),
    options.globalTimeoutMs ?? GLOBAL_SESSION_TIMEOUT_MS);
  const signalHandler = () => controller.stop('operator_sigint');
  io.addSignal?.(signalHandler);

  const dispatch = async (message) => {
    try {
      await controller.handle(message);
    } catch (error) {
      io.append('fatal', { error: String(error) });
      controller.stop('fatal');
    }
  };
  const acceptLine = (raw) => {
    const line = String(raw).trim();
    if (!line.startsWith('{')) return Promise.resolve();
    try { return dispatch(JSON.parse(line)); }
    catch (error) { return dispatch({ t: 'error', msg: `invalid JSON: ${String(error)}` }); }
  };
  const done = lifecycle.done.finally(() => {
    cancel(globalTimer);
    controller.dispose();
    io.removeSignal?.(signalHandler);
  });
  return { controller, dispatch, acceptLine, done, lifecycle };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export async function run(args) {
  const first = deterministicFixture();
  const second = deterministicFixture();
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('policy determinism check failed');
  const policyFunctionSha256 = createHash('sha256').update(decide.toString()).digest('hex');
  if (policyFunctionSha256 !== POLICY_FUNCTION_SHA256) throw new Error(`frozen policy hash mismatch: ${policyFunctionSha256}`);
  const vendor = verifyVendorProvenance();
  const agentRepo = agentRepoProvenance();
  if (args.dryRun) {
    console.log(JSON.stringify({
      ready: true, armed: false, schema: RUNNER_SCHEMA, policy: POLICY, policySeed: POLICY_SEED,
      policyFunctionSha256, vendor, agentRepo,
      deployedCommitAttested: DEPLOYED_COMMIT_ATTESTED,
      runtimeProfileEvidence: RUNTIME_PROFILE_EVIDENCE,
      sample: first,
    }, null, 2));
    return;
  }

  if (agentRepo.agentRepoRunnerStatus !== 'clean') {
    throw new Error(`agent runner files are not committed and clean: ${agentRepo.agentRepoRunnerStatus}`);
  }
  accessSync(resolve(args.identity));
  const outputPath = resolve(args.out);
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite ${outputPath}`);
  const [health, live] = await Promise.all([
    fetchJson(`https://${args.host}/api/health`), fetchJson(`https://${args.host}/api/live`),
  ]);
  if (health.engine !== 'sf-6') throw new Error('runtime engine profile gate failed');
  assertStrictQueueEmpty(live, 'public preflight');

  mkdirSync(dirname(outputPath), { recursive: true });
  const ledger = createExclusiveLedger(outputPath);
  const append = (kind, payload = {}) => ledger.append(kind, payload);
  append('session', {
    schema: RUNNER_SCHEMA, armed: true, handle: HANDLE, character: CHARACTER,
    expectedFingerprint: EXPECTED_FINGERPRINT, policy: POLICY, policySeed: POLICY_SEED,
    policyFunctionSha256, vendor, agentRepo,
    deployedCommitAttested: DEPLOYED_COMMIT_ATTESTED,
    runtimeProfileEvidence: RUNTIME_PROFILE_EVIDENCE,
    health, initialLive: live,
    queueWindowMs: args.windowMs, matchLimit: 1,
  });

  const ssh = spawn('ssh', ['-T', '-i', resolve(args.identity), '-o', 'IdentitiesOnly=yes', `${HANDLE}@${args.host}`, 'play'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: ssh.stdout });
  const send = (message) => { if (!ssh.stdin.destroyed) ssh.stdin.write(`${JSON.stringify(message)}\n`); };
  const session = createBoundedTransportSession({ windowMs: args.windowMs }, {
    child: ssh, send, append,
    schedule: (fn, ms) => setTimeout(fn, ms), cancel: (timer) => clearTimeout(timer),
    addSignal: (handler) => process.once('SIGINT', handler),
    removeSignal: (handler) => process.off('SIGINT', handler),
    assertQueueSafe: async () => {
      const latest = await fetchJson(`https://${args.host}/api/live`);
      append('queue_gate', { live: latest });
      return latest;
    },
    fetchOfficial: async (matchId) => {
      for (let attempt = 1; attempt <= 12; attempt++) {
        try { return await fetchJson(`https://${args.host}/api/matches/${encodeURIComponent(matchId)}`); }
        catch (error) { if (attempt === 12) return { unavailable: true, error: String(error) }; await new Promise((ok) => setTimeout(ok, attempt * 250)); }
      }
    },
  });
  lines.on('line', (raw) => { void session.acceptLine(raw); });
  try { await session.done; }
  finally { lines.close(); ledger.close(); }
  console.log(JSON.stringify({
    ...session.controller.status(), log: outputPath,
    sha256: createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
  }, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try { await run(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
