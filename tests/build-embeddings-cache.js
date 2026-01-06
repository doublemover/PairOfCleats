#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'build-embeddings-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export const alpha = () => 1;\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ indexing: { treeSitter: { enabled: false } } }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings', [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const cacheDir = path.join(cacheRoot, 'embeddings', 'code', 'files');
const cacheFiles = fs.existsSync(cacheDir)
  ? fs.readdirSync(cacheDir).filter((name) => name.endsWith('.json'))
  : [];
if (!cacheFiles.length) {
  console.error('Expected embedding cache files to be created');
  process.exit(1);
}
const cachePath = path.join(cacheDir, cacheFiles[0]);
const before = await fsPromises.stat(cachePath);

runNode('build_embeddings cached', [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const after = await fsPromises.stat(cachePath);
if (after.mtimeMs !== before.mtimeMs) {
  console.error('Expected embedding cache file to be reused without rewrite');
  process.exit(1);
}

console.log('embedding cache reuse test passed');
