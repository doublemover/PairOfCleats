#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createStubPdfExtractionEnv,
  findFixtureEntryBySuffix,
  hasFixtureWarning,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-extraction-cache-policy-hit'
);
await fs.writeFile(path.join(docsDir, 'sample.pdf'), Buffer.from('document extraction cache policy key fixture', 'utf8'));
const env = createStubPdfExtractionEnv({ cacheRoot, maxPages: 1001 });
runExtractedProseBuild({ root, repoRoot, env });
runExtractedProseBuild({ root, repoRoot, env });

const artifacts = await readExtractedProseArtifacts(repoRoot);
const pdfEntry = findFixtureEntryBySuffix(artifacts.extractionReport?.files, 'docs/sample.pdf');
assert.ok(pdfEntry, 'expected extraction report entry for docs/sample.pdf after policy-stable run');
assert.equal(hasFixtureWarning(pdfEntry, 'document-extraction-cache-hit'), true,
  'expected policy-stable run to hit extraction cache');
console.log('document extraction cache policy-stable run reuses the retained entry');
