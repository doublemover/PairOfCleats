#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildMinimalDocxBuffer, buildMinimalPdfBuffer } from '../../helpers/document-fixtures.js';
import {
  findFixtureEntryBySuffix,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-docs-skipped-when-unavailable'
);
await fs.writeFile(path.join(docsDir, 'sample.pdf'), buildMinimalPdfBuffer('phase17 missing pdf dep'));
await fs.writeFile(path.join(docsDir, 'sample.docx'), buildMinimalDocxBuffer(['phase17 missing docx dep']));

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
    PAIROFCLEATS_TEST_FORCE_PDF_MISSING: '1',
    PAIROFCLEATS_TEST_FORCE_DOCX_MISSING: '1'
  }
});

runExtractedProseBuild({ root, repoRoot, env });

const { fileLists } = await readExtractedProseArtifacts(repoRoot);
assert.ok(fileLists, 'expected .filelists.json');
const skippedSample = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];

const skippedPdf = findFixtureEntryBySuffix(skippedSample, 'docs/sample.pdf');
const skippedDocx = findFixtureEntryBySuffix(skippedSample, 'docs/sample.docx');
assert.ok(skippedPdf, 'expected skipped PDF entry');
assert.ok(skippedDocx, 'expected skipped DOCX entry');
assert.equal(skippedPdf?.reason, 'missing_dependency', 'expected PDF missing dependency reason');
assert.equal(skippedDocx?.reason, 'missing_dependency', 'expected DOCX missing dependency reason');

console.log('documents skipped when unavailable test passed');
