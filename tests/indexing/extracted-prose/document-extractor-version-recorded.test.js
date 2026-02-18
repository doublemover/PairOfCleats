#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-document-extractor-version');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), 'stub pdf extraction text');

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
  console.error('document extractor version test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const currentBuild = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
const indexRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
if (!indexRoot) {
  console.error('document extractor version test failed: missing build root');
  process.exit(1);
}

const buildStatePath = path.join(indexRoot, 'build_state.json');
if (!fs.existsSync(buildStatePath)) {
  console.error('document extractor version test failed: missing build_state.json');
  process.exit(1);
}
const buildState = JSON.parse(await fsPromises.readFile(buildStatePath, 'utf8'));
const extraction = buildState?.documentExtraction?.['extracted-prose'];
if (!extraction) {
  console.error('document extractor version test failed: missing build_state.documentExtraction.extracted-prose');
  process.exit(1);
}
const entry = Array.isArray(extraction.files)
  ? extraction.files.find((item) => normalizePath(item?.file).endsWith('docs/sample.pdf'))
  : null;
if (!entry) {
  console.error('document extractor version test failed: missing extraction file entry for sample.pdf');
  process.exit(1);
}
if (!entry.extractor || entry.extractor.version !== 'test') {
  console.error('document extractor version test failed: expected extractor.version=test');
  process.exit(1);
}
if (entry.extractor.name !== 'pdf-test-stub') {
  console.error(`document extractor version test failed: unexpected extractor name ${entry.extractor.name}`);
  process.exit(1);
}

console.log('document extractor version recorded test passed');
