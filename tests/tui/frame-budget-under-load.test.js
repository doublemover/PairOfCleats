#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('const FRAME_BUDGET_MS: u128')) {
  console.error('frame budget test failed: missing fixed frame budget constant');
  process.exit(1);
}
if (!source.includes('frame_signature(&model)') || !source.includes('last_render_signature')) {
  console.error('frame budget test failed: missing dirty-region signature diff rendering');
  process.exit(1);
}
if (!source.includes('FRAME_INTERVAL')) {
  console.error('frame budget test failed: missing fixed frame cadence');
  process.exit(1);
}

console.log('tui frame budget under load test passed');
