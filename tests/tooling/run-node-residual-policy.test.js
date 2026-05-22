#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const testsRoot = path.join(root, 'tests');

const allowedResiduals = new Map([
  ['tests/helpers/run-node.js', { count: 1, reason: 'the helper owns the direct Node spawn primitive' }],
  ['tests/perf/bench/run.test.js', { count: 2, reason: 'benchmark runner orchestration owns benchmark subprocess policy' }],
  ['tests/perf/bench/scenarios/matrix.test.js', { count: 1, reason: 'scenario driver intentionally exercises the benchmark runner process' }],
  ['tests/runner/all.js', { count: 1, reason: 'runner meta-orchestrator owns suite process execution' }],
  ['tests/runner/harness/contract-matrix.test.js', { count: 5, reason: 'runner harness contract tests assert child-runner process semantics' }],
  ['tests/runner/harness/timeout-kills-tree.test.js', { count: 1, reason: 'runner harness timeout/process-tree semantics' }],
  ['tests/runner/harness/timeout-pass-signal-classification.test.js', { count: 1, reason: 'runner harness timeout classification semantics' }],
  ['tests/runner/harness/watchdog-kills-tree.test.js', { count: 1, reason: 'runner harness watchdog process-tree semantics' }],
  ['tests/shared/subprocess/abort-kill-grace-unref.test.js', { count: 1, reason: 'subprocess abort semantics probe' }],
  ['tests/shared/subprocess/quoting.test.js', { count: 1, reason: 'subprocess argv quoting semantics probe' }],
  ['tests/shared/subprocess/timeout-bounded-reap-referenced.test.js', { count: 1, reason: 'subprocess timeout/reap semantics probe' }],
  ['tests/shared/subprocess/timeout-kill-grace-unref.test.js', { count: 1, reason: 'subprocess timeout/kill semantics probe' }],
  ['tests/shared/subprocess/tracked-leak-fails-process.test.js', { count: 1, reason: 'subprocess leak-detection process-failure semantics probe' }]
]);

const toRepoPath = (filePath) => path.relative(root, filePath).split(path.sep).join('/');

const walkJsFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
};

const directNodeSpawnPattern = /\bspawnSync\s*\(\s*(?:\r?\n\s*)?process\.execPath\b/g;
const actual = new Map();

for (const filePath of walkJsFiles(testsRoot)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const matches = source.match(directNodeSpawnPattern) || [];
  if (matches.length > 0) {
    actual.set(toRepoPath(filePath), matches.length);
  }
}

const unexpected = [];
for (const [relativePath, count] of actual) {
  const expected = allowedResiduals.get(relativePath);
  if (!expected) {
    unexpected.push(`${relativePath} (${count})`);
  }
}
assert.deepEqual(unexpected, [], 'unexpected direct Node spawn wrappers should use tests/helpers/run-node.js');

const mismatches = [];
for (const [relativePath, expected] of allowedResiduals) {
  const actualCount = actual.get(relativePath) || 0;
  if (actualCount !== expected.count) {
    mismatches.push(`${relativePath}: expected ${expected.count}, actual ${actualCount}; ${expected.reason}`);
  }
}
assert.deepEqual(mismatches, [], 'direct Node spawn residual policy drifted');

console.log(`run-node residual policy passed (${actual.size} allowlisted files)`);
