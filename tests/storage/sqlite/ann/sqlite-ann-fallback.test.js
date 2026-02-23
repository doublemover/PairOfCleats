#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, getIndexDir } from '../../../../tools/shared/dict-utils.js';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../../../src/shared/artifact-io.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const suffixRaw = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
  ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
  : '';
const cacheName = suffixRaw ? `sqlite-ann-fallback-${suffixRaw}` : 'sqlite-ann-fallback';
const tempRoot = resolveTestCachePath(root, cacheName);
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export const alpha = () => "ann_fallback_token";\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub'
});

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
await runSqliteBuild(repoRoot);

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
const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
const maxId = Array.isArray(chunkMeta) ? chunkMeta.length - 1 : -1;
for (const hit of hits) {
  if (!Number.isFinite(hit?.id) || hit.id < 0 || hit.id > maxId) {
    console.error(`sqlite ann fallback test failed: out-of-range doc id ${hit?.id}`);
    process.exit(1);
  }
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('sqlite ann fallback test passed');

