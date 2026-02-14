#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { buildMinimalDocxBuffer } from '../../helpers/document-fixtures.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-document-extraction-outcomes');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'docs', 'ok.pdf'), Buffer.from('phase17 outcomes pdf ok', 'utf8'));
await fs.writeFile(path.join(repoRoot, 'docs', 'skip.docx'), buildMinimalDocxBuffer(['phase17 outcomes docx skip']));

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
const report = JSON.parse(await fs.readFile(path.join(indexDir, 'extraction_report.json'), 'utf8'));
const files = Array.isArray(report?.files) ? report.files : [];
const okPdf = files.find((entry) => normalizePath(entry?.file).endsWith('docs/ok.pdf'));
const skippedDocx = files.find((entry) => normalizePath(entry?.file).endsWith('docs/skip.docx'));

assert.ok(okPdf, 'expected PDF report entry');
assert.ok(skippedDocx, 'expected DOCX report entry');
assert.equal(okPdf?.status, 'ok', 'expected PDF status=ok');
assert.equal(skippedDocx?.status, 'skipped', 'expected DOCX status=skipped');
assert.equal(skippedDocx?.reason, 'missing_dependency', 'expected DOCX missing dependency reason');

assert.equal(report?.counts?.total, 2, 'expected total count=2');
assert.equal(report?.counts?.ok, 1, 'expected ok count=1');
assert.equal(report?.counts?.skipped, 1, 'expected skipped count=1');
assert.equal(report?.counts?.byReason?.missing_dependency, 1, 'expected missing_dependency count=1');

console.log('document extraction outcomes recorded test passed');
