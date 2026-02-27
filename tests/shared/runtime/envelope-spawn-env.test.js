#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

const root = repoRoot();
const wrapperPath = path.join(root, 'bin', 'pairofcleats.js');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

const buildEnv = (overrides) => {
  const env = { ...process.env, ...overrides };
  delete env.UV_THREADPOOL_SIZE;
  delete env.NODE_OPTIONS;
  delete env.PAIROFCLEATS_NODE_OPTIONS;
  return ensureTestingEnv(env);
};

const runDump = (env) => {
  const result = spawnSync(process.execPath, [
    wrapperPath,
    'index',
    '--config-dump',
    '--repo',
    fixtureRoot
  ], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
  assert.strictEqual(result.status, 0, `wrapper config dump exited with ${result.status}: ${result.stderr || ''}`);
  const output = String(result.stdout || '').trim();
  assert.ok(output, 'expected config dump output from wrapper');
  return JSON.parse(output);
};

const patched = runDump(buildEnv({
  PAIROFCLEATS_UV_THREADPOOL_SIZE: '7',
  PAIROFCLEATS_MAX_OLD_SPACE_MB: '2048'
}));

assert.strictEqual(
  patched.runtime.uvThreadpoolSize.effective.source,
  'external-env',
  'expected wrapper to apply UV_THREADPOOL_SIZE before spawning child'
);
assert.strictEqual(
  patched.runtime.maxOldSpaceMb.effective.source,
  'external-env',
  'expected wrapper to apply NODE_OPTIONS before spawning child'
);

const preserved = runDump({
  ...buildEnv({
    PAIROFCLEATS_UV_THREADPOOL_SIZE: '7',
    PAIROFCLEATS_MAX_OLD_SPACE_MB: '2048'
  }),
  NODE_OPTIONS: '--trace-warnings'
});

assert.strictEqual(
  preserved.runtime.nodeOptions.effective.source,
  'external-env',
  'expected wrapper to preserve NODE_OPTIONS when already set'
);
assert.ok(
  preserved.runtime.nodeOptions.effective.value?.includes('--trace-warnings'),
  'expected NODE_OPTIONS to preserve unrelated flags'
);
assert.strictEqual(
  preserved.runtime.maxOldSpaceMb.effective.value,
  null,
  'expected maxOldSpaceMb to remain unset when NODE_OPTIONS is externally defined'
);

console.log('runtime envelope spawn env test passed');
