#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const result = spawnSync(process.execPath, [
  path.join(root, 'tools', 'tooling-install.js'),
  '--root', fixtureRoot,
  '--tools', 'clangd',
  '--dry-run',
  '--json'
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('tooling-install failed');
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-install did not return JSON');
  process.exit(1);
}

const results = payload.results || [];
const actions = payload.actions || [];

if (actions.some((entry) => entry && entry.id === 'clangd')) {
  console.error('Expected clangd to not be auto-installable in dry-run');
  process.exit(1);
}

const clangdResult = results.find((entry) => entry.id === 'clangd');
if (!clangdResult) {
  console.error('Expected clangd result to be reported in dry-run');
  process.exit(1);
}

if (!['manual', 'already-installed'].includes(clangdResult.status)) {
  console.error(`Expected clangd to be manual or already-installed in dry-run (got ${clangdResult.status || 'unknown'})`);
  process.exit(1);
}

console.log('tooling install test passed');
