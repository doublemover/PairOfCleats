#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteBackend } from '../../../src/retrieval/cli-sqlite.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-sqlite-cache-generation-'));
const dbPath = path.join(tempRoot, 'index.db');
await fs.writeFile(dbPath, 'initial');

const cache = createSqliteDbCache();
let closedA = 0;
let closedB = 0;
const dbA = { close: () => { closedA += 1; } };
const dbB = { close: () => { closedB += 1; } };

cache.set(dbPath, dbA, {
  generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' }
});

assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' } }),
  dbA,
  'expected matching generation tag to hit sqlite cache'
);
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-b' } }),
  null,
  'expected build-generation mismatch to miss sqlite cache'
);
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' } }),
  null,
  'expected generation tag mismatch to miss sqlite cache'
);

cache.set(dbPath, dbB, {
  generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' }
});

assert.equal(closedA, 1, 'expected prior generation handle to close when replaced');
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' } }),
  null,
  'expected prior generation to be evicted'
);
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' } }),
  dbB,
  'expected replacement generation to be cached'
);

cache.close(dbPath, { generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' } });
assert.equal(closedB, 1, 'expected closing a specific generation to close its handle');

const { default: Database } = await import('better-sqlite3');
const sharedPath = path.join(tempRoot, 'shared.db');
const separatePath = path.join(tempRoot, 'separate.db');
const invalidPath = path.join(tempRoot, 'invalid.db');
const modes = ['code', 'prose', 'extracted-prose'];
const handleKey = { code: 'dbCode', prose: 'dbProse', 'extracted-prose': 'dbExtractedProse' };
const backendCache = createSqliteDbCache();
const fallbackClosed = [];
const fallbackCache = createSqliteDbCache({ onEvict: ({ entry }) => fallbackClosed.push(entry.db) });
const limitedCache = createSqliteDbCache({ maxEntries: 1 });
const disabledCache = createSqliteDbCache({ maxEntries: 0 });
const backends = new Set();
const externallyOwnedHandles = new Set();

try {
  // The reader only needs the canonical schema and a few rows; no index build.
  const writer = new Database(sharedPath);
  try {
    writer.exec(CREATE_TABLES_SQL);
    writer.pragma(`user_version = ${SCHEMA_VERSION}`);
    const insert = writer.prepare('INSERT INTO chunks (id, chunk_id, mode, file) VALUES (?, ?, ?, ?)');
    modes.forEach((mode, index) => insert.run(index + 1, `chunk-${mode}`, mode, `${mode}.txt`));
  } finally {
    writer.close();
  }
  await fs.copyFile(sharedPath, separatePath);
  const invalidWriter = new Database(invalidPath);
  invalidWriter.close();
  const originalStat = await fs.stat(sharedPath);

  const sqliteStates = Object.fromEntries(modes.map((mode) => [mode, {
    buildId: `build-${mode}`,
    artifactSurfaceVersion: 1,
    profile: { id: 'default', schemaVersion: 1 },
    sqlite: { ready: true, pending: false }
  }]));
  let generationContext = { buildGenerationKey: 'generation-a', activeBuildRoot: '/build/a' };
  const openBackend = async (overrides = {}) => {
    const backend = await createSqliteBackend({
      useSqlite: true,
      needsCode: true,
      needsProse: true,
      needsExtractedProse: true,
      sqliteCodePath: sharedPath,
      // A relative spelling must still identify the same physical handle.
      sqliteProsePath: path.relative(process.cwd(), sharedPath),
      sqliteExtractedProsePath: sharedPath,
      sqliteFtsRequested: false,
      backendForcedSqlite: true,
      vectorExtension: { table: 'custom_ann', column: 'embedding' },
      vectorAnnEnabled: false,
      dbCache: backendCache,
      sqliteStates,
      generationContext,
      ...overrides
    });
    backends.add(backend);
    return backend;
  };
  const selectMode = (mode) => ({
    needsCode: mode === 'code',
    needsProse: mode === 'prose',
    needsExtractedProse: mode === 'extracted-prose'
  });
  const assertReadable = (backend, selectedModes = modes) => {
    assert.equal(backend.useSqlite, true);
    for (const mode of selectedModes) {
      const db = backend[handleKey[mode]];
      assert.equal(db.open, true, `expected ${mode} handle to remain open`);
      assert.equal(db.prepare('SELECT file FROM chunks WHERE mode = ?').get(mode).file, `${mode}.txt`);
    }
  };

  const mixed = await openBackend();
  assertReadable(mixed);
  assert.equal(mixed.dbCode, mixed.dbProse, 'shared code/prose paths must reuse one handle');
  assert.equal(mixed.dbCode, mixed.dbExtractedProse, 'shared extracted-prose must reuse the same handle');
  assert.equal(backendCache.size(), 1, 'expected one cache entry for the shared file');
  assert.equal(mixed.vectorAnnConfigByMode.code.table, 'custom_ann_code');
  assert.equal(mixed.vectorAnnConfigByMode.prose.table, 'custom_ann_prose');
  assert.equal(mixed.vectorAnnConfigByMode['extracted-prose'].table, 'custom_ann');
  assert.equal(mixed.vectorAnnConfigByMode.code.column, 'embedding');

  const warm = await openBackend();
  assertReadable(warm);
  assert.equal(warm.dbCode, mixed.dbCode, 'unchanged mixed search must reuse the cached handle');
  for (const mode of modes) {
    const single = await openBackend(selectMode(mode));
    assertReadable(single, [mode]);
    assert.equal(single[handleKey[mode]], mixed.dbCode, 'single-mode search must retain the full shared identity');
    await single.dispose();
  }
  const warmAgain = await openBackend();
  assert.equal(warmAgain.dbCode, mixed.dbCode, 'mixed search after single-mode reuse must stay warm');
  await warmAgain.dispose();
  await warm.dispose();
  await mixed.dispose();

  let previous = mixed.dbCode;
  for (const changedMode of modes) {
    sqliteStates[changedMode] = { ...sqliteStates[changedMode], buildId: `next-${changedMode}` };
    const requestedMode = changedMode === 'code' ? 'prose' : 'code';
    const replacement = await openBackend(selectMode(requestedMode));
    assertReadable(replacement, [requestedMode]);
    const next = replacement[handleKey[requestedMode]];
    assert.notEqual(next, previous, `changing unrequested ${changedMode} generation must replace the handle`);
    assert.equal(previous.open, false, 'replacing a shared generation must close the old handle');
    assert.equal(backendCache.size(), 1);
    previous = next;
    await replacement.dispose();
  }
  for (const changedFields of [
    { artifactSurfaceVersion: 2 },
    { profile: { id: 'vector_only', schemaVersion: 1 } },
    { profile: { id: 'vector_only', schemaVersion: 2 } },
    { sqlite: { ready: false, pending: false } },
    { sqlite: { ready: false, pending: true } }
  ]) {
    sqliteStates.prose = { ...sqliteStates.prose, ...changedFields };
    const replacement = await openBackend(selectMode('code'));
    assertReadable(replacement, ['code']);
    assert.notEqual(replacement.dbCode, previous, 'all co-resident generation fields must invalidate the cache');
    assert.equal(previous.open, false);
    previous = replacement.dbCode;
    await replacement.dispose();
  }
  await assert.rejects(openBackend(), /SQLite prose index marked pending/);
  const pending = await openBackend({ backendForcedSqlite: false });
  assert.equal(pending.useSqlite, false, 'requested pending mode must retain file-backed fallback');
  assert.equal(pending.dbCode, null);
  await pending.dispose();
  assert.equal(previous.open, true, 'pending preflight must not close an unrelated active cached handle');
  sqliteStates.prose = { ...sqliteStates.prose, sqlite: { ready: true, pending: false } };
  const readyAgain = await openBackend();
  previous = readyAgain.dbCode;
  await readyAgain.dispose();

  for (const changedContext of [
    { buildGenerationKey: 'generation-b' },
    { activeBuildRoot: '/build/b' }
  ]) {
    generationContext = { ...generationContext, ...changedContext };
    const replacement = await openBackend();
    assertReadable(replacement);
    assert.notEqual(replacement.dbCode, previous, 'build generation context must invalidate shared handles');
    assert.equal(previous.open, false);
    previous = replacement.dbCode;
    await replacement.dispose();
  }
  const finalStat = await fs.stat(sharedPath);
  assert.equal(finalStat.size, originalStat.size);
  assert.equal(finalStat.mtimeMs, originalStat.mtimeMs, 'generation tests must not depend on file signature changes');

  const uncached = await openBackend({ dbCache: null });
  assertReadable(uncached);
  assert.equal(new Set([uncached.dbCode, uncached.dbProse, uncached.dbExtractedProse]).size, 1,
    'uncached shared paths must also open only one handle');
  await uncached.dispose();
  await uncached.dispose();
  assert.equal(uncached.dbCode.open, false, 'uncached contexts must own and close their handles');

  const disabled = await openBackend({ dbCache: disabledCache });
  assertReadable(disabled);
  await disabled.dispose();
  assert.equal(disabled.dbCode.open, false, 'disabled caches must provide request-owned detached leases');

  for (const dbCache of [new Map(), Object.assign(new Map(), {
    acquire() { throw new Error('partial lease protocols must not be used'); }
  })]) {
    const legacy = await openBackend({ dbCache });
    externallyOwnedHandles.add(legacy.dbCode);
    await legacy.dispose();
    assertReadable(legacy);
    assert.equal(dbCache.get(sharedPath), legacy.dbCode, 'plain get/set caches retain external ownership');
  }

  const separate = await openBackend({ sqliteProsePath: separatePath, needsExtractedProse: false });
  assertReadable(separate, ['code', 'prose']);
  assert.notEqual(separate.dbCode, separate.dbProse, 'different files must retain separate handles');
  assert.equal(separate.vectorAnnConfigByMode.code.table, 'custom_ann');
  assert.equal(separate.vectorAnnConfigByMode.prose.table, 'custom_ann');
  assert.equal(backendCache.size(), 2);
  await separate.dispose();

  const live = await openBackend({ dbCache: limitedCache });
  const overlapping = await openBackend({ dbCache: limitedCache });
  const evicting = await openBackend({
    dbCache: limitedCache,
    sqliteCodePath: separatePath,
    sqliteProsePath: separatePath,
    sqliteExtractedProsePath: separatePath
  });
  assert.equal(limitedCache.size(), 1);
  assert.equal(live.dbCode, overlapping.dbCode);
  assertReadable(live);
  assertReadable(overlapping);
  limitedCache.closeAll();
  assert.equal(limitedCache.size(), 0);
  assertReadable(evicting);
  await live.dispose();
  assertReadable(overlapping);
  await overlapping.dispose();
  assert.equal(live.dbCode.open, false, 'the last overlapping request must close an evicted handle');
  await evicting.dispose();
  assert.equal(evicting.dbCode.open, false, 'closeAll must defer closure until the request finishes');

  const oldGeneration = await openBackend({ dbCache: limitedCache });
  const newGeneration = await openBackend({
    dbCache: limitedCache,
    sqliteStates: { ...sqliteStates, code: { ...sqliteStates.code, buildId: 'live-replacement' } }
  });
  assert.notEqual(oldGeneration.dbCode, newGeneration.dbCode);
  assertReadable(oldGeneration);
  assertReadable(newGeneration);
  await oldGeneration.dispose();
  assert.equal(oldGeneration.dbCode.open, false);
  assertReadable(newGeneration);
  limitedCache.dispose();
  assertReadable(newGeneration);
  await newGeneration.dispose();
  assert.equal(newGeneration.dbCode.open, false);

  const oneEntryCache = createSqliteDbCache({ maxEntries: 1 });
  try {
    const multiplePaths = await openBackend({
      dbCache: oneEntryCache,
      sqliteProsePath: separatePath,
      needsExtractedProse: false
    });
    assertReadable(multiplePaths, ['code', 'prose']);
    assert.equal(oneEntryCache.size(), 1);
    oneEntryCache.closeAll();
    assertReadable(multiplePaths, ['code', 'prose']);
    await multiplePaths.dispose();
    assert.equal(multiplePaths.dbCode.open, false);
    assert.equal(multiplePaths.dbProse.open, false);
  } finally {
    oneEntryCache.dispose();
  }

  const throwingCleanup = await openBackend({
    dbCache: null,
    sqliteProsePath: separatePath,
    needsExtractedProse: false
  });
  const originalClose = throwingCleanup.dbCode.close.bind(throwingCleanup.dbCode);
  let closeCalls = 0;
  throwingCleanup.dbCode.close = () => {
    closeCalls += 1;
    originalClose();
    throw new Error('injected first-handle close failure');
  };
  assert.throws(() => throwingCleanup.dispose(), AggregateError);
  assert.equal(throwingCleanup.dbProse.open, false, 'dispose must attempt all physical handles');
  await throwingCleanup.dispose();
  assert.equal(closeCalls, 1, 'a failing disposer must still be idempotent');

  const fallbackWarm = await openBackend({
    sqliteExtractedProsePath: invalidPath,
    needsExtractedProse: false,
    dbCache: fallbackCache
  });
  await fallbackWarm.dispose();

  for (const dbCache of [fallbackCache, null]) {
    const fallback = await openBackend({
      sqliteExtractedProsePath: invalidPath,
      backendForcedSqlite: false,
      dbCache
    });
    assert.equal(fallback.useSqlite, false, 'partial shared-backend failure must fall back');
    assert.equal(fallback.dbCode, null);
    assert.equal(fallback.dbProse, null);
    assert.equal(fallback.dbExtractedProse, null);
    assert.ok(Object.values(fallback.vectorAnnState).every((state) => !state.available));
    await fallback.dispose();
  }
  assert.equal(fallbackCache.size(), 0);
  assert.equal(fallbackClosed.length, 1, 'fallback must close the shared cache entry exactly once');
  assert.equal(fallbackClosed[0].open, false);
} finally {
  for (const backend of backends) await backend.dispose();
  cache.dispose();
  backendCache.dispose();
  fallbackCache.dispose();
  limitedCache.dispose();
  disabledCache.dispose();
  for (const db of externallyOwnedHandles) db.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite cache generation-tag invalidation ok');
