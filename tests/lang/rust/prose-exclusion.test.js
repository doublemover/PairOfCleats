#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadChunkMeta, readJsonFile } from '../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'prose-rust-exclusion');
const repoRootRaw = path.join(tempRoot, 'repo');
const repoRoot = toRealPathSync(repoRootRaw);
const srcDir = path.join(repoRoot, 'src');
const docsDir = path.join(repoRoot, 'docs');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(docsDir, { recursive: true });

await fsPromises.writeFile(path.join(srcDir, 'lib.rs'), 'fn main() {}\n');
await fsPromises.writeFile(path.join(docsDir, 'readme.md'), '# Readme\n');

const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--stage', 'stage2', '--mode', 'prose', '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('prose rust exclusion test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);

const proseMeta = await loadChunkMeta(proseDir);
const fileMeta = await readJsonFile(path.join(proseDir, 'file_meta.json'));
const fileById = new Map(fileMeta.map((entry) => [entry.id, entry.file]));
if (proseMeta.some((chunk) => fileById.get(chunk.fileId) === 'src/lib.rs')) {
  console.error('prose rust exclusion test failed: rust file leaked into prose index.');
  process.exit(1);
}
if (!proseMeta.some((chunk) => fileById.get(chunk.fileId) === 'docs/readme.md')) {
  console.error('prose rust exclusion test failed: readme missing from prose index.');
  process.exit(1);
}

console.log('prose rust exclusion test passed.');

