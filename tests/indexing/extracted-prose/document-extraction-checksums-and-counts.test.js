#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-document-checksums-counts');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const pdfPath = path.join(repoRoot, 'docs', 'sample.pdf');
const docxPath = path.join(repoRoot, 'docs', 'sample.docx');
const pdfBuffer = Buffer.from('stub pdf checksum payload', 'utf8');
const docxBuffer = Buffer.from('stub docx checksum payload', 'utf8');
await fsPromises.writeFile(pdfPath, pdfBuffer);
await fsPromises.writeFile(docxPath, docxBuffer);

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
  [
    path.join(root, 'build_index.js'),
    '--repo',
    repoRoot,
    '--mode',
    'extracted-prose',
    '--stub-embeddings'
  ],
  {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  }
);
if (buildResult.status !== 0) {
  console.error('document checksum/count test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const currentBuild = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
const indexRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
if (!indexRoot) {
  console.error('document checksum/count test failed: missing build root');
  process.exit(1);
}

const buildStatePath = path.join(indexRoot, 'build_state.json');
if (!fs.existsSync(buildStatePath)) {
  console.error('document checksum/count test failed: missing build_state.json');
  process.exit(1);
}
const buildState = JSON.parse(await fsPromises.readFile(buildStatePath, 'utf8'));
const extraction = buildState?.documentExtraction?.['extracted-prose'];
const files = Array.isArray(extraction?.files) ? extraction.files : [];
const pdfEntry = files.find((entry) => normalizePath(entry?.file).endsWith('docs/sample.pdf'));
const docxEntry = files.find((entry) => normalizePath(entry?.file).endsWith('docs/sample.docx'));
if (!pdfEntry || !docxEntry) {
  console.error('document checksum/count test failed: missing expected extraction file entries');
  process.exit(1);
}

if (pdfEntry.sourceBytesHash !== sha256(pdfBuffer)) {
  console.error('document checksum/count test failed: pdf sourceBytesHash mismatch');
  process.exit(1);
}
if (docxEntry.sourceBytesHash !== sha256(docxBuffer)) {
  console.error('document checksum/count test failed: docx sourceBytesHash mismatch');
  process.exit(1);
}

if ((pdfEntry?.unitCounts?.totalUnits || 0) < 1) {
  console.error('document checksum/count test failed: expected PDF unitCounts.totalUnits >= 1');
  process.exit(1);
}
if ((docxEntry?.unitCounts?.totalUnits || 0) < 1) {
  console.error('document checksum/count test failed: expected DOCX unitCounts.totalUnits >= 1');
  process.exit(1);
}

if ((extraction?.totals?.files || 0) < 2) {
  console.error('document checksum/count test failed: expected totals.files >= 2');
  process.exit(1);
}

console.log('document extraction checksums/counts test passed');
