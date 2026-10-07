#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import semver from 'semver';

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
const toolchainVersion = toolchainBody.match(/^channel = "([^"]+)"$/m)?.[1];
const minimumRustVersion = cargoBody.match(/^rust-version = "([^"]+)"$/m)?.[1];
assert.ok(semver.valid(toolchainVersion), 'expected an exact Rust toolchain version');
assert.ok(minimumRustVersion, 'expected the crate to declare its Rust MSRV');
assert.equal(
  semver.coerce(minimumRustVersion)?.version,
  toolchainVersion,
  'the pinned Rust toolchain must exercise the declared MSRV'
);
assert.ok(semver.gte(toolchainVersion, '1.88.0'), 'ratatui 0.30.2 requires Rust 1.88 or later');

for (const name of ['ci.yml', 'nightly.yml', 'release.yml', 'codeql.yml']) {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8');
  const versions = [...workflow.matchAll(/^\s+toolchain:\s+([0-9]+\.[0-9]+\.[0-9]+)\s*$/gm)];
  assert.ok(versions.length > 0, `${name} must pin its Rust toolchain`);
  for (const [, version] of versions) {
    assert.equal(version, toolchainVersion, `${name} Rust toolchain must match the crate MSRV`);
  }
}

// Keep known unsound releases out of the entire checked-in dependency graph,
// including optional and platform-specific packages. Live RustSec auditing is
// still required to discover advisories added after this regression contract.
const advisoryRanges = {
  anyhow: { id: 'RUSTSEC-2026-0190', patched: '>=1.0.103' },
  lru: { id: 'RUSTSEC-2026-0253', patched: '>=0.18.2' },
  rand: { id: 'RUSTSEC-2026-0097', patched: '<0.7.0 || >=0.8.6 <0.9.0 || >=0.9.3 <0.10.0 || >=0.10.1' }
};
const lockBody = fs.readFileSync(lockfile, 'utf8');
for (const block of lockBody.split(/^\[\[package\]\]\s*$/m).slice(1)) {
  const name = block.match(/^name = "([^"]+)"$/m)?.[1];
  const version = block.match(/^version = "([^"]+)"$/m)?.[1];
  const advisory = advisoryRanges[name];
  if (advisory) {
    assert.ok(
      semver.satisfies(version, advisory.patched),
      `${name}@${version} is affected by ${advisory.id}`
    );
  }
}

console.log('tui toolchain pin/lockfile enforcement test passed');
