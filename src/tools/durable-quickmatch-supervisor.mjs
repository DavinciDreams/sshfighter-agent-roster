#!/usr/bin/env node
// MEGA sequential durable supervisor: each match runs in a fresh one-match child.
import { spawn } from 'node:child_process';
import { closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURABLE_PROFILES } from '../policies/static-router-gym.mjs';

export function parseArgs(argv) {
  const values = {};
  let dryRun = false;
  const allowed = new Set([
    'identity', 'handle', 'expected-fingerprint', 'out-dir', 'host',
    'cooldown-ms', 'idle-backoff-ms', 'max-matches', 'max-failures',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (raw === '--dry-run') { dryRun = true; continue; }
    if (!raw.startsWith('--') || !allowed.has(raw.slice(2))) throw new Error(`unknown argument: ${raw}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${raw} requires a value`);
    values[raw.slice(2)] = value;
  }
  if (!dryRun && (!values.identity || !values.handle || !values['expected-fingerprint'] || !values['out-dir'])) {
    throw new Error('live supervisor requires --identity, --handle, --expected-fingerprint, and --out-dir');
  }
  if (values.handle && !/^[A-Z0-9_-]{3,12}$/.test(values.handle)) {
    throw new Error('--handle must be 3-12 uppercase letters, numbers, underscores, or hyphens');
  }
  if (values['expected-fingerprint'] && !/^SHA256:[A-Za-z0-9+/=]+$/.test(values['expected-fingerprint'])) {
    throw new Error('--expected-fingerprint must be an SHA256 SSH fingerprint');
  }
  const numeric = (name, fallback, minimum, maximum) => {
    const value = Number(values[name] ?? fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}`);
    return value;
  };
  return {
    dryRun,
    identity: values.identity ? resolve(values.identity) : '',
    handle: values.handle ?? 'MEGA_BOT',
    expectedFingerprint: values['expected-fingerprint'] ?? '',
    outDir: values['out-dir'] ? resolve(values['out-dir']) : '',
    host: values.host ?? 'sshfighter.com',
    cooldownMs: numeric('cooldown-ms', 15_000, 5_000, 3_600_000),
    idleBackoffMs: numeric('idle-backoff-ms', 30_000, 5_000, 3_600_000),
    maxMatches: numeric('max-matches', 0, 0, 1_000_000),
    maxFailures: numeric('max-failures', 3, 1, 100),
  };
}

function ledgerName(profile, sequence, now = new Date()) {
  return `${now.toISOString().replaceAll(':', '').replaceAll('.', '-')}-${String(sequence).padStart(6, '0')}-${profile.id}.jsonl`;
}

export function acquireSupervisorLock(outDir) {
  const path = resolve(outDir, '.mega-supervisor.lock');
  const fd = openSync(path, 'wx', 0o600);
  let released = false;
  try {
    writeSync(fd, `${JSON.stringify({ schema: 'sshfighter-agent-roster/mega-lock/v1', pid: process.pid })}\n`);
    fsyncSync(fd);
    fchmodSync(fd, 0o600);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(path); } catch {}
    throw error;
  }
  return {
    path,
    release() {
      if (released) return;
      released = true;
      closeSync(fd);
      unlinkSync(path);
    },
  };
}

export function spawnOneMatch(options, profile, sequence, dependencies = {}) {
  const spawnChild = dependencies.spawnChild ?? spawn;
  const runner = fileURLToPath(new URL('./static-router-quickmatch.mjs', import.meta.url));
  const output = resolve(options.outDir, ledgerName(profile, sequence, dependencies.now?.() ?? new Date()));
  const args = [runner, '--armed', '--identity', options.identity,
    '--handle', options.handle, '--expected-fingerprint', options.expectedFingerprint, '--out', output,
    '--host', options.host, '--profile', profile.id];
  const child = spawnChild(process.execPath, args, { stdio: 'inherit' });
  return { child, output, args };
}

export async function runSupervisor(options, dependencies = {}) {
  if (options.dryRun) {
    return {
      ready: true, agent: 'MEGA', handle: options.handle,
      identityGateConfigured: Boolean(options.expectedFingerprint),
      networkAccess: false, socketOpened: false, profiles: DURABLE_PROFILES,
    };
  }
  mkdirSync(options.outDir, { recursive: true, mode: 0o700 });
  const lock = dependencies.acquireLock?.(options.outDir) ?? acquireSupervisorLock(options.outDir);
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const waitChild = dependencies.waitChild ?? ((child) => new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal }))));
  let stopped = false;
  let active = null;
  const stop = () => { stopped = true; active?.kill?.('SIGINT'); };
  dependencies.installSignals?.(stop);
  let completed = 0, sequence = 0, profileIndex = 0, consecutiveFailures = 0;
  try {
    while (!stopped && (options.maxMatches === 0 || completed < options.maxMatches)) {
      const profile = DURABLE_PROFILES[profileIndex];
      const launched = spawnOneMatch(options, profile, ++sequence, dependencies);
      active = launched.child;
      const result = await waitChild(active);
      active = null;
      if (stopped) break;
      if (result.code === 0) {
        completed++;
        consecutiveFailures = 0;
        profileIndex = (profileIndex + 1) % DURABLE_PROFILES.length;
        await sleep(options.cooldownMs);
        continue;
      }
      if (result.code === 75) {
        await sleep(options.idleBackoffMs);
        continue;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= options.maxFailures)
        throw new Error(`durable circuit breaker opened after ${consecutiveFailures} consecutive child failures`);
      await sleep(options.idleBackoffMs);
    }
    return { completed, attempts: sequence, stopped, nextProfile: DURABLE_PROFILES[profileIndex].id };
  } finally {
    lock.release();
  }
}

const SOURCE_FILE = fileURLToPath(import.meta.url);
if (process.argv[1] && SOURCE_FILE === resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runSupervisor(options, {
      installSignals(stop) { process.once('SIGINT', stop); process.once('SIGTERM', stop); },
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
