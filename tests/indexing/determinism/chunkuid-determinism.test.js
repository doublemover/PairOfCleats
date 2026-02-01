#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'chunkuid-determinism');
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
  const env = {
    ...process.env,
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };
  return spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
};

const loadChunkMap = (cacheRoot) => {
  process.env.PAIROFCLEATS_TESTING = '1';
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const chunkMeta = JSON.parse(fs.readFileSync(path.join(codeDir, 'chunk_meta.json'), 'utf8'));
  const fileMetaPath = path.join(codeDir, 'file_meta.json');
  const fileMeta = fs.existsSync(fileMetaPath)
    ? JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'))
    : [];
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
