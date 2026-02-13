#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { buildSqliteIndex } from '../../src/integrations/core/index.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { loadUserConfig } from '../../tools/shared/dict-utils.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-snapshot-service');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.cp(fixtureRoot, repoRoot, { recursive: true });

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
process.env.PAIROFCLEATS_WORKER_POOL = 'off';
process.env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify({
  indexing: {
    embeddings: {
      enabled: false,
      mode: 'off',
      lancedb: { enabled: false },
      hnsw: { enabled: false }
    }
  }
});

const markerPath = path.join(repoRoot, 'src', 'phase14-sqlite-snapshot.js');
await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, 'export const phase14_sqlite_marker = "phase14alpha";\n', 'utf8');

const runBuild = () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'build_index.js'),
      '--repo',
      repoRoot,
      '--mode',
      'code',
      '--stub-embeddings',
      '--no-sqlite',
      '--progress',
      'off'
    ],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`build_index failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
};

runBuild();

const userConfig = loadUserConfig(repoRoot);
const snapshotA = 'snap-20260212000000-sqlita';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotA
});

await fs.writeFile(markerPath, 'export const phase14_sqlite_marker = "phase14beta";\n', 'utf8');
runBuild();

const outDir = path.join(tempRoot, 'sqlite-out');
const sqliteResult = await buildSqliteIndex(repoRoot, {
  mode: 'code',
  snapshot: snapshotA,
  out: outDir,
  emitOutput: false
});

assert.equal(sqliteResult.ok, true, 'sqlite build should succeed');
const sqliteCandidates = [
  sqliteResult.outPath,
  sqliteResult.outputPaths?.code,
  path.join(outDir, 'index-code.db')
].filter((value) => typeof value === 'string' && value.length > 0);
let dbPath = sqliteCandidates.find((candidate) => fsSync.existsSync(candidate)) || null;
if (!dbPath) {
  const discovered = await fs.readdir(tempRoot, { recursive: true });
  const firstDb = discovered.find((entry) => typeof entry === 'string' && entry.endsWith('index-code.db'));
  if (firstDb) dbPath = path.join(tempRoot, firstDb);
}
assert.ok(dbPath, 'sqlite build should produce an index-code.db output');

const db = new Database(dbPath, { readonly: true });
const alphaCount = db.prepare(
  `SELECT COUNT(*) AS total FROM chunks WHERE mode = 'code' AND file = 'src/phase14-sqlite-snapshot.js' AND tokens LIKE '%alpha%'`
).get().total;
const betaCount = db.prepare(
  `SELECT COUNT(*) AS total FROM chunks WHERE mode = 'code' AND file = 'src/phase14-sqlite-snapshot.js' AND tokens LIKE '%beta%'`
).get().total;
db.close();

assert.ok(alphaCount > 0, 'sqlite build with snapshot A should include alpha marker');
assert.equal(betaCount, 0, 'sqlite build with snapshot A should not include beta marker from latest build');

console.log('sqlite build snapshot service test passed');
