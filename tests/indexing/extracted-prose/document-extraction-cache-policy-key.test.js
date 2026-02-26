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

const buildEnv = ({ cacheRoot, maxPages }) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: {
        enabled: true,
        maxPages
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1'
  }
});

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-extraction-cache-policy-key'
);

const pdfPath = path.join(docsDir, 'sample.pdf');
await fs.writeFile(pdfPath, Buffer.from('document extraction cache policy key fixture', 'utf8'));

runExtractedProseBuild({ root, repoRoot, env: buildEnv({ cacheRoot, maxPages: 1000 }) });

const cachePath = await findFileByName(cacheRoot, 'document-extraction-cache.json');
assert.ok(cachePath, 'expected document extraction cache file after initial build');
const firstCache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
const firstEntryCount = Object.keys(firstCache?.entries || {}).length;
assert.ok(firstEntryCount >= 1, 'expected at least one cache entry after initial build');

runExtractedProseBuild({ root, repoRoot, env: buildEnv({ cacheRoot, maxPages: 1001 }) });

const secondCache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
const secondEntryCount = Object.keys(secondCache?.entries || {}).length;
assert.ok(
  secondEntryCount > firstEntryCount,
  'expected cache-key split when extraction policy changes'
);

const secondArtifacts = await readExtractedProseArtifacts(repoRoot);
const secondPdfEntry = findFixtureEntryBySuffix(secondArtifacts.extractionReport?.files, 'docs/sample.pdf');
assert.ok(secondPdfEntry, 'expected extraction report entry for docs/sample.pdf after policy change run');
assert.equal(
  Array.isArray(secondPdfEntry?.warnings) && secondPdfEntry.warnings.includes('document-extraction-cache-hit'),
  false,
  'expected policy change run to miss existing extraction cache'
);

runExtractedProseBuild({ root, repoRoot, env: buildEnv({ cacheRoot, maxPages: 1001 }) });

const thirdArtifacts = await readExtractedProseArtifacts(repoRoot);
const thirdPdfEntry = findFixtureEntryBySuffix(thirdArtifacts.extractionReport?.files, 'docs/sample.pdf');
assert.ok(thirdPdfEntry, 'expected extraction report entry for docs/sample.pdf after policy-stable run');
assert.equal(
  Array.isArray(thirdPdfEntry?.warnings) && thirdPdfEntry.warnings.includes('document-extraction-cache-hit'),
  true,
  'expected policy-stable run to hit extraction cache'
);

console.log('document extraction cache policy key test passed');
