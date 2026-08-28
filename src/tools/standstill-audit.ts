#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

import { auditManifest, auditStandstill, type AuditFrame } from '../gym/standstill-audit.js';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const input = arg('--input');
const output = arg('--output');
const side = arg('--side') ?? 'a';
if (!input || !output || !['a', 'b'].includes(side)) {
  throw new Error('usage: standstill-audit --input RUN.jsonl --output MANIFEST.json [--side a|b]');
}

const bytes = readFileSync(input);
const rows = bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const frames: AuditFrame[] = rows.map((row) => {
  const state = row.state?.profile === 'bot-protocol-v2' ? row.state[side] : row.state ?? row;
  return {
    state,
    requested: row[`requested${side.toUpperCase()}`] ?? row.requested,
    applied: row[`applied${side.toUpperCase()}`] ?? row.applied,
  };
});
const audit = auditStandstill(frames);
const manifest = auditManifest(audit, bytes, { path: input, side });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, ...audit.summary }));
