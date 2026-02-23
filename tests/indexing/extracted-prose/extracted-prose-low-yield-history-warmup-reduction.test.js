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

const { root, repoRoot, cacheRoot } = await setupExtractedProseFixture(
  'phase18-low-yield-history-warmup-reduction'
);
const srcDir = path.join(repoRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
for (let i = 1; i <= 64; i += 1) {
  await fs.writeFile(
    path.join(srcDir, `never-yield-${i}.js`),
    `const value${i} = ${i};\nexport default value${i};\n`
  );
}

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: { enabled: true },
      extractedProse: {
        prefilter: { yieldProfile: { enabled: false } },
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 16,
          warmupWindowMultiplier: 1,
          minYieldRatio: 0.75,
          minYieldedFiles: 2,
          seed: 'phase18-history-warmup-seed'
        }
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

runExtractedProseBuild({ root, repoRoot, env });
runExtractedProseBuild({ root, repoRoot, env });

const { extractionReport: report, fileLists } = await readExtractedProseArtifacts(repoRoot);
assert.ok(report, 'expected extraction_report artifact');
const lowYieldMarker = report?.quality?.lowYieldBailout;
assert.ok(lowYieldMarker && typeof lowYieldMarker === 'object', 'expected low-yield quality marker');
assert.equal(lowYieldMarker.enabled, true, 'expected low-yield bailout to remain enabled');
assert.equal(lowYieldMarker.triggered, true, 'expected low-yield bailout trigger');
assert.equal(lowYieldMarker.warmupSampleSize, 8, 'expected persisted zero-yield history to reduce warmup sample size');
assert.ok(
  Number(lowYieldMarker.sampledFiles) <= 8,
  'expected reduced warmup sample count in extraction report'
);

const skipped = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const bailoutSkips = skipped.filter((entry) => entry?.reason === 'extracted-prose-low-yield-bailout');
assert.ok(bailoutSkips.length >= 1, 'expected low-yield bailout skips after reduced warmup');

console.log('extracted prose low-yield history warmup reduction test passed');
