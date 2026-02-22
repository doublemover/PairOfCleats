#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeFixturePath,
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase17-document-bytes-hash-stable'
);
await fs.writeFile(path.join(docsDir, 'sample.pdf'), Buffer.from('phase17 bytes hash stable pdf', 'utf8'));
await fs.writeFile(path.join(docsDir, 'sample.docx'), Buffer.from('phase17 bytes hash stable docx', 'utf8'));

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

const runBuildAndCollect = () => {
  runExtractedProseBuild({ root, repoRoot, env });
};

runBuildAndCollect();
const firstArtifacts = await readExtractedProseArtifacts(repoRoot);
const firstReport = firstArtifacts.extractionReport || { files: [] };
runBuildAndCollect();
const secondArtifacts = await readExtractedProseArtifacts(repoRoot);
const secondReport = secondArtifacts.extractionReport || { files: [] };

const toHashMap = (report) => {
  const map = new Map();
  for (const entry of report?.files || []) {
    const key = normalizeFixturePath(entry?.file);
    if (!key) continue;
    map.set(key, {
      sourceBytesHash: entry?.sourceBytesHash || null,
      extractionIdentityHash: entry?.extractionIdentityHash || null
    });
  }
  return map;
};

const first = toHashMap(firstReport);
const second = toHashMap(secondReport);
assert.equal(first.size, second.size, 'expected stable report file count');
for (const [file, hashes] of first.entries()) {
  const next = second.get(file);
  assert.ok(next, `expected second report entry for ${file}`);
  assert.equal(next.sourceBytesHash, hashes.sourceBytesHash, `expected stable sourceBytesHash for ${file}`);
  assert.equal(next.extractionIdentityHash, hashes.extractionIdentityHash, `expected stable extractionIdentityHash for ${file}`);
}

console.log('document bytes hash stable test passed');
