#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareTestCacheDir } from '../helpers/test-cache.js';

if (process.platform !== 'win32') {
  console.log('run-test timeout zero test skipped on non-Windows platform');
  process.exit(0);
}

const root = process.cwd();
const runTestScript = path.join(root, 'tools', 'run-test.ps1');
const testTimesDir = path.join(root, 'tools', 'test_times');
const trackedFiles = ['TEST_TIMES.md', 'SLOW_TESTS.md', 'SHORT_TESTS.md', 'TEST_ERRORS.md'];

const snapshots = new Map();
for (const fileName of trackedFiles) {
  const targetPath = path.join(testTimesDir, fileName);
  if (existsSync(targetPath)) {
    snapshots.set(fileName, await fs.readFile(targetPath, 'utf8'));
  } else {
    snapshots.set(fileName, null);
  }
}

const { dir: tempDir } = await prepareTestCacheDir('run-test-timeout-zero', { root });
const sleepyTestPath = path.join(tempDir, 'sleepy-test.js');
await fs.writeFile(
  sleepyTestPath,
  [
    '#!/usr/bin/env node',
    'await new Promise((resolve) => setTimeout(resolve, 1500));',
    "console.log('sleepy test completed');"
  ].join('\n'),
  'utf8'
);

try {
  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-File',
      runTestScript,
      '-TestPath',
      sleepyTestPath,
      '-TimeoutSeconds',
      '0'
    ],
    {
      cwd: root,
      encoding: 'utf8'
    }
  );

  if (result.error) throw result.error;
  assert.equal(result.status, 0, `expected run-test.ps1 timeout=0 run to succeed, stderr=${result.stderr || ''}`);
  assert.match(result.stdout || '', /Test completed in /, 'expected completion log');
  assert.doesNotMatch(
    result.stderr || '',
    /exceeded .* and was stopped/i,
    'timeout disabled run should not emit timeout warning'
  );
} finally {
  for (const fileName of trackedFiles) {
    const targetPath = path.join(testTimesDir, fileName);
    const snapshot = snapshots.get(fileName);
    if (typeof snapshot === 'string') {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, snapshot, 'utf8');
    } else {
      await fs.rm(targetPath, { force: true });
    }
  }
}

console.log('run-test timeout zero test passed');
