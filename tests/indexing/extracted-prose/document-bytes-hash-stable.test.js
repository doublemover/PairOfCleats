#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase17-document-bytes-hash-stable');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.pdf'), Buffer.from('phase17 bytes hash stable pdf', 'utf8'));
await fs.writeFile(path.join(repoRoot, 'docs', 'sample.docx'), Buffer.from('phase17 bytes hash stable docx', 'utf8'));

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
  return getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot });
};

const firstDir = runBuildAndCollect();
const firstReport = JSON.parse(await fs.readFile(path.join(firstDir, 'extraction_report.json'), 'utf8'));
const secondDir = runBuildAndCollect();
const secondReport = JSON.parse(await fs.readFile(path.join(secondDir, 'extraction_report.json'), 'utf8'));

const toHashMap = (report) => {
  const map = new Map();
  for (const entry of report?.files || []) {
    const key = normalizePath(entry?.file);
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
