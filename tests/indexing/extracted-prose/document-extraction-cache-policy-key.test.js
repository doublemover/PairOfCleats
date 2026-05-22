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
  'phase17-document-extraction-cache-policy-key'
);

const pdfPath = path.join(docsDir, 'sample.pdf');
await fs.writeFile(pdfPath, Buffer.from('document extraction cache policy key fixture', 'utf8'));

runExtractedProseBuild({ root, repoRoot, env: createStubPdfExtractionEnv({ cacheRoot, maxPages: 1000 }) });

const cachePath = await findFileByName(cacheRoot, 'document-extraction-cache.json');
assert.ok(cachePath, 'expected document extraction cache file after initial build');
const firstCache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
const firstEntryCount = Object.keys(firstCache?.entries || {}).length;
assert.ok(firstEntryCount >= 1, 'expected at least one cache entry after initial build');

runExtractedProseBuild({ root, repoRoot, env: createStubPdfExtractionEnv({ cacheRoot, maxPages: 1001 }) });

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
  hasFixtureWarning(secondPdfEntry, 'document-extraction-cache-hit'),
  false,
  'expected policy change run to miss existing extraction cache'
);

runExtractedProseBuild({ root, repoRoot, env: createStubPdfExtractionEnv({ cacheRoot, maxPages: 1001 }) });

const thirdArtifacts = await readExtractedProseArtifacts(repoRoot);
const thirdPdfEntry = findFixtureEntryBySuffix(thirdArtifacts.extractionReport?.files, 'docs/sample.pdf');
assert.ok(thirdPdfEntry, 'expected extraction report entry for docs/sample.pdf after policy-stable run');
assert.equal(
  hasFixtureWarning(thirdPdfEntry, 'document-extraction-cache-hit'),
  true,
  'expected policy-stable run to hit extraction cache'
);

console.log('document extraction cache policy key test passed');
