#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-extraction-report');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), Buffer.from('phase17 extraction report pdf', 'utf8'));
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.docx'), Buffer.from('phase17 extraction report docx', 'utf8'));

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

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--stub-embeddings'],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
assert.equal(buildResult.status, 0, 'expected extracted-prose build to succeed');

const userConfig = loadUserConfig(repoRoot);
const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
const indexRoot = buildInfo?.activeRoot || buildInfo?.buildRoot || null;
assert.ok(indexRoot, 'expected extracted-prose build root');

const indexDir = getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot });
const report = JSON.parse(await fs.readFile(path.join(indexDir, 'extraction_report.json'), 'utf8'));
assert.equal(report?.schemaVersion, 1, 'expected extraction report schemaVersion=1');
assert.equal(report?.mode, 'extracted-prose', 'expected extraction report mode');
assert.ok(Array.isArray(report?.files) && report.files.length >= 2, 'expected report file entries');
assert.ok(Array.isArray(report?.extractors) && report.extractors.length >= 1, 'expected report extractor entries');

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

const piecesManifest = JSON.parse(await fs.readFile(path.join(indexDir, 'pieces', 'manifest.json'), 'utf8'));
const extractionPiece = Array.isArray(piecesManifest?.pieces)
  ? piecesManifest.pieces.find((piece) => piece?.name === 'extraction_report')
  : null;
assert.ok(extractionPiece, 'expected extraction_report in pieces manifest');

console.log('extraction report test passed');
