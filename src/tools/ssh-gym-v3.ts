#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { SshGymV3 } from '../gym/ssh-gym-v3.js';

const gym = new SshGymV3();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (Buffer.byteLength(line) > 65536) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'line exceeds 65536 bytes' })}\n`);
    return;
  }
  try {
    const message = JSON.parse(line);
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('command must be an object');
    process.stdout.write(`${JSON.stringify(gym.handle(message))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  }
});
