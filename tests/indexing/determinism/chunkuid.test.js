#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { MAX_JSON_BYTES, loadJsonArrayArtifactSync } from '../../../src/shared/artifact-io.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'chunkuid-determinism');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootA = path.join(tempRoot, 'cache-a');
const cacheRootB = path.join(tempRoot, 'cache-b');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRootA, { recursive: true });
await fsPromises.mkdir(cacheRootB, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export function alpha() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'beta.js'),
  'import { alpha } from "./alpha.js";\nexport function beta() { return alpha(); }\n'
);

const buildIndex = (cacheRoot) => {
  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub'
  });
  return spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
};

const loadChunkMap = (cacheRoot) => {
  applyTestEnv({
    cacheRoot,
    embeddings: 'stub'
  });
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const chunkMeta = loadJsonArrayArtifactSync(codeDir, 'chunk_meta', {
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const fileMeta = loadJsonArrayArtifactSync(codeDir, 'file_meta', {
    maxBytes: MAX_JSON_BYTES,
    strict: false
  });
  const fileById = new Map(
    (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
  );
  const map = new Map();
  for (const entry of chunkMeta) {
    const file = entry.file || fileById.get(entry.fileId) || '';
    const key = `${file}::${entry.start}::${entry.end}::${entry.name || ''}`;
    const uid = entry.chunkUid || entry.metaV2?.chunkUid || null;
    map.set(key, uid);
  }
  return map;
};

const first = buildIndex(cacheRootA);
if (first.status !== 0) {
  console.error('chunkUid determinism test failed: first build failed');
  process.exit(first.status ?? 1);
}

const second = buildIndex(cacheRootB);
if (second.status !== 0) {
  console.error('chunkUid determinism test failed: second build failed');
  process.exit(second.status ?? 1);
}

const firstMap = loadChunkMap(cacheRootA);
const secondMap = loadChunkMap(cacheRootB);

if (firstMap.size !== secondMap.size) {
  console.error('chunkUid determinism test failed: chunk counts differ');
  process.exit(1);
}

for (const [key, uid] of firstMap.entries()) {
  if (secondMap.get(key) !== uid) {
    console.error(`chunkUid determinism test failed: mismatch for ${key}`);
    process.exit(1);
  }
}

console.log('chunkUid determinism test passed');
