#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

// Replace the CJS module behind Piscina's ESM wrapper before loading the build
// module. This exercises its real loader ownership without starting workers.
const require = createRequire(import.meta.url);
const piscinaPath = require.resolve('piscina');
const previousPiscina = require.cache[piscinaPath];
const pools = [];
let poolFailure = null;
const bundle = { chunks: [{ file: 'sample.js', start: 0, end: 1, tokens: ['sample'] }] };
class FakePiscina {
  constructor() {
    if (poolFailure) throw poolFailure;
    this.closeCount = 0;
    this.runCount = 0;
    pools.push(this);
  }
  async run() {
    this.runCount += 1;
    return { ok: true, bundle };
  }
  async destroy() {
    this.closeCount += 1;
  }
}
require.cache[piscinaPath] = { id: piscinaPath, filename: piscinaPath, loaded: true, exports: FakePiscina };
let openSqliteBuildDatabase;
let buildDatabaseFromBundles;
try {
  assert.equal((await import('piscina')).default, FakePiscina, 'worker stub must be active before any build');
  ({ openSqliteBuildDatabase } = await import('../../../../src/storage/sqlite/build/core.js'));
  ({ buildDatabaseFromBundles } = await import('../../../../src/storage/sqlite/build/from-bundles.js'));
} finally {
  if (previousPiscina) require.cache[piscinaPath] = previousPiscina;
  else delete require.cache[piscinaPath];
}

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('sqlite-build-startup-lifecycle');
const bundlePath = path.join(tempRoot, 'bundle.json');
await fs.writeFile(bundlePath, JSON.stringify(bundle));
const failures = [];

const runCase = async ({ name, direct = false, failureAt = null, closeFailure = false, buildPragmas = false }) => {
  const failure = new Error(`injected ${name} failure`);
  const handles = [];
  const closeCounts = new Map();
  const pragmaCalls = [];
  const poolStart = pools.length;
  let injected = false;
  const inject = (stage) => {
    if (failureAt !== stage) return;
    injected = true;
    throw failure;
  };
  const outPath = path.join(tempRoot, `${name}.db`);
  function TrackingDatabase(filePath) {
    inject('open');
    const db = new Database(filePath);
    handles.push(db);
    const pragma = db.pragma.bind(db);
    const exec = db.exec.bind(db);
    const prepare = db.prepare.bind(db);
    const close = db.close.bind(db);
    db.pragma = (sql, ...args) => {
      pragmaCalls.push(sql);
      if (sql === 'page_size') inject('pragma');
      if (sql.startsWith('user_version =')) inject('version');
      return pragma(sql, ...args);
    };
    db.exec = (sql, ...args) => {
      if (sql.includes('CREATE TABLE')) inject('schema');
      return exec(sql, ...args);
    };
    db.prepare = (sql, ...args) => {
      if (sql.includes('INTO chunks (')) inject('prepare');
      return prepare(sql, ...args);
    };
    db.close = () => {
      closeCounts.set(db, (closeCounts.get(db) || 0) + 1);
      close();
      if (closeFailure) throw new Error('injected secondary close failure');
    };
    return db;
  }
  const run = async () => {
    if (direct) return openSqliteBuildDatabase({ Database: TrackingDatabase, outPath, useBuildPragmas: buildPragmas });
    if (failureAt === 'pool') poolFailure = failure;
    return buildDatabaseFromBundles({
      Database: TrackingDatabase,
      outPath,
      mode: 'code',
      incrementalData: {
        manifest: { files: { 'sample.js': { bundles: ['bundle.json'], hash: 'sample', mtimeMs: 1, size: 1 } } },
        bundleDir: tempRoot
      },
      envConfig: { bundleThreads: 2 },
      threadLimits: { fileConcurrency: 1 },
      workerPath: 'stub-worker-never-started.js',
      modelConfig: { id: null },
      vectorConfig: { enabled: false },
      emitOutput: failureAt === 'log',
      logger: { log(message) { if (message.includes('Bundle parser workers:')) inject('log'); } },
      validateMode: 'off',
      buildPragmas,
      optimize: false
    });
  };
  try {
    let result;
    if (failureAt) {
      await assert.rejects(run, (error) => error === failure, `${name}: preserve startup error`);
      assert.equal(injected || failureAt === 'pool', true, `${name}: reach the failure injection`);
    } else {
      result = await run();
      if (direct) {
        assert.equal(result.db.open, true, 'successful helper transfers ownership to caller');
        assert.equal(closeCounts.has(result.db), false, 'successful helper must not close transferred handle');
        result.db.close();
      } else {
        assert.equal(result.count, 1, 'successful bundle build inserts one real SQLite chunk');
        const reader = new Database(outPath, { readonly: true });
        try {
          assert.equal(reader.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
        } finally {
          reader.close();
        }
      }
    }
    assert.equal(handles.length, failureAt === 'open' ? 0 : 1, `${name}: expected acquired handle count`);
    for (const db of handles) {
      assert.equal(closeCounts.get(db), 1, `${name}: close each owned database exactly once`);
      assert.equal(db.open, false, `${name}: no retained database`);
    }
    if (buildPragmas && failureAt) {
      const applied = pragmaCalls.indexOf('locking_mode = EXCLUSIVE');
      assert.ok(applied >= 0 && pragmaCalls.indexOf('locking_mode = normal') > applied,
        `${name}: restore acquired pragma state before close`);
    }
    const createdPools = pools.slice(poolStart);
    if (direct || ['open', 'pragma', 'schema', 'version', 'prepare', 'pool'].includes(failureAt)) {
      assert.equal(createdPools.length, 0, `${name}: defer workers until setup succeeds`);
    } else {
      assert.equal(createdPools.length, 1, `${name}: exactly one stub worker pool`);
      assert.equal(createdPools[0].runCount, failureAt === 'log' ? 0 : 1);
      assert.equal(createdPools[0].closeCount, 1, `${name}: close worker pool exactly once`);
    }
  } finally {
    poolFailure = null;
    for (const db of handles) {
      if (db.open) Database.prototype.close.call(db);
    }
  }
};

try {
  const cases = [
    ...['pragma', 'schema', 'version'].map((failureAt) => ({ name: `direct-${failureAt}`, direct: true, failureAt })),
    { name: 'direct-secondary-close', direct: true, failureAt: 'schema', closeFailure: true },
    { name: 'direct-schema-restore', direct: true, failureAt: 'schema', buildPragmas: true },
    { name: 'direct-success', direct: true },
    ...['open', 'schema', 'prepare', 'pool', 'log'].map((failureAt) => ({ name: `bundle-${failureAt}`, failureAt })),
    { name: 'bundle-success' }
  ];
  for (const testCase of cases) {
    try {
      await runCase(testCase);
    } catch (error) {
      failures.push({ name: testCase.name, message: error.message });
    }
  }
  assert.deepEqual(failures, [], 'all SQLite startup ownership cases must pass');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite build startup lifecycle test passed');
