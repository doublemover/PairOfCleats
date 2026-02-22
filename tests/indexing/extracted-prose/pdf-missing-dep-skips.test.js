#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildMinimalPdfBuffer } from '../../helpers/document-fixtures.js';
import {
  normalizeFixturePath,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture('phase17-pdf-missing-dep');
await fsPromises.writeFile(
  path.join(docsDir, 'sample.pdf'),
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

try {
  runExtractedProseBuild({ root, repoRoot, env });
} catch {
  console.error('pdf missing dep skip test failed: build_index failed');
  process.exit(1);
}

const { fileLists } = await readExtractedProseArtifacts(repoRoot);
if (!fileLists) {
  console.error('pdf missing dep skip test failed: missing .filelists.json');
  process.exit(1);
}
const skippedSample = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const skippedPdf = skippedSample.find(
  (entry) => normalizeFixturePath(entry?.file).endsWith('docs/sample.pdf')
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
