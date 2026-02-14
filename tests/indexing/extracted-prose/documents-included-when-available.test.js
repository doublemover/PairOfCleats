#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-docs-included-when-available');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), Buffer.from('phase17 include pdf', 'utf8'));
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.docx'), Buffer.from('phase17 include docx', 'utf8'));

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

const buildStatePath = path.join(indexRoot, 'build_state.json');
const buildState = JSON.parse(await fs.readFile(buildStatePath, 'utf8'));
const extraction = buildState?.documentExtraction?.['extracted-prose'];
assert.ok(extraction, 'expected document extraction summary in build_state');

const files = Array.isArray(extraction?.files) ? extraction.files : [];
const pdfEntry = files.find((entry) => normalizePath(entry?.file).endsWith('docs/sample.pdf'));
const docxEntry = files.find((entry) => normalizePath(entry?.file).endsWith('docs/sample.docx'));
assert.ok(pdfEntry, 'expected extracted PDF entry');
assert.ok(docxEntry, 'expected extracted DOCX entry');
assert.equal(pdfEntry?.sourceType, 'pdf', 'expected PDF sourceType');
assert.equal(docxEntry?.sourceType, 'docx', 'expected DOCX sourceType');

console.log('documents included when available test passed');
