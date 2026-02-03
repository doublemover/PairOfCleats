#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('poc-scm-noscm-buildid-');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

try {
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const filePath = path.join(repoRoot, 'alpha.js');
  await fsPromises.writeFile(filePath, 'export const alpha = 1;\n');

  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub',
    PAIROFCLEATS_THREADS: '1',
    PAIROFCLEATS_WORKER_POOL: 'auto'
  };
  const runBuild = async () => {
    const buildResult = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'build_index.js'),
        '--stub-embeddings',
        '--repo',
        repoRoot,
        '--mode',
        'code',
        '--scm-provider',
        'none'
      ],
      { cwd: repoRoot, env, stdio: 'inherit' }
    );
    if (buildResult.status !== 0) {
      console.error('no-scm buildId test failed: build_index failed');
      process.exit(buildResult.status ?? 1);
    }
    const userConfig = loadUserConfig(repoRoot);
    const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
    assert(buildInfo?.buildRoot, 'expected current build info');
    const buildState = JSON.parse(
      await fsPromises.readFile(path.join(buildInfo.buildRoot, 'build_state.json'), 'utf8')
    );
    return {
      buildId: String(buildState?.buildId || ''),
      cacheSignature: buildState?.signatures?.code?.cacheSignature || null,
      repo: buildState?.repo || null
    };
  };

  const first = await runBuild();
  const second = await runBuild();

  assert(first.buildId.includes('_noscm_'), 'expected buildId to include noscm marker');
  assert.equal(first.repo?.provider, 'none');
  assert.equal(first.repo?.head ?? null, null);
  assert.equal(first.repo?.commit ?? null, null);
  assert.equal(first.cacheSignature, second.cacheSignature, 'expected cacheSignature to be stable');
} finally {
  await rmDirRecursive(tempRoot);
}

console.log('no-scm buildId ok');
