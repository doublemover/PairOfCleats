#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getIndexDir, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-search-finally-'));
applyTestEnv({ cacheRoot: path.join(temp, 'cache') });
const { runSearchCli } = await import('../../../src/retrieval/cli/run-search/plan-runner.js');
const repo = path.join(temp, 'repo');
const userConfig = { cache: { root: path.join(temp, 'cache') } };
await fs.mkdir(repo, { recursive: true });
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(userConfig));
const dbPath = resolveSqlitePaths(repo, userConfig).codePath;
await fs.mkdir(path.dirname(dbPath), { recursive: true });
// SQLite supplies query rows, but strict retrieval still requires the normal
// file-side manifest and compatibility identity. Use the shared fixture writer.
const indexDir = getIndexDir(repo, 'code', userConfig);
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]');
await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }
], { compatibilityKey: 'backend-lifecycle-fixture' });
const writer = new Database(dbPath);
writer.exec(CREATE_TABLES_SQL);
writer.pragma(`user_version = ${SCHEMA_VERSION}`);
writer.prepare('INSERT INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)').run('code', 1, 0);
writer.close();

const originalPrepare = Database.prototype.prepare;
let initialized = new Set();
Database.prototype.prepare = function (sql, ...args) {
  if (this.name === dbPath && sql === "SELECT name FROM sqlite_master WHERE type='table'") initialized.add(this);
  return originalPrepare.call(this, sql, ...args);
};
const args = ['needle', '--repo', repo, '--mode', 'code', '--backend', 'sqlite', '--no-ann', '--json'];
const assertReleased = () => {
  assert.ok(initialized.size > 0, 'the fixture must reach actual backend initialization');
  for (const db of initialized) assert.equal(db.open, false, 'request finally must release every uncached backend');
};
const makePlanCache = (reset = () => {}, enabled = true) => ({
  enabled,
  resetIfConfigChanged: reset,
  get: () => null,
  set: () => {},
  persist: async () => { assertReleased(); }
});

try {
  const result = await runSearchCli(args, {
    emitOutput: false, exitOnError: false, queryPlanCache: makePlanCache(() => {}, false)
  });
  assert.ok(result && typeof result === 'object', 'empty SQLite search should still return a normal payload');
  assertReleased();

  initialized = new Set();
  const failure = new Error('synthetic post-backend query planning failure');
  await assert.rejects(runSearchCli(args, {
    emitOutput: false, exitOnError: false,
    queryPlanCache: makePlanCache(() => { throw failure; })
  }), (error) => error === failure);
  assertReleased();

  initialized = new Set();
  const controller = new AbortController();
  await assert.rejects(runSearchCli(args, {
    emitOutput: false, exitOnError: false, signal: controller.signal,
    queryPlanCache: makePlanCache(() => controller.abort())
  }), (error) => error?.code === ERROR_CODES.CANCELLED && error.cancelled === true);
  assertReleased();
} finally {
  Database.prototype.prepare = originalPrepare;
  for (const db of initialized) if (db.open) db.close();
  await fs.rm(temp, { recursive: true, force: true });
}

console.log('search backend finally cleanup test passed');
