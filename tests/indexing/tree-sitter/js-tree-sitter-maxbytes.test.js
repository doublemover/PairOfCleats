#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'js-tree-sitter-maxbytes');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const maxBytes = 512 * 1024;
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
  console.error('JS tree-sitter maxBytes test failed: build_index error.');
  if (result.stderr) console.error(result.stderr.trim());
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
const skippedEntry = skipped.find((entry) => path.resolve(entry.file) === path.resolve(bigFilePath));
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

