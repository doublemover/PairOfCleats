#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildMinimalDocxBuffer } from '../../helpers/document-fixtures.js';
import {
  normalizeFixturePath,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture('phase17-docx-missing-dep');
await fsPromises.writeFile(
  path.join(docsDir, 'sample.docx'),
  buildMinimalDocxBuffer(['missing dependency sample'])
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
    PAIROFCLEATS_TEST_FORCE_DOCX_MISSING: '1'
  }
});

try {
  runExtractedProseBuild({ root, repoRoot, env });
} catch {
  console.error('docx missing dep skip test failed: build_index failed');
  process.exit(1);
}

const { fileLists } = await readExtractedProseArtifacts(repoRoot);
if (!fileLists) {
  console.error('docx missing dep skip test failed: missing .filelists.json');
  process.exit(1);
}
const skippedSample = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const skippedDocx = skippedSample.find(
  (entry) => normalizeFixturePath(entry?.file).endsWith('docs/sample.docx')
);
if (!skippedDocx) {
  console.error('docx missing dep skip test failed: expected DOCX skip entry');
  process.exit(1);
}
if (skippedDocx.reason !== 'missing_dependency') {
  console.error(`docx missing dep skip test failed: expected missing_dependency, got ${skippedDocx.reason}`);
  process.exit(1);
}

console.log('docx missing dependency skip test passed');
