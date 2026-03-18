#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { repoRoot } from '../../helpers/root.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = repoRoot();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('build-entry-success', { root });
const repoDir = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildIndexPath = path.join(root, 'build_index.js');

try {
  await fsPromises.mkdir(repoDir, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(path.join(repoDir, 'alpha.js'), 'export const alpha = () => "alpha";\n');

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    syncProcess: false,
    testConfig: {
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: { enabled: false }
      }
    }
  });

  const result = spawnSync(
    process.execPath,
    [buildIndexPath, '--stub-embeddings', '--stage', 'stage2', '--mode', 'code', '--repo', repoDir],
    {
      cwd: repoDir,
      env,
      encoding: 'utf8',
      timeout: 30000
    }
  );

  assert.equal(result.status, 0, `expected build entry success exit 0, stderr=${result.stderr || ''}`);
  assert.doesNotMatch(
    `${result.stderr || ''}${result.stdout || ''}`,
    /Detected unsettled top-level await/,
    'expected successful build entry to avoid unsettled top-level await warning'
  );

  console.log('build entry success no-unsettled-warning test passed');
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}
