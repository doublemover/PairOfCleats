#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { buildMinimalPdfBuffer } from '../../helpers/document-fixtures.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-pdf-missing-dep');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'docs', 'sample.pdf'),
  buildMinimalPdfBuffer('missing dependency sample')
);

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
    PAIROFCLEATS_TEST_FORCE_PDF_MISSING: '1'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'build_index.js'),
    '--repo',
    repoRoot,
    '--mode',
    'extracted-prose',
    '--stub-embeddings'
  ],
  {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  }
);
if (buildResult.status !== 0) {
  console.error('pdf missing dep skip test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const currentBuild = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
const indexRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
if (!indexRoot) {
  console.error('pdf missing dep skip test failed: missing build root');
  process.exit(1);
}
const indexDir = getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot });
const fileListsPath = path.join(indexDir, '.filelists.json');
if (!fs.existsSync(fileListsPath)) {
  console.error('pdf missing dep skip test failed: missing .filelists.json');
  process.exit(1);
}
const fileLists = JSON.parse(await fsPromises.readFile(fileListsPath, 'utf8'));
const skippedSample = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const skippedPdf = skippedSample.find(
  (entry) => normalizePath(entry?.file).endsWith('docs/sample.pdf')
);
if (!skippedPdf) {
  console.error('pdf missing dep skip test failed: expected PDF skip entry');
  process.exit(1);
}
if (skippedPdf.reason !== 'missing_dependency') {
  console.error(`pdf missing dep skip test failed: expected missing_dependency, got ${skippedPdf.reason}`);
  process.exit(1);
}

console.log('pdf missing dependency skip test passed');
