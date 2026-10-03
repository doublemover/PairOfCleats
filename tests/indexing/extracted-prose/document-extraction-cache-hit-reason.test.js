#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createStubPdfExtractionEnv,
  findFixtureEntryBySuffix,
  findFileByName,
  hasFixtureWarning,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-extraction-cache-hit-reason'
);
const pdfPath = path.join(docsDir, 'sample.pdf');
const pdfBytes = Buffer.from('document extraction cache hit fixture', 'utf8');
await fs.writeFile(pdfPath, pdfBytes);

const env = createStubPdfExtractionEnv({ cacheRoot });

runExtractedProseBuild({ root, repoRoot, env });
await fs.writeFile(pdfPath, pdfBytes);
runExtractedProseBuild({ root, repoRoot, env });

const { extractionReport } = await readExtractedProseArtifacts(repoRoot);
assert.ok(extractionReport, 'expected extraction report after second run');
const pdfEntry = findFixtureEntryBySuffix(extractionReport.files, 'docs/sample.pdf');
assert.ok(pdfEntry, 'expected extraction report file entry for docs/sample.pdf');
assert.equal(pdfEntry?.status, 'ok', 'expected successful extraction report entry for docs/sample.pdf');
assert.ok(
  hasFixtureWarning(pdfEntry, 'document-extraction-cache-hit'),
  'expected cache-hit reason code in extraction warnings'
);

const cachePath = await findFileByName(cacheRoot, 'document-extraction-cache.json');
assert.ok(cachePath, 'expected persisted document extraction cache file');
const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
assert.ok(Object.keys(cache?.entries || {}).length >= 1, 'expected persisted document extraction cache entries');

console.log('document extraction cache hit reason test passed');
