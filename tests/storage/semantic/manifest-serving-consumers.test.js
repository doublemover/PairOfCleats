import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { createSemanticDetailRunner } from '../../../src/integrations/tooling/semantic-detail.js';
import { createSemanticFindRunner } from '../../../src/integrations/tooling/semantic-find.js';
import { createSemanticExplainRunner } from '../../../src/integrations/tooling/semantic-explain.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { openSemanticQueryStore } from '../../../src/semantic/query-store.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';

const consumer = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/manifest-serving-consumers/')[1];
assert.ok(['detail', 'find-artifact', 'explain-artifact', 'find-sqlite', 'explain-sqlite'].includes(consumer));
const fixture = await createSemanticServingFixture({ withOperands: true, withTraceEdge: true });
const originalOpen = fs.open, originalLstat = nativeFs.lstatSync;
const held = new Map(), names = ['semantic_manifest', 'semantic_query_index', 'semantic_operation_index'];
const files = names.map(name => path.join(fixture.indexDir, name + '.json'));
const external = path.join(fixture.root, 'outside-metadata.json');
const scope = { repoRoot: fixture.root, generation: fixture.generation };
const backend = consumer.endsWith('sqlite') ? 'sqlite' : 'artifact';
const request = consumer === 'detail' ? { ...scope, refs: [fixture.ref], include: ['operands', 'names', 'ownership'] }
  : consumer.startsWith('find') ? { ...scope, backend, selector: { field: 'astKind', value: 'Identifier' } }
    : { ...scope, backend, seed: fixture.ref, direction: 'downstream', kinds: ['flowsTo'] };
let constructed = 0, admitted = null, healthyView = null;
const actualOpen = consumer === 'detail' ? openPublishedSemanticStore : openSemanticQueryStore;
const create = consumer === 'detail' ? createSemanticDetailRunner
  : consumer.startsWith('find') ? createSemanticFindRunner : createSemanticExplainRunner;
const run = create({ openStore: async options => {
  const opened = await actualOpen(options); constructed++; admitted = structuredClone(opened.manifest); return opened;
} });
const execute = signal => run(request, { signal, userConfig: {} });
const assertHealthy = result => {
  assert.ok(result.records.length > 0, consumer);
  const view = Object.fromEntries(['generation', 'status', 'records', 'edges', 'operands', 'ownership', 'names', 'coverage', 'warnings']
    .filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]]));
  if (healthyView === null) healthyView = structuredClone(view);
  else assert.deepEqual(view, healthyView, 'valid snapshot preserves real records, coverage, ordering and request scope');
};
const graphHas = (error, expected) => {
  const seen = new Set(), pending = [error];
  while (pending.length) { const value = pending.pop(); if (value === expected) return true;
    if (!value || seen.has(value)) continue; seen.add(value);
    if (value.cause) pending.push(value.cause); if (value.errors) pending.push(...value.errors); }
  return false;
};
const install = ({ target = null, beforeOpen = null, afterRead = null, close = null, short = false,
  prematureEof = false, redirect = false } = {}) => {
  const states = [];
  fs.open = async (filename, ...args) => {
    const resolved = path.resolve(String(filename));
    if (beforeOpen) await beforeOpen(resolved);
    const actual = redirect && resolved === target ? external : filename;
    const handle = await originalOpen(actual, ...args);
    if (!files.includes(resolved)) return handle;
    const read = handle.read.bind(handle), nativeClose = handle.close.bind(handle);
    const state = { filename: resolved, actual: path.resolve(String(actual)), handle, reads: 0, bytes: 0, windows: [], closes: 0 };
    states.push(state); held.set(handle, nativeClose);
    handle.read = async (buffer, offset, length, position) => {
      state.reads++; state.windows.push(length);
      const value = prematureEof && resolved === target ? { bytesRead: 0, buffer }
        : await read(buffer, offset, short && resolved === target ? Math.min(4096, length) : length, position);
      state.bytes += value.bytesRead;
      if (afterRead) await afterRead(state, value);
      return value;
    };
    handle.close = async () => {
      state.closes++;
      const finish = async () => { await nativeClose(); held.delete(handle); };
      return close ? close(state, finish) : finish();
    };
    return handle;
  };
  return states;
};
const originalStat = nativeFs.statSync;
const restore = async () => { fs.open = originalOpen; nativeFs.lstatSync = originalLstat; nativeFs.statSync = originalStat; await fixture.restore(); };
const assertClosed = states => { for (const state of states) {
  assert.equal(state.handle.fd, -1); assert.equal(state.closes, 1);
  assert.ok(state.windows.every(bytes => bytes <= 65536));
} };
const reject = async (states, predicate = () => true, signal = null) => {
  const before = constructed;
  await assert.rejects(execute(signal), predicate);
  assert.equal(constructed, before, 'hostile metadata cannot publish a usable store to the real service');
  assertClosed(states);
};
try {
  if (backend === 'sqlite') {
    const opened = await openPublishedSemanticStore({ indexDir: fixture.indexDir, repoRoot: fixture.root,
      generation: fixture.generation, requireQueryIndex: true });
    const directory = path.join(path.dirname(fixture.indexDir), 'index-sqlite'); await fs.mkdir(directory);
    const db = new Database(path.join(directory, 'index-code.db'));
    try {
      db.exec(CREATE_SEMANTIC_TABLES_SQL); db.pragma('user_version = ' + SCHEMA_VERSION); writeSqliteIndexFormat(db);
      db.prepare('INSERT INTO index_format_meta VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
      db.exec('BEGIN'); await ingestSemanticPartition({ db, store: opened.store, descriptor: fixture.partition }); db.exec('COMMIT');
    } finally { db.close(); }
  }
  for (const [ordinal, target] of files.entries()) {
    const name = names[ordinal], original = fixture.originals.get(name);
    await fs.writeFile(external, original);
    for (const short of [false, true]) {
      const states = install({ target, short }); const result = await execute();
      assertHealthy(result); assert.deepEqual(admitted.warnings, ['A']);
      assert.equal(states.length, 3); assert.equal(new Set(states.map(state => state.filename)).size, 3);
      for (const state of states) assert.equal(state.bytes, fixture.originals.get(path.basename(state.filename, '.json')).length,
        'exactly one payload stream, without a second pathname hashing pass');
      assertClosed(states); await restore();
    }
    for (const fault of ['rewrite', 'replacement', 'growth', 'oversized', 'truncate', 'premature-eof', 'same-bytes-external', 'nested-link']) {
      let changed = false;
      if (fault === 'replacement') nativeFs.statSync = function (filename, ...args) {
        return originalStat.call(this, changed && path.resolve(String(filename)) === target ? target + '.replacement' : filename, ...args);
      };
      if (fault === 'oversized') await fs.truncate(target, 32 * 1024 * 1024 + 1);
      if (fault === 'nested-link') nativeFs.lstatSync = function (filename, ...args) {
        const stat = originalLstat.call(this, filename, ...args);
        return path.resolve(String(filename)) === fixture.indexDir
          ? Object.create(stat, { isSymbolicLink: { value: () => true } }) : stat;
      };
      const states = install({ target, prematureEof: fault === 'premature-eof', redirect: fault === 'same-bytes-external',
        afterRead: async state => {
          if (state.filename !== target || changed) return; changed = true;
          if (fault === 'rewrite') {
            const changedBytes = Buffer.from(original); changedBytes[changedBytes.length - 1] = 10;
            await fs.writeFile(target, changedBytes);
          } else if (fault === 'replacement') {
            // Retain the actual open FD while a fresh pathname observation
            // reports another actual inode; no unsupported Windows rename.
            const replacement = target + '.replacement'; await fs.writeFile(replacement, original);
            assert.notEqual(originalStat(target, { bigint: true }).ino, originalStat(replacement, { bigint: true }).ino);
          } else if (fault === 'growth') await fs.appendFile(target, ' ');
          else if (fault === 'truncate') await fs.truncate(target, 1);
        } });
      await reject(states, error => error.code === 'ERR_SEMANTIC_INTEGRITY');
      if (fault === 'same-bytes-external') assert.equal(states.find(state => state.filename === target)?.bytes, 0,
        'an escaped opened identity is refused before any outside payload bytes');
      if (fault === 'oversized') assert.equal(states.find(state => state.filename === target)?.reads, 0,
        'actual oversized extent is refused before allocation or payload I/O');
      await restore();
    }
    for (const phase of ['before', 'read', 'final-read', 'closed']) {
      const controller = new AbortController(); if (phase === 'before') controller.abort();
      const states = install({ target,
        afterRead: state => { if (state.filename === target && (phase === 'read'
          || phase === 'final-read' && state.bytes === original.length)) controller.abort(); },
        close: async (state, finish) => { await finish(); if (phase === 'closed' && state.filename === target) controller.abort(); } });
      await reject(states, error => error.code === 'ABORT_ERR', controller.signal);
      if (phase === 'before') assert.equal(states.length, 0);
      await restore();
    }
    // Mutation after confirmed close cannot change the already admitted snapshot.
    const states = install({ target, close: async (state, finish) => {
      await finish(); if (state.filename === target) await fs.writeFile(target, Buffer.alloc(original.length, 32));
    } });
    assertHealthy(await execute()); assert.deepEqual(admitted.warnings, ['A']);
    assertClosed(states); await restore();
    for (const fault of ['checksum', 'schema', 'generation']) {
      const registration = structuredClone(fixture.registration), piece = registration.pieces.find(piece => piece.name === name);
      if (fault === 'checksum') piece.checksum = 'sha256:' + '0'.repeat(64);
      else {
        const value = JSON.parse(original);
        if (fault === 'schema') value.unknownManifestField = true;
        else value.generation = { ...fixture.generation, baseBuildId: 'foreign-build' };
        const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(target, bytes);
        piece.bytes = bytes.length;
        piece.checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
      }
      await fs.writeFile(fixture.registrationPath, JSON.stringify(registration));
      const states = install();
      await reject(states, error => fault === 'checksum' ? error.code === 'ERR_SEMANTIC_INTEGRITY'
        : fault === 'generation' ? name === 'semantic_manifest'
          ? /Mixed semantic\/build manifest generations/.test(error.message) : error.code === 'ERR_SEMANTIC_GENERATION_MISMATCH'
          : name === 'semantic_manifest' ? /^Invalid semantic manifest:/.test(error.message)
            : name === 'semantic_query_index' ? error.code === 'ERR_SEMANTIC_QUERY_INDEX'
              : error instanceof TypeError && /^Invalid semantic operation index:/.test(error.message));
      await restore();
    }
    const primary = Object.freeze(new Error('original ' + name + ' read failed'));
    const secondary = Object.freeze(new Error('original ' + name + ' close failed'));
    let deny = true;
    const pending = install({ target, afterRead: state => { if (state.filename === target) throw primary; },
      close: (state, finish) => { if (state.filename === target && deny) throw secondary; return finish(); } });
    const before = constructed;
    let failure; try { await execute(); assert.fail('pending original close must fail'); } catch (error) { failure = error; }
    assert.equal(constructed, before); assert.ok(graphHas(failure, primary) && graphHas(failure, secondary));
    assert.equal(failure.cacheOwnershipReleased(), false);
    const selected = pending.find(state => state.filename === target), reads = selected.reads;
    deny = false; await getContainedFileSession(failure).releaseAfterClose();
    assert.equal(selected.closes, 2); assert.equal(selected.reads, reads); assert.equal(selected.handle.fd, -1);
    assert.equal(failure.cacheOwnershipReleased(), true); await restore();
    assertHealthy(await execute());
  }
  const registration = structuredClone(fixture.registration);
  registration.pieces = registration.pieces.filter(piece => piece.name !== 'semantic_query_index');
  await fs.writeFile(fixture.registrationPath, JSON.stringify(registration));
  const states = install(); await reject(states, error => error.code === 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE');
  console.log(JSON.stringify({ consumer, familyKinds: 3, physicalLinkQualification: 'not claimed; native metadata admission controls only',
    successfulStores: constructed, backend }));
} finally {
  fs.open = originalOpen; nativeFs.lstatSync = originalLstat; nativeFs.statSync = originalStat;
  for (const close of held.values()) await close(); await fixture.cleanup();
}
