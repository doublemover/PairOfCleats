#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findFixtureEntryBySuffix,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-docs-included-when-available'
);
await fs.writeFile(path.join(docsDir, 'sample.pdf'), Buffer.from('phase17 include pdf', 'utf8'));
await fs.writeFile(path.join(docsDir, 'sample.docx'), Buffer.from('phase17 include docx', 'utf8'));

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
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1',
    PAIROFCLEATS_TEST_STUB_DOCX_EXTRACT: '1'
  }
});

runExtractedProseBuild({ root, repoRoot, env });

const { extraction } = await readExtractedProseArtifacts(repoRoot);
assert.ok(extraction, 'expected document extraction summary in build_state');

const files = Array.isArray(extraction?.files) ? extraction.files : [];
const pdfEntry = findFixtureEntryBySuffix(files, 'docs/sample.pdf');
const docxEntry = findFixtureEntryBySuffix(files, 'docs/sample.docx');
assert.ok(pdfEntry, 'expected extracted PDF entry');
assert.ok(docxEntry, 'expected extracted DOCX entry');
assert.equal(pdfEntry?.sourceType, 'pdf', 'expected PDF sourceType');
assert.equal(docxEntry?.sourceType, 'docx', 'expected DOCX sourceType');

console.log('documents included when available test passed');
