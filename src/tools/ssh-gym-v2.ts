#!/usr/bin/env node
/** Bounded newline-JSON CLI for the agent-owned offline SSH Gym v2. */
import { stdin, stdout } from 'node:process';

import { assertSshGymProvenance, SshGymV2, type GymCommand } from '../gym/ssh-gym-v2.js';

const MAX_LINE_BYTES = 64 * 1024;
assertSshGymProvenance();
const gym = new SshGymV2();
let carry = Buffer.alloc(0);
let droppingOversizedLine = false;

function write(value: object): void { stdout.write(`${JSON.stringify(value)}\n`); }

function handleLine(line: string): void {
  if (!line.trim()) return;
  try {
    const parsed = JSON.parse(line) as GymCommand;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('command must be a JSON object');
    }
    write(gym.handle(parsed));
  } catch (error) {
    write({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

stdin.on('data', (value: Buffer | string) => {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let offset = 0;
  while (offset < chunk.length) {
    const newline = chunk.indexOf(0x0a, offset);
    if (newline < 0) {
      if (!droppingOversizedLine) {
        carry = Buffer.concat([carry, chunk.subarray(offset)]);
        if (carry.length > MAX_LINE_BYTES) {
          write({ ok: false, error: `command exceeds ${MAX_LINE_BYTES} bytes` });
          carry = Buffer.alloc(0);
          droppingOversizedLine = true;
        }
      }
      return;
    }
    if (!droppingOversizedLine) {
      carry = Buffer.concat([carry, chunk.subarray(offset, newline)]);
      if (carry.length > MAX_LINE_BYTES) {
        write({ ok: false, error: `command exceeds ${MAX_LINE_BYTES} bytes` });
      } else {
        handleLine(carry.toString('utf8').replace(/\r$/, ''));
      }
    }
    carry = Buffer.alloc(0);
    droppingOversizedLine = false;
    offset = newline + 1;
  }
});

stdin.on('end', () => {
  if (!droppingOversizedLine && carry.length) handleLine(carry.toString('utf8').replace(/\r$/, ''));
});
