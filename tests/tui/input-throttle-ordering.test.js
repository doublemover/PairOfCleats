#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('const INPUT_DEBOUNCE_MS')) {
  console.error('input throttle ordering test failed: missing debounce constant');
  process.exit(1);
}
if (!source.includes('const INPUT_DISPATCH_INTERVAL_MS')) {
  console.error('input throttle ordering test failed: missing dispatch throttle constant');
  process.exit(1);
}
if (!source.includes('input_queue: VecDeque<(u64, InputCommand)>')) {
  console.error('input throttle ordering test failed: missing sequenced input queue');
  process.exit(1);
}
if (!source.includes('model.input_queue.pop_front()')) {
  console.error('input throttle ordering test failed: missing deterministic FIFO dispatch');
  process.exit(1);
}

console.log('tui input throttle ordering test passed');
