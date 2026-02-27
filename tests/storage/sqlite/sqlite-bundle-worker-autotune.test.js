#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sqliteBuildRunnerInternals } from '../../../src/storage/sqlite/build/runner.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const {
  resolveSqliteBundleWorkerProfilePath,
  resolveBundleWorkerAutotune
} = sqliteBuildRunnerInternals;

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-worker-autotune');
const bundleDir = path.join(tempRoot, 'bundles');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const expectedProfilePath = path.join(tempRoot, 'sqlite', 'bundle-worker-autotune.json');
assert.equal(
  resolveSqliteBundleWorkerProfilePath(tempRoot),
  expectedProfilePath,
  'expected bundle worker profile path under repo cache sqlite dir'
);

const manifestFiles = {};
for (let i = 0; i < 48; i += 1) {
  const bundleName = `bundle-${i}.json`;
  manifestFiles[`src/file-${i}.js`] = { bundles: [bundleName] };
  await fs.writeFile(path.join(bundleDir, bundleName), 'x'.repeat(1024), 'utf8');
}

const codeTuned = resolveBundleWorkerAutotune({
  mode: 'code',
  manifestFiles,
  bundleDir,
  threadLimits: { fileConcurrency: 12 },
  envConfig: {},
  profile: { modes: {} }
});
assert.equal(codeTuned.reason, 'autotune', 'expected autotune mode without explicit override');
assert.ok(codeTuned.threads >= 1, 'expected positive autotuned worker count');
assert.ok(codeTuned.threads <= 12, 'expected autotuned workers to respect thread limits');

const recordsTuned = resolveBundleWorkerAutotune({
  mode: 'records',
  manifestFiles,
  bundleDir,
  threadLimits: { fileConcurrency: 12 },
  envConfig: {},
  profile: { modes: {} }
});
assert.ok(
  recordsTuned.threads <= codeTuned.threads,
  'expected records mode to use equal-or-lower bundle thread fanout'
);

const explicit = resolveBundleWorkerAutotune({
  mode: 'code',
  manifestFiles,
  bundleDir,
  threadLimits: { fileConcurrency: 8 },
  envConfig: { bundleThreads: 3 },
  profile: { modes: {} }
});
assert.equal(explicit.reason, 'explicit-env', 'expected explicit env override reason');
assert.equal(explicit.threads, 3, 'expected explicit bundle thread count to apply');

const lowCountManifest = {
  'src/a.js': { bundles: ['a.json'] },
  'src/b.js': { bundles: ['b.json'] }
};
await fs.writeFile(path.join(bundleDir, 'a.json'), 'x'.repeat(256), 'utf8');
await fs.writeFile(path.join(bundleDir, 'b.json'), 'x'.repeat(256), 'utf8');

const converged = resolveBundleWorkerAutotune({
  mode: 'code',
  manifestFiles: lowCountManifest,
  bundleDir,
  threadLimits: { fileConcurrency: 16 },
  envConfig: {},
  profile: { modes: { code: { threads: 10 } } }
});
assert.equal(
  converged.threads,
  9,
  'expected convergence guard to step previous thread count by at most one'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('sqlite bundle worker autotune test passed');
