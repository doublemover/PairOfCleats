#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const crateRoot = path.join(root, 'crates', 'pairofcleats-tui');
const cargoToml = path.join(crateRoot, 'Cargo.toml');
const toolchainToml = path.join(crateRoot, 'rust-toolchain.toml');
const lockfile = path.join(crateRoot, 'Cargo.lock');

for (const file of [cargoToml, toolchainToml, lockfile]) {
  if (!fs.existsSync(file)) {
    console.error(`toolchain pin/lockfile test failed: missing ${path.relative(root, file)}`);
    process.exit(1);
  }
}

const cargoBody = fs.readFileSync(cargoToml, 'utf8');
if (!cargoBody.includes('ratatui = "=') || !cargoBody.includes('crossterm = "=')) {
  console.error('toolchain pin/lockfile test failed: expected pinned ratatui/crossterm versions');
  process.exit(1);
}

const toolchainBody = fs.readFileSync(toolchainToml, 'utf8');
if (!toolchainBody.includes('channel = "')) {
  console.error('toolchain pin/lockfile test failed: expected pinned rust toolchain channel');
  process.exit(1);
}

console.log('tui toolchain pin/lockfile enforcement test passed');
