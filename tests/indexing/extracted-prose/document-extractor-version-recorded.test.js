#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  findFixtureEntryBySuffix,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
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

try {
  runExtractedProseBuild({ root, repoRoot, env });
} catch {
  console.error('document extractor version test failed: build_index failed');
  process.exit(1);
}

const { extraction } = await readExtractedProseArtifacts(repoRoot);
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
