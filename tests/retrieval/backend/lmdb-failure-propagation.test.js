import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { open, allDbs } from 'lmdb';
import { Packr } from 'msgpackr';
import { createLmdbBackend } from '../../../src/retrieval/cli-lmdb.js';
import { createBackendContext } from '../../../src/retrieval/cli/backend-context.js';
import { createBackendContextWithTracking } from '../../../src/retrieval/cli/run-search/backend-context.js';
import { closeLmdbDatabase } from '../../../src/storage/lmdb/close.js';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('lmdb-failure-propagation/')[1];
assert.ok(['lmdb-initialization', 'context-initialization', 'tracking', 'dispose-siblings'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`lmdb-failure-${selected}`);
const code = path.join(dir, 'code'), prose = path.join(dir, 'prose'), packr = new Packr();
for (const [store, mode] of [[code, 'code'], [prose, 'prose']]) {
  const db = open({ path: store, mapSize: 1024 * 1024 });
  try {
    db.putSync(LMDB_META_KEYS.schemaVersion, packr.pack(LMDB_SCHEMA_VERSION));
    db.putSync(LMDB_META_KEYS.mode, packr.pack(mode));
  } finally { await closeLmdbDatabase(db, db.close); }
}
const primary = Object.freeze(new Error('controlled original initialization/tracking failure'));
const native = Object.freeze(Object.assign(new Error('controlled native LMDB close refusal'), { code: 'EIO' }));
const setDescriptor = Object.getOwnPropertyDescriptor(allDbs, 'set'), originalSet = allDbs.set;
const exists = fs.existsSync, originals = new Map(), calls = new Map();
allDbs.set = function (key, db) {
  if ([path.basename(code), path.basename(prose)].includes(key)) {
    const original = db.close;
    originals.set(db, original);
    db.close = function (callback) {
      calls.set(db, (calls.get(db) || 0) + 1);
      if (key === path.basename(code)) throw native;
      return original.call(this, callback);
    };
  }
  return originalSet.call(this, key, db);
};
if (selected === 'lmdb-initialization') fs.existsSync = function (target) {
  if (target === prose) throw primary;
  return exists.call(this, target);
};
const contains = (root, expected) => {
  const pending = [root], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); pending.push(value.cause, ...(value instanceof AggregateError ? value.errors : []));
  }
  return false;
};
try {
  const lmdb = { useLmdb: true, needsCode: true, needsProse: selected === 'lmdb-initialization' || selected === 'dispose-siblings',
    lmdbCodePath: code, lmdbProsePath: prose, backendForcedLmdb: true };
  const contextInput = { ...lmdb, useSqlite: false, root: dir, userConfig: { cache: { root: path.join(dir, 'cache') } },
    postingsConfig: selected === 'context-initialization' ? { get chargramMaxTokenLength() { throw primary; } } : {},
    indexResolveOptions: { explicitRef: true, indexDirByMode: { code: dir } } };
  let failure;
  if (selected === 'dispose-siblings') {
    const backend = await createLmdbBackend(lmdb);
    const closing = backend.dispose();
    assert.equal(backend.dispose(), closing);
    await assert.rejects(closing, error => { failure = error; return true; });
    await assert.rejects(backend.dispose(), error => error === failure);
    assert.equal(backend.dbCode.status, 'open');
    assert.equal(backend.dbProse.status, 'closed', 'healthy sibling closes despite the other native failure');
  } else {
    const operation = selected === 'lmdb-initialization' ? createLmdbBackend(lmdb)
      : selected === 'context-initialization' ? createBackendContext(contextInput)
        : createBackendContextWithTracking({ contextInput, stageTracker: { mark: () => 0, record: () => { throw primary; } } });
    await assert.rejects(operation, error => { failure = error; return true; });
    assert.equal(failure.cause, primary, 'the exact original operation failure remains primary');
    assert.equal(Object.hasOwn(primary, 'cacheOwnershipPending'), false, 'frozen operation failure is not mutated');
  }
  assert.equal(contains(failure, native), true, 'native cleanup failure remains reachable through the actual caller');
  assert.equal(failure.cacheOwnershipReleased(), false);
  for (const count of calls.values()) assert.equal(count, 1, 'parent aggregation does not retry native closure');
} finally {
  fs.existsSync = exists;
  if (setDescriptor) Object.defineProperty(allDbs, 'set', setDescriptor); else delete allDbs.set;
  for (const [db, original] of originals) if (db.status !== 'closed') await closeLmdbDatabase(db, original);
}
console.log(`Actual LMDB ${selected} preserves the original error, failed native lifetime and independent cleanup.`);
