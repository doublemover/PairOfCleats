#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'build-index-all');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.md'), '# Beta\\n');
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ indexing: { treeSitter: { enabled: false } } }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--mode', 'all', '--stub-embeddings', '--repo', repoRoot],
  { env, stdio: 'inherit' }
);
if (result.status !== 0) {
  console.error('Failed: build_index --mode all');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const modes = ['code', 'prose', 'extracted-prose'];
const hasChunkMeta = (dir) => (
  fs.existsSync(path.join(dir, 'chunk_meta.json'))
  || fs.existsSync(path.join(dir, 'chunk_meta.jsonl'))
  || fs.existsSync(path.join(dir, 'chunk_meta.meta.json'))
  || fs.existsSync(path.join(dir, 'chunk_meta.parts'))
);

for (const mode of modes) {
  const dir = getIndexDir(repoRoot, mode, userConfig);
  if (!hasChunkMeta(dir)) {
    console.error(`Expected chunk metadata for ${mode} in ${dir}`);
    process.exit(1);
  }
}

console.log('build-index --mode all test passed');
