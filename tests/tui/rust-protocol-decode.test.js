#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('serde_json::from_str::<Value>')) {
  console.error('rust protocol decode test failed: expected JSON decode path in TUI runtime');
  process.exit(1);
}
if (!source.includes('"proto": "poc.tui@1"')) {
  console.error('rust protocol decode test failed: expected supervisor request protocol marker');
  process.exit(1);
}

console.log('tui rust protocol decode test passed');
