#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'testing', 'shared-module-performance.js');

const result = runNode(
  [toolPath, '--check', '--json'],
  'shared-module performance check',
  root,
  applyTestEnv(),
  { stdio: 'pipe', allowFailure: true }
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
  'shared.command-registry.query',
  'shared.runtime-capability-manifest',
  'shared.artifact-io',
  'shared.subprocess.runner',
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
