#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { buildMinimalDocxBuffer, buildMinimalPdfBuffer } from '../../helpers/document-fixtures.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-docs-skipped-when-unavailable');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), buildMinimalPdfBuffer('phase17 missing pdf dep'));
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.docx'), buildMinimalDocxBuffer(['phase17 missing docx dep']));

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
    PAIROFCLEATS_TEST_FORCE_PDF_MISSING: '1',
    PAIROFCLEATS_TEST_FORCE_DOCX_MISSING: '1'
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
const fileLists = JSON.parse(await fs.readFile(path.join(indexDir, '.filelists.json'), 'utf8'));
const skippedSample = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];

const skippedPdf = skippedSample.find((entry) => normalizePath(entry?.file).endsWith('docs/sample.pdf'));
const skippedDocx = skippedSample.find((entry) => normalizePath(entry?.file).endsWith('docs/sample.docx'));
assert.ok(skippedPdf, 'expected skipped PDF entry');
assert.ok(skippedDocx, 'expected skipped DOCX entry');
assert.equal(skippedPdf?.reason, 'missing_dependency', 'expected PDF missing dependency reason');
assert.equal(skippedDocx?.reason, 'missing_dependency', 'expected DOCX missing dependency reason');

console.log('documents skipped when unavailable test passed');
