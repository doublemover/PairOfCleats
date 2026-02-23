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

const findFileByName = async (root, targetName) => {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (entry.isFile() && entry.name === targetName) {
        return abs;
      }
    }
  }
  return null;
};

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-extraction-cache-hit-reason'
);
const pdfPath = path.join(docsDir, 'sample.pdf');
const pdfBytes = Buffer.from('document extraction cache hit fixture', 'utf8');
await fs.writeFile(pdfPath, pdfBytes);

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

runExtractedProseBuild({ root, repoRoot, env });
await fs.writeFile(pdfPath, pdfBytes);
runExtractedProseBuild({ root, repoRoot, env });

const { extractionReport } = await readExtractedProseArtifacts(repoRoot);
assert.ok(extractionReport, 'expected extraction report after second run');
const pdfEntry = findFixtureEntryBySuffix(extractionReport.files, 'docs/sample.pdf');
assert.ok(pdfEntry, 'expected extraction report file entry for docs/sample.pdf');
assert.equal(pdfEntry?.status, 'ok', 'expected successful extraction report entry for docs/sample.pdf');
assert.ok(
  Array.isArray(pdfEntry?.warnings) && pdfEntry.warnings.includes('document-extraction-cache-hit'),
  'expected cache-hit reason code in extraction warnings'
);

const cachePath = await findFileByName(cacheRoot, 'document-extraction-cache.json');
assert.ok(cachePath, 'expected persisted document extraction cache file');
const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
assert.ok(Object.keys(cache?.entries || {}).length >= 1, 'expected persisted document extraction cache entries');

console.log('document extraction cache hit reason test passed');
