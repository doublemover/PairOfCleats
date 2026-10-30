import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { runSearchCli } from '../../../src/retrieval/cli/run-search/plan-runner.js';
import { getIndexDir, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/cli/search-publication-settlement/')[1];
assert.ok(['close-failure', 'work-and-close', 'close-result-pending', 'cache-resource-pending', 'ordinary-cache-miss', 'success'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`search-publication-${selected}`);
const repo = path.join(dir, 'repository'), cacheRoot = path.join(dir, 'cache');
await fs.mkdir(repo); applyTestEnv({ cacheRoot, syncProcess: true, embeddings: 'off' });
const config = { cache: { root: cacheRoot } };
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(config));
const dbPath = resolveSqlitePaths(repo, config).codePath, index = getIndexDir(repo, 'code', config);
await fs.mkdir(path.dirname(dbPath), { recursive: true }); await fs.mkdir(index, { recursive: true });
await fs.writeFile(path.join(index, 'chunk_meta.json'), '[]');
await fs.writeFile(path.join(index, 'index_state.json'), JSON.stringify({
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, compatibilityKey: 'search-settlement', mode: 'code'
}));
await writePiecesManifest(index, [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
  { name: 'index_state', path: 'index_state.json', format: 'json' }], { compatibilityKey: 'search-settlement' });
const writer = new Database(dbPath);
writer.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(writer); writer.pragma(`user_version = ${SCHEMA_VERSION}`);
writer.prepare('INSERT INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)').run('code', 1, 0); writer.close();
const cleanup = Object.freeze(Error('original physical close result failed'));
const work = Object.freeze(Error('original query planning failed'));
let resourceReleased = false, closeCalls = 0, persistCalls = 0;
const pending = Object.freeze(Object.assign(Error('original independent pending resource'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => resourceReleased
}));
const handles = new Set(), nativeClose = Database.prototype.close, nativePrepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql, ...args) {
  if (this.name === dbPath) handles.add(this);
  return nativePrepare.call(this, sql, ...args);
};
Database.prototype.close = function (...args) {
  if (this.name !== dbPath) return nativeClose.apply(this, args);
  closeCalls++; const result = nativeClose.apply(this, args);
  if (['close-failure', 'work-and-close'].includes(selected)) throw cleanup;
  if (selected === 'close-result-pending') return pending;
  return result;
};
const output = [], write = process.stdout.write;
process.stdout.write = text => { output.push(String(text)); return true; };
try {
  const cache = { enabled: true, resetIfConfigChanged() { if (selected === 'work-and-close') throw work; },
    get: () => null, set: () => {}, async persist() {
      persistCalls++; assert.ok(handles.size > 0);
      for (const db of handles) assert.equal(db.open, false, 'physical backend cleanup precedes plan-cache work');
      if (selected === 'cache-resource-pending') throw pending;
      if (selected === 'ordinary-cache-miss') throw Error('optional cache persistence miss');
    } };
  let result, failure;
  try { result = await runSearchCli(['needle', '--repo', repo, '--mode', 'code', '--backend', 'sqlite', '--no-ann', '--json'],
    { emitOutput: true, exitOnError: false, queryPlanCache: cache }); }
  catch (error) { failure = error; }
  assert.ok(handles.size > 0, 'actual SQLite backend initialization is required');
  assert.equal(closeCalls, handles.size, 'each actual native close is invoked once');
  for (const db of handles) assert.equal(db.open, false);
  assert.equal(persistCalls, 1, 'independent cache work is attempted once even after close failure');
  const published = JSON.parse(output.join('').trim());
  if (['success', 'ordinary-cache-miss'].includes(selected)) {
    assert.equal(failure, undefined); assert.equal(result.backend, 'sqlite');
    assert.equal(published.backend, 'sqlite'); assert.deepEqual(published.code, []);
  } else {
    assert.equal(result, undefined); assert.ok(failure);
    assert.equal(published.ok, false, 'cleanup failure cannot publish successful search output first');
    assert.equal(published.backend, undefined);
    if (['close-failure', 'work-and-close'].includes(selected)) assert.ok(errorGraphIncludes(failure, cleanup));
    if (selected === 'work-and-close') assert.ok(errorGraphIncludes(failure, work));
    if (selected.endsWith('pending')) assert.equal(failure.cacheOwnershipReleased(), false);
  }
  resourceReleased = true;
} finally {
  process.stdout.write = write;
  Database.prototype.prepare = nativePrepare; Database.prototype.close = nativeClose;
  for (const db of handles) if (db.open) nativeClose.call(db);
}
console.log(`Actual SQLite search publication and cleanup settlement: ${selected}`);
