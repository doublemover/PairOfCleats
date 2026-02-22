#!/usr/bin/env node
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  findFixtureEntryBySuffix,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-checksums-counts'
);

const pdfPath = path.join(docsDir, 'sample.pdf');
const docxPath = path.join(docsDir, 'sample.docx');
const pdfBuffer = Buffer.from('stub pdf checksum payload', 'utf8');
const docxBuffer = Buffer.from('stub docx checksum payload', 'utf8');
await fsPromises.writeFile(pdfPath, pdfBuffer);
await fsPromises.writeFile(docxPath, docxBuffer);

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

try {
  runExtractedProseBuild({ root, repoRoot, env });
} catch {
  console.error('document checksum/count test failed: build_index failed');
  process.exit(1);
}

const { extraction } = await readExtractedProseArtifacts(repoRoot);
const files = Array.isArray(extraction?.files) ? extraction.files : [];
const pdfEntry = findFixtureEntryBySuffix(files, 'docs/sample.pdf');
const docxEntry = findFixtureEntryBySuffix(files, 'docs/sample.docx');
if (!pdfEntry || !docxEntry) {
  console.error('document checksum/count test failed: missing expected extraction file entries');
  process.exit(1);
}

if (pdfEntry.sourceBytesHash !== sha256(pdfBuffer)) {
  console.error('document checksum/count test failed: pdf sourceBytesHash mismatch');
  process.exit(1);
}
if (docxEntry.sourceBytesHash !== sha256(docxBuffer)) {
  console.error('document checksum/count test failed: docx sourceBytesHash mismatch');
  process.exit(1);
}

if ((pdfEntry?.unitCounts?.totalUnits || 0) < 1) {
  console.error('document checksum/count test failed: expected PDF unitCounts.totalUnits >= 1');
  process.exit(1);
}
if ((docxEntry?.unitCounts?.totalUnits || 0) < 1) {
  console.error('document checksum/count test failed: expected DOCX unitCounts.totalUnits >= 1');
  process.exit(1);
}

if ((extraction?.totals?.files || 0) < 2) {
  console.error('document checksum/count test failed: expected totals.files >= 2');
  process.exit(1);
}

console.log('document extraction checksums/counts test passed');
