#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const guidePath = path.join(root, 'docs', 'guides', 'tui.md');

const guide = fs.readFileSync(guidePath, 'utf8');
const requiredLines = [
  'cargo fmt --check --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml',
  'cargo check --locked --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml',
  'cargo test --locked --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml',
  'cargo clippy --locked --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml -- -D warnings'
];

for (const line of requiredLines) {
  if (!guide.includes(line)) {
    console.error(`tui local rust verification docs test failed: missing "${line}"`);
    process.exit(1);
  }
}

console.log('tui local rust verification docs test passed');
