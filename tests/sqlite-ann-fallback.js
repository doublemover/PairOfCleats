#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, getIndexDir } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-ann-fallback');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export const alpha = () => "ann_fallback_token";\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_sqlite', [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot]);

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'ann_fallback_token', '--ann', '--json', '--repo', repoRoot],
  { env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('sqlite ann fallback test failed: search returned error');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('sqlite ann fallback test failed: invalid JSON output');
  process.exit(1);
}

const hits = payload?.code || [];
if (!hits.length) {
  console.error('sqlite ann fallback test failed: no results returned');
  process.exit(1);
}
if (payload?.stats?.annBackend === 'sqlite-extension') {
  console.error('sqlite ann fallback test failed: ann backend should not be sqlite-extension');
  process.exit(1);
}
if (payload?.stats?.annExtension?.available?.code) {
  console.error('sqlite ann fallback test failed: ann extension should be unavailable');
  process.exit(1);
}

const userConfig = loadUserConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMetaPath = path.join(indexDir, 'chunk_meta.json');
const chunkMeta = JSON.parse(await fsPromises.readFile(chunkMetaPath, 'utf8'));
const maxId = Array.isArray(chunkMeta) ? chunkMeta.length - 1 : -1;
for (const hit of hits) {
  if (!Number.isFinite(hit?.id) || hit.id < 0 || hit.id > maxId) {
    console.error(`sqlite ann fallback test failed: out-of-range doc id ${hit?.id}`);
    process.exit(1);
  }
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('sqlite ann fallback test passed');

