#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const guidePath = path.join(root, 'docs', 'guides', 'tui.md');

const guide = fs.readFileSync(guidePath, 'utf8');
const toolchain = fs.readFileSync(path.join(root, 'crates', 'pairofcleats-tui', 'rust-toolchain.toml'), 'utf8')
  .match(/^channel = "([^"]+)"$/m)?.[1];
if (!/^\d+\.\d+\.\d+$/.test(toolchain || '')) throw new Error('Expected an exact canonical Rust toolchain');
const requiredLines = [
  `cargo +${toolchain} fmt --check --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml`,
  `cargo +${toolchain} check --locked --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml`,
  `cargo +${toolchain} test --locked --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml`,
  `cargo +${toolchain} clippy --locked --manifest-path .\\crates\\pairofcleats-tui\\Cargo.toml -- -D warnings`
];

for (const line of requiredLines) {
  if (!guide.includes(line)) {
    console.error(`tui local rust verification docs test failed: missing "${line}"`);
    process.exit(1);
  }
}

console.log('tui local rust verification docs test passed');
