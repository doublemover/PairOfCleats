#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadChunkMeta, readJsonFile } from '../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'prose-rust-exclusion');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');
const docsDir = path.join(repoRoot, 'docs');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(docsDir, { recursive: true });

await fsPromises.writeFile(path.join(srcDir, 'lib.rs'), 'fn main() {}\n');
await fsPromises.writeFile(path.join(docsDir, 'readme.md'), '# Readme\n');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'prose', '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('prose rust exclusion test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
const userConfig = loadUserConfig(repoRoot);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
if (previousCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
}

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
