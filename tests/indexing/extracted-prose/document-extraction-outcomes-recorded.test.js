#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildMinimalDocxBuffer } from '../../helpers/document-fixtures.js';
import {
  normalizeFixturePath,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-extraction-outcomes'
);
await fs.writeFile(path.join(docsDir, 'ok.pdf'), Buffer.from('phase17 outcomes pdf ok', 'utf8'));
await fs.writeFile(path.join(docsDir, 'skip.docx'), buildMinimalDocxBuffer(['phase17 outcomes docx skip']));

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
    PAIROFCLEATS_TEST_FORCE_DOCX_MISSING: '1'
  }
});

runExtractedProseBuild({ root, repoRoot, env });

const { extractionReport: report } = await readExtractedProseArtifacts(repoRoot);
assert.ok(report, 'expected extraction_report.json');
const files = Array.isArray(report?.files) ? report.files : [];
const okPdf = files.find((entry) => normalizeFixturePath(entry?.file).endsWith('docs/ok.pdf'));
const skippedDocx = files.find((entry) => normalizeFixturePath(entry?.file).endsWith('docs/skip.docx'));

assert.ok(okPdf, 'expected PDF report entry');
assert.ok(skippedDocx, 'expected DOCX report entry');
assert.equal(okPdf?.status, 'ok', 'expected PDF status=ok');
assert.equal(skippedDocx?.status, 'skipped', 'expected DOCX status=skipped');
assert.equal(skippedDocx?.reason, 'missing_dependency', 'expected DOCX missing dependency reason');

assert.equal(report?.counts?.total, 2, 'expected total count=2');
assert.equal(report?.counts?.ok, 1, 'expected ok count=1');
assert.equal(report?.counts?.skipped, 1, 'expected skipped count=1');
assert.equal(report?.counts?.byReason?.missing_dependency, 1, 'expected missing_dependency count=1');

console.log('document extraction outcomes recorded test passed');
