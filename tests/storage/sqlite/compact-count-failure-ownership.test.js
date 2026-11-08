import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// UNVALIDATED: tiny real SQLite build/compaction, original physical closure,
// query-boundary failures and unchanged source bytes before failed staging.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['pragma-failure', 'count-failure', 'pending-count', 'invalid-count', 'dense-missing', 'required-missing', 'dense-empty', 'healthy'].includes(selected));
const fixture = await setupSqliteBuildFixture({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  tempLabel: `compact-count-${selected}`, chunkCount: 3, fileCount: 1 });
const { Database, outPath } = fixture;
const prepare = Database.prototype.prepare, close = Database.prototype.close;
let settled = selected !== 'pending-count', sourceCloses = 0, failure;
const original = Object.freeze(Object.assign(new Error('Original SQLite count failure.'), {
  code: 'SQLITE_BUSY', ...(selected === 'pending-count' ? { cacheOwnershipPending: true,
    cacheOwnershipReleased() { assert.equal(this, original); return settled; } } : {})
}));
const missing = table => Object.assign(new Error(`no such table: ${table}`), { code: 'SQLITE_ERROR' });
if (selected === 'healthy') {
  const populate = new Database(outPath);
  try {
    for (const { id } of populate.prepare('SELECT id FROM chunks').all()) {
      populate.prepare('INSERT INTO dense_vectors(mode,doc_id,vector) VALUES (?,?,?)').run(fixture.mode, id, Buffer.from([1, 2]));
    }
  } finally { populate.close(); }
}
const sourceBytes = await fs.readFile(outPath);
try {
  Database.prototype.close = function (...args) {
    if (this.name === outPath) sourceCloses++; return close.apply(this, args);
  };
  Database.prototype.prepare = function (sql, ...args) {
    if (selected === 'pragma-failure' && sql === 'PRAGMA table_info(chunks)') throw original;
    if (/^SELECT COUNT\(\*\) AS total FROM chunks\b/u.test(sql)) {
      if (['count-failure', 'pending-count'].includes(selected)) throw original;
      if (selected === 'required-missing') throw missing('chunks');
      if (selected === 'invalid-count') return { get: () => ({ total: -1 }) };
    }
    if (selected === 'dense-missing' && /^SELECT COUNT\(\*\) AS total FROM dense_vectors\b/u.test(sql)) throw missing('dense_vectors');
    return prepare.call(this, sql, ...args);
  };
  const run = () => compactDatabase({ dbPath: outPath, mode: fixture.mode, vectorExtension: { enabled: false },
    logger: { log() {}, warn() {}, error(message) { throw new Error(message); } } });
  if (['healthy', 'dense-empty'].includes(selected)) {
    assert.deepEqual(await run(), { skipped: false });
  } else {
    await assert.rejects(run(), error => { failure = error; return true; });
    if (['pragma-failure', 'count-failure', 'pending-count'].includes(selected)) assert.equal(errorGraphIncludes(failure, original), true);
    if (selected === 'invalid-count') assert.equal(failure.code, 'ERR_SQLITE_COMPACTION_COUNT');
    assert.equal(sourceCloses, 1, 'actual source handle closes exactly once after the original failed query');
    assert.deepEqual(await fs.readFile(outPath), sourceBytes);
    assert.equal((await fs.readdir(path.dirname(outPath))).some(name => name.includes('.compact-')), false);
    settled = true;
    await failure.nativeDatabaseLifetime?.recoverStorageMetadata();
    assert.equal(sourceCloses, 1, 'metadata recovery cannot repeat physical close');
  }
  Database.prototype.prepare = prepare; Database.prototype.close = close;
  const readback = new Database(outPath, { readonly: true });
  try {
    assert.equal(readback.prepare('SELECT COUNT(*) AS total FROM chunks').get().total, 3);
    assert.equal(readback.prepare('SELECT COUNT(*) AS total FROM dense_vectors').get().total, selected === 'healthy' ? 3 : 0);
  }
  finally { readback.close(); }
} finally {
  settled = true; Database.prototype.prepare = prepare; Database.prototype.close = close;
  if (failure?.nativeDatabaseLifetime) await failure.nativeDatabaseLifetime.recoverStorageMetadata();
  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
}
console.log(`SQLite compaction count ownership: ${selected}`);
