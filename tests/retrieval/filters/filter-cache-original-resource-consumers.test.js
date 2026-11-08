import assert from 'node:assert/strict';
import { createOwnershipObservation } from '../../helpers/ownership-observation.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readFilterMatchPage, persistFilterMatches } from '../../../src/retrieval/pipeline/filter-enumeration-cache.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { filterRepresentationIdentity } from '../../../src/retrieval/pipeline/filter-enumeration.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { createSqliteFilterFactWriter, sealSqliteFilterFacts } from '../../../src/storage/sqlite/filter-facts.js';
import { readSqliteFilterFactPage } from '../../../src/retrieval/sqlite-filter-page.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['key-admission', 'key-read', 'key-close', 'payload-admission', 'payload-read', 'payload-close', 'persist-key', 'sqlite-fallback',
  'cancelled-key-read', 'cancelled-payload-read', 'sqlite-no-fallback'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`filter-original-resource-${selected}`);
const enumeration = { generation: 'original-generation', request: 'original-request', modifiedAfter: 0,
  offsets: { code: 0 }, filters: {}, cacheDir: dir };
const identity = filterRepresentationIdentity(enumeration, 'code'), ids = Uint32Array.from([0, 1]);
const originalOpen = fsp.open, originalStat = fs.fstatSync;
const descriptors = new Set(); let fault = null, allowClose = false, opens = 0, closes = 0, reads = 0, failure;
const primary = Object.freeze(new Error('original descriptor admission/read rejected'));
const secondary = Object.freeze(new Error('original descriptor close remains unconfirmed'));
const controller = new AbortController(), cancellation = Object.freeze(new Error('original filter request cancelled'));
const graph = error => {
  const queue = [error], seen = new Set(), result = [];
  while (queue.length) {
    const value = queue.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); result.push(value); queue.push(value.cause, value.workerError, ...(value.errors || []));
  }
  return result;
};
let db;
const observation = createOwnershipObservation(() => ({ opens, closes, reads, liveTrackedDescriptors: descriptors.size }));
try {
  assert.equal(await persistFilterMatches({ cacheDir: dir, identity, rowCount: 2, ids,
    metadata: [{ id: 0, file: 'one.js' }, { id: 1, file: 'two.js' }] }), true);
  const cache = path.join(dir, 'filter-enumeration-v1');
  const payload = path.join(cache, (await fsp.readdir(cache)).find(name => name.endsWith('.bin')));
  const key = path.join(cache, 'key'), originalPayload = await fsp.readFile(payload), originalKey = await fsp.readFile(key);
  const target = selected.includes('payload-') ? payload : key;
  const phase = selected.split('-').at(-1);
  fsp.open = async (filename, ...options) => {
    const handle = await originalOpen(filename, ...options);
    if (path.resolve(filename) !== target || !fault) return handle;
    opens++; descriptors.add(handle); observation.mark('original-descriptor-admitted'); const close = handle.close.bind(handle), read = handle.read.bind(handle);
    handle.read = async (...args) => {
      reads++; observation.mark('original-read-started');
      if (phase === 'read') {
        if (selected.startsWith('cancelled-')) { observation.mark('abort-requested'); controller.abort(cancellation); }
        throw primary;
      }
      return read(...args);
    };
    handle.close = async () => { closes++; observation.mark('original-close-started'); if (!allowClose) throw secondary; await close(); descriptors.delete(handle); observation.mark('original-close-confirmed'); };
    return handle;
  };
  fs.fstatSync = (fd, ...options) => {
    if (fault && phase === 'admission' && [...descriptors].some(handle => handle.fd === fd)) throw primary;
    return originalStat(fd, ...options);
  };
  fault = true;
  const request = { cacheDir: dir, identity, rowCount: 2, offset: 0, limit: 1, includeRows: true,
    throwIfAborted: () => controller.signal.throwIfAborted() };
  let work;
  if (selected === 'persist-key') work = persistFilterMatches({ cacheDir: dir, identity, rowCount: 2, ids });
  else if (selected === 'sqlite-fallback' || selected === 'sqlite-no-fallback') {
    db = new Database(':memory:'); db.exec('CREATE TABLE chunks(id INTEGER PRIMARY KEY,mode TEXT NOT NULL)');
    const put = createSqliteFilterFactWriter(db);
    for (let id = 0; id < 2; id++) { db.prepare('INSERT INTO chunks VALUES (?,?)').run(id, 'code'); put({ id, mode: 'code', file: `${id}.js` }); }
    assert.equal(sealSqliteFilterFacts(db, 'code'), true);
    let factReads = 0, fallbackReads = 0;
    const indexCache = new Map(); indexCache.get = () => { fallbackReads++; return null; };
    const loader = createIndexBackendLoader({ rootDir: dir, userConfig: {}, filterOnly: true,
      filterEnumeration: enumeration, filterTopN: 1, requiredArtifacts: new Set(), indexCache,
      loadIndexFromSqlite: () => ({ chunkMeta: new Array(2), loadFilterFactPage: async () => {
        factReads++; return readSqliteFilterFactPage({ db, mode: 'code', rowCount: 2, limit: 1 });
      } }) });
    work = loader.loadModeIndex({ mode: 'code', run: true, dir, backend: 'sqlite', allowSqliteFallback: selected === 'sqlite-fallback' });
    work = work.finally(() => { assert.equal(factReads, 0); assert.equal(fallbackReads, 0); });
  } else work = readFilterMatchPage(request);
  await assert.rejects(work, error => { failure = error; observation.mark('public-failure'); return true; });
  assert.ok(errorGraphIncludes(failure, secondary), 'ordinary cache miss/fallback cannot erase an unconfirmed original close');
  if (phase === 'admission' || phase === 'read') assert.ok(errorGraphIncludes(failure, primary));
  if (selected.startsWith('cancelled-')) assert.ok(errorGraphIncludes(failure, cancellation));
  const values = graph(failure), session = values.map(getContainedFileSession).find(Boolean);
  assert.ok(session); assert.equal(session.isSettled(), false); observation.mark('pending-original-session-observed', { pendingSessions: 1 }); assert.equal(opens, 1); assert.equal(closes, 1);
  const readCount = reads; allowClose = true; fault = false;
  observation.mark('original-recovery-requested'); await session.releaseAfterClose(); observation.mark('original-session-settled', { pendingSessions: 0 }); assert.equal(session.isSettled(), true); assert.equal(closes, 2); assert.equal(reads, readCount);
  for (const value of values) await value.fileLockPublicationSession?.releaseAfterClose();
  assert.deepEqual(await fsp.readFile(key), originalKey); assert.deepEqual(await fsp.readFile(payload), originalPayload);
  const healthyRequest = { ...request, throwIfAborted: undefined };
  const page = await readFilterMatchPage(healthyRequest); assert.deepEqual([...page.ids], [0]); assert.equal(page.total, 2);
  const corrupt = Buffer.from(originalPayload); corrupt[corrupt.length - 1] ^= 1; await fsp.writeFile(payload, corrupt);
  assert.equal(await readFilterMatchPage({ ...healthyRequest, limit: 2 }), null, 'settled corrupt payload remains an optional miss');
  await fsp.writeFile(payload, originalPayload); await fsp.unlink(key);
  assert.equal(await readFilterMatchPage(healthyRequest), null, 'settled absent key remains a miss');
  assert.equal(await persistFilterMatches({ cacheDir: dir, identity, rowCount: 2, ids }), true);
} finally {
  allowClose = true; fault = false;
  if (failure) for (const value of graph(failure)) {
    await getContainedFileSession(value)?.releaseAfterClose().catch(() => {});
    await value.fileLockPublicationSession?.releaseAfterClose().catch(() => {});
  }
  fsp.open = originalOpen; fs.fstatSync = originalStat; db?.close();
  for (const handle of descriptors) await handle.close().catch(() => {});
  await fsp.rm(dir, { recursive: true, force: true });
}
observation.mark('fixture-cleanup-completed');
await observation.publish({ selected, tracking: 'injected target key-or-payload descriptors only;native database and unrelated file IO excluded', scope: 'actual key/payload failure and original close-only recovery; no injected delay or production fallback after pending ownership' });
console.log('Filter cache key/payload/persistence and SQLite fallback preserve the actual original descriptor owner.');
