#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { getIndexDir, resolveSqlitePaths } from '../../../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'chunk-id-backend-parity');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'export function beta() { return 2; }\n');

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--sqlite', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build index for chunk-id backend parity');
  process.exit(buildResult.status ?? 1);
}

const indexDir = getIndexDir(repoRoot, 'code');
const chunkMeta = await loadChunkMeta(indexDir);
const chunkIds = chunkMeta
  .map((entry) => entry?.metaV2?.chunkId || entry?.chunkId || null)
  .filter(Boolean);

if (!chunkIds.length) {
  console.error('Expected chunk IDs in chunk_meta artifacts.');
  process.exit(1);
}

const sqlitePaths = resolveSqlitePaths(repoRoot);
if (!fs.existsSync(sqlitePaths.codePath)) {
  console.error(`Expected sqlite index at ${sqlitePaths.codePath}`);
  process.exit(1);
}

const db = new Database(sqlitePaths.codePath, { readonly: true });
const rows = db.prepare('SELECT chunk_id FROM chunks WHERE mode = ? ORDER BY id').all('code');
db.close();

const sqliteChunkIds = rows.map((row) => row?.chunk_id).filter(Boolean);
assert.equal(
  sqliteChunkIds.length,
  chunkIds.length,
  'expected sqlite chunk_id count to match chunk_meta entries'
);

for (let i = 0; i < chunkIds.length; i += 1) {
  assert.equal(sqliteChunkIds[i], chunkIds[i], `chunk_id mismatch at index ${i}`);
}

console.log('chunk-id backend parity test passed');

async function loadChunkMeta(indexDir) {
  const jsonPath = path.join(indexDir, 'chunk_meta.json');
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(await fsPromises.readFile(jsonPath, 'utf8'));
  }
  const jsonlPath = path.join(indexDir, 'chunk_meta.jsonl');
  if (fs.existsSync(jsonlPath)) {
    const raw = await fsPromises.readFile(jsonlPath, 'utf8');
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  }
  const metaPath = path.join(indexDir, 'chunk_meta.meta.json');
  if (fs.existsSync(metaPath)) {
    const metaRaw = JSON.parse(await fsPromises.readFile(metaPath, 'utf8'));
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const parts = Array.isArray(meta?.parts) ? meta.parts : [];
    const entries = [];
    for (const relPath of parts) {
      const pathValue = typeof relPath === 'string' ? relPath : relPath?.path;
      if (!pathValue) continue;
      const absPath = path.join(indexDir, pathValue.split('/').join(path.sep));
      if (!fs.existsSync(absPath)) continue;
      const raw = await fsPromises.readFile(absPath, 'utf8');
      raw.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => entries.push(JSON.parse(line)));
    }
    return entries;
  }
  throw new Error(`chunk_meta artifacts missing in ${indexDir}`);
}

