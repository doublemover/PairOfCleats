#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'phase17-document-chunk-id-no-collision');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, 'src', 'app.js'),
  [
    '// phase17 no-collision extracted prose comment',
    '// second extracted prose comment line',
    'export function phase17NoCollision(value) {',
    '  const note = "phase17 chunk id no collision";',
    '  return `${note}:${value}`;',
    '}'
  ].join('\n')
);
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), Buffer.from('phase17 no collision pdf', 'utf8'));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: { enabled: true }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'all', '--stub-embeddings'],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
assert.equal(buildResult.status, 0, 'expected build to succeed');

const userConfig = loadUserConfig(repoRoot);
const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
const indexRoot = buildInfo?.activeRoot || buildInfo?.buildRoot || null;
assert.ok(indexRoot, 'expected active build root');

const codeDir = getIndexDir(repoRoot, 'code', userConfig, { indexRoot });
const extractedDir = getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot });
const codeChunks = await loadChunkMeta(codeDir, { strict: false });
const extractedChunks = await loadChunkMeta(extractedDir, { strict: false });
const codeUids = new Set(codeChunks.map((chunk) => chunk?.chunkUid).filter((value) => typeof value === 'string' && value.length));
const extractedUids = new Set(
  extractedChunks.map((chunk) => chunk?.chunkUid).filter((value) => typeof value === 'string' && value.length)
);

assert.ok(codeUids.size > 0, 'expected code chunk UIDs');
assert.ok(extractedUids.size > 0, 'expected extracted-prose chunk UIDs');

const collisions = Array.from(extractedUids).filter((uid) => codeUids.has(uid));
assert.equal(collisions.length, 0, `expected no cross-mode chunk UID collisions, got ${collisions.slice(0, 5).join(', ')}`);

console.log('document chunk id no collision test passed');
