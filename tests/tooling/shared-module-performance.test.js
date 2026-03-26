#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'testing', 'shared-module-performance.js');

const result = spawnSync(
  process.execPath,
  [toolPath, '--check', '--json'],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_TESTING: '1' }
  }
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const payload = JSON.parse(result.stdout || '{}');
assert.equal(payload.schemaVersion, '1.0.0');
assert.ok(Array.isArray(payload.modules) && payload.modules.length > 0, 'expected module metrics');
assert.ok(Array.isArray(payload.commands) && payload.commands.length > 0, 'expected command metrics');
assert.ok(Array.isArray(payload.regressions), 'expected regression list');
assert.equal(payload.regressions.length, 0, 'expected current metrics to satisfy the baseline');

const moduleIds = new Set(payload.modules.map((entry) => entry.id));
for (const expectedId of [
  'shared.search-request',
  'shared.command-registry',
  'shared.runtime-capability-manifest',
  'shared.artifact-io',
  'shared.subprocess',
  'retrieval.cli'
]) {
  assert.equal(moduleIds.has(expectedId), true, `missing module metric for ${expectedId}`);
}

for (const entry of payload.modules) {
  assert.equal(Number.isInteger(entry.directLocalImportCount), true, 'expected direct import count');
  assert.equal(Number.isInteger(entry.transitiveLocalModuleCount), true, 'expected transitive module count');
  assert.equal(Number.isFinite(entry.importMs), true, 'expected numeric import timing');
}

for (const entry of payload.commands) {
  assert.equal(Number.isFinite(entry.wallMs), true, 'expected numeric command timing');
  assert.equal(entry.exitCode, 0, `expected successful command exit for ${entry.id}`);
}

console.log('shared module performance test passed');
