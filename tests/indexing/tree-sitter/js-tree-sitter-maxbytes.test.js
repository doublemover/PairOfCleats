#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'js-tree-sitter-maxbytes');
const repoRootRaw = path.join(tempRoot, 'repo');
const repoRoot = toRealPathSync(repoRootRaw);
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const expectedConfig = loadUserConfig(repoRoot);
const expectedCaps = resolveFileCapsAndGuardrails(expectedConfig?.indexing || {});
const maxBytes = Number(expectedCaps?.fileCaps?.byLanguage?.javascript?.maxBytes)
  || Number(LANGUAGE_CAPS_BASELINES.javascript?.maxBytes);
if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
  console.error('JS tree-sitter maxBytes test setup failed: unresolved calibrated maxBytes.');
  process.exit(1);
}

const payload = 'a'.repeat(maxBytes + 64);
const bigFilePath = path.join(srcDir, 'big.js');
await fsPromises.writeFile(bigFilePath, `const data = "${payload}";\n`);

const stats = await fsPromises.stat(bigFilePath);
if (stats.size <= maxBytes) {
  console.error('JS tree-sitter maxBytes test setup failed: file too small.');
  process.exit(1);
}

const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const result = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (result.status !== 0) {
  const stderr = String(result.stderr || '');
  if (/better-sqlite3/i.test(stderr) && /Could not locate the bindings file/i.test(stderr)) {
    console.log('better-sqlite3 bindings unavailable; skipping js tree-sitter maxBytes test.');
    process.exit(0);
  }
  console.error('JS tree-sitter maxBytes test failed: build_index error.');
  if (stderr) console.error(stderr.trim());
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const fileListsPath = path.join(codeDir, '.filelists.json');
if (!fs.existsSync(fileListsPath)) {
  console.error('JS tree-sitter maxBytes test failed: missing .filelists.json.');
  process.exit(1);
}
const fileLists = JSON.parse(fs.readFileSync(fileListsPath, 'utf8'));
const skipped = Array.isArray(fileLists?.skipped?.sample) ? fileLists.skipped.sample : [];
const bigFileCanonical = toRealPathSync(bigFilePath);
const skippedEntry = skipped.find((entry) => {
  if (!entry?.file || typeof entry.file !== 'string') return false;
  try {
    return toRealPathSync(entry.file) === bigFileCanonical;
  } catch {
    return path.resolve(entry.file).toLowerCase() === path.resolve(bigFilePath).toLowerCase();
  }
});
if (!skippedEntry) {
  console.error('JS tree-sitter maxBytes test failed: expected skip entry missing.');
  process.exit(1);
}
if (skippedEntry.reason !== 'oversize') {
  console.error(`JS tree-sitter maxBytes test failed: unexpected reason ${skippedEntry.reason}.`);
  process.exit(1);
}
if (skippedEntry.maxBytes !== maxBytes) {
  console.error('JS tree-sitter maxBytes test failed: maxBytes mismatch.');
  process.exit(1);
}

console.log('js tree-sitter maxBytes test passed');


