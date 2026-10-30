#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('Duration::from_millis(50)')) {
  console.error('tui rendering responsiveness test failed: missing fixed render cadence budget');
  process.exit(1);
}
if (!source.includes('const INPUT_POLL_INTERVAL: Duration = Duration::from_millis(20);')
  || !source.includes('event::poll(input_poll_wait(')
  || !source.includes('fn input_poll_wait(inbound_pending: usize, replay_pending: bool) -> Duration')) {
  console.error('tui rendering responsiveness test failed: missing bounded input poll interval');
  process.exit(1);
}

console.log('tui rendering responsiveness test passed');
