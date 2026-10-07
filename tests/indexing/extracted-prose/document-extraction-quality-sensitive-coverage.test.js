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
  'phase17-document-extraction-quality-sensitive-coverage'
);
await fs.writeFile(path.join(docsDir, 'ok.pdf'), Buffer.from('phase17 quality-sensitive pdf ok', 'utf8'));
await fs.writeFile(path.join(docsDir, 'skip.docx'), buildMinimalDocxBuffer(['phase17 quality-sensitive docx skip']));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: {
        enabled: true,
        fidelityMode: 'quality-sensitive'
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1',
    PAIROFCLEATS_TEST_FORCE_DOCX_MISSING: '1'
  }
});

runExtractedProseBuild({ root, repoRoot, env });

const { extraction, extractionReport: report } = await readExtractedProseArtifacts(repoRoot);
assert.ok(extraction, 'expected build_state extraction summary');
assert.ok(report, 'expected extraction report');

const reportFiles = Array.isArray(report?.files) ? report.files : [];
const skippedDocx = reportFiles.find((entry) => normalizeFixturePath(entry?.file).endsWith('docs/skip.docx'));
assert.ok(skippedDocx, 'expected skipped DOCX report entry');
assert.equal(report?.policy?.fidelityMode, 'quality-sensitive', 'expected quality-sensitive report policy');
assert.equal(report?.coverage?.qualitySensitiveFailures, 1, 'expected one quality-sensitive coverage failure');
assert.equal(skippedDocx?.fidelity?.policyViolation, true, 'expected skipped DOCX to violate quality-sensitive policy');

const buildStateFiles = Array.isArray(extraction?.files) ? extraction.files : [];
const buildStateSkippedDocx = buildStateFiles.find((entry) => normalizeFixturePath(entry?.file).endsWith('docs/skip.docx'));
assert.ok(buildStateSkippedDocx, 'expected skipped DOCX build_state entry');
assert.equal(extraction?.policy?.qualitySensitive, true, 'expected build_state qualitySensitive marker');
assert.equal(extraction?.coverage?.qualitySensitiveFailures, 1, 'expected build_state quality-sensitive failure count');
assert.equal(buildStateSkippedDocx?.fidelity?.policyViolation, true, 'expected build_state policy violation for skipped DOCX');

console.log('document extraction quality-sensitive coverage test passed');
