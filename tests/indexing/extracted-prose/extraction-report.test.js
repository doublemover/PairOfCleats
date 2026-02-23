#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import {
  readExtractedProseArtifacts,
  runExtractedProseBuild,
  setupExtractedProseFixture
} from '../../helpers/extracted-prose-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

const { root, repoRoot, cacheRoot, docsDir } = await setupExtractedProseFixture('phase17-extraction-report');

await fs.writeFile(path.join(docsDir, 'sample.pdf'), Buffer.from('phase17 extraction report pdf', 'utf8'));
await fs.writeFile(path.join(docsDir, 'sample.docx'), Buffer.from('phase17 extraction report docx', 'utf8'));
for (let i = 1; i <= 6; i += 1) {
  await fs.writeFile(
    path.join(repoRoot, `a-low-yield-${i}.js`),
    `const v${i} = ${i};\nexport default v${i};\n`
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
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 4,
          warmupWindowMultiplier: 1,
          minYieldRatio: 0.75,
          minYieldedFiles: 2,
          seed: 'phase17-low-yield-seed'
        }
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1',
    PAIROFCLEATS_TEST_STUB_DOCX_EXTRACT: '1'
  }
});

runExtractedProseBuild({ root, repoRoot, env });

const { state, extractionReport: report } = await readExtractedProseArtifacts(repoRoot);
assert.ok(state?.indexDir, 'expected extracted-prose index dir');
assert.ok(report, 'expected extraction_report artifact');
assert.equal(report?.schemaVersion, 1, 'expected extraction report schemaVersion=1');
assert.equal(report?.mode, 'extracted-prose', 'expected extraction report mode');
assert.ok(Array.isArray(report?.files) && report.files.length >= 2, 'expected report file entries');
assert.ok(Array.isArray(report?.extractors) && report.extractors.length >= 1, 'expected report extractor entries');
const lowYieldMarker = report?.quality?.lowYieldBailout;
assert.ok(lowYieldMarker && typeof lowYieldMarker === 'object', 'expected extracted-prose quality marker');
assert.equal(lowYieldMarker?.enabled, true, 'expected low-yield bailout marker enabled');
assert.equal(lowYieldMarker?.triggered, true, 'expected low-yield bailout trigger');
assert.equal(
  lowYieldMarker?.reason,
  'extracted-prose-low-yield-bailout',
  'expected low-yield bailout reason'
);
assert.equal(
  lowYieldMarker?.qualityImpact,
  'reduced-extracted-prose-recall',
  'expected low-yield quality marker'
);
assert.equal(lowYieldMarker?.seed, 'phase17-low-yield-seed', 'expected deterministic warmup seed');
assert.ok(
  Number(lowYieldMarker?.sampledFiles) >= 4,
  'expected low-yield warmup sample accounting'
);
assert.equal(lowYieldMarker?.sampledYieldedFiles, 0, 'expected zero warmup yield for synthetic low-yield files');
assert.equal(lowYieldMarker?.deterministic, true, 'expected deterministic warmup marker');
assert.equal(lowYieldMarker?.downgradedRecall, true, 'expected downgraded recall marker');

const schemaCheck = validateArtifact('extraction_report', report);
assert.equal(schemaCheck.ok, true, `expected extraction report schema validation: ${schemaCheck.errors.join('; ')}`);

for (const file of report.files) {
  if (file?.status !== 'ok') continue;
  const expected = sha256([
    file?.sourceBytesHash || '',
    file?.extractor?.version || '',
    file?.normalizationPolicy || '',
    report?.chunkerVersion || '',
    report?.extractionConfigDigest || ''
  ].join('|'));
  assert.equal(file?.extractionIdentityHash, expected, `expected extractionIdentityHash for ${file?.file}`);
}

const piecesManifest = JSON.parse(await fs.readFile(path.join(state.indexDir, 'pieces', 'manifest.json'), 'utf8'));
const extractionPiece = Array.isArray(piecesManifest?.pieces)
  ? piecesManifest.pieces.find((piece) => piece?.name === 'extraction_report')
  : null;
assert.ok(extractionPiece, 'expected extraction_report in pieces manifest');

console.log('extraction report test passed');
