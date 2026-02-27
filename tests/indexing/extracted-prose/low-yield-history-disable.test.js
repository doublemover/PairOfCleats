#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture(
  'phase18-low-yield-history-disable'
);
const srcDir = path.join(repoRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(path.join(docsDir, 'history-yield.pdf'), Buffer.from('history yield pdf', 'utf8'));
for (let i = 1; i <= 8; i += 1) {
  await fs.writeFile(
    path.join(srcDir, `low-yield-${i}.js`),
    `const value${i} = ${i};\nexport default value${i};\n`
  );
}

const baseTestConfig = {
  indexing: {
    scm: { provider: 'none' },
    treeSitter: { enabled: false },
    documentExtraction: { enabled: true }
  }
};

const envPrime = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    ...baseTestConfig,
    indexing: {
      ...baseTestConfig.indexing,
      extractedProse: {
        lowYieldBailout: { enabled: false }
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1'
  }
});
runExtractedProseBuild({ root, repoRoot, env: envPrime });

const envCheck = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    ...baseTestConfig,
    indexing: {
      ...baseTestConfig.indexing,
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 6,
          warmupWindowMultiplier: 1,
          minYieldRatio: 0.9,
          minYieldedFiles: 2,
          seed: 'phase18-history-disable-seed'
        }
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1'
  }
});
runExtractedProseBuild({ root, repoRoot, env: envCheck });

const { extractionReport: report, fileLists } = await readExtractedProseArtifacts(repoRoot);
assert.ok(report, 'expected extraction_report artifact');
const lowYieldMarker = report?.quality?.lowYieldBailout;
assert.ok(lowYieldMarker && typeof lowYieldMarker === 'object', 'expected low-yield quality marker');
assert.equal(lowYieldMarker.enabled, false, 'expected low-yield bailout disabled by persisted yield history');
assert.equal(lowYieldMarker.triggered, false, 'expected no low-yield trigger when history has extracted yield');
assert.equal(lowYieldMarker.warmupWindowSize, 0, 'expected history disable path to skip warmup window');
assert.equal(lowYieldMarker.warmupSampleSize, 0, 'expected history disable path to skip warmup sample');

const skipped = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const bailoutSkips = skipped.filter((entry) => entry?.reason === 'extracted-prose-low-yield-bailout');
assert.equal(bailoutSkips.length, 0, 'expected no low-yield bailout skips when history has yield');

console.log('extracted prose low-yield history disable test passed');
