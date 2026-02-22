#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  findFixtureEntryBySuffix,
  inspectExtractedProseState,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-extractor-version'
);
await fsPromises.writeFile(path.join(docsDir, 'sample.pdf'), 'stub pdf extraction text');

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

const state = inspectExtractedProseState(repoRoot);
const indexRoot = state.indexRoot;
if (!indexRoot) {
  console.error('document extractor version test failed: missing build root');
  process.exit(1);
}

const buildStatePath = state.buildStatePath;
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
const entry = findFixtureEntryBySuffix(extraction.files, 'docs/sample.pdf');
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
