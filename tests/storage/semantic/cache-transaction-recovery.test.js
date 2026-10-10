#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';

const fixture = await createSemanticCacheFixture();
const outPath = path.join(fixture.root, 'recovery.sqlite');
const options = { Database, outPath, mode: 'code', incrementalData: { manifest: fixture.manifest, bundleDir: fixture.bundleDir },
  vectorConfig: { enabled: false }, modelConfig: { id: null }, emitOutput: false, validateMode: 'off', optimize: false };
const snapshot = () => {
  const db = new Database(outPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%_fts_%' ORDER BY name").all();
    return Object.fromEntries(tables.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '"').all()
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  } finally { db.close(); }
};
try {
  for (const file of ['input.js', 'stable-a.js', 'stable-b.js', 'stable-c.js']) await fixture.createFile({ file });
  await buildDatabaseFromBundles({ ...options, envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } });
  const before = snapshot();
  const changed = await fixture.createFile({ text: 'g(2);', analysisReason: 'deferred_new_policy' });
  changed.entry.hash = 'changed-ordinary-hash';
  fixture.manifest.semanticGeneration = { baseBuildId: 'failed-update', semanticRevision: 0 };
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let injected = 0;
    function FaultDatabase(...args) {
      const db = new Database(...args);
      const prepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        const statement = prepare(sql);
        if (!sql.startsWith('INSERT INTO semantic_analysis')) return statement;
        return new Proxy(statement, { get(target, key) {
          if (key === 'run') return (...params) => {
            const result = target.run(...params);
            if (params[1] === changed.source.sourceUnitId) {
              injected += 1;
              if (cancel) controller.abort();
              else throw new Error('injected semantic projection failure');
            }
            return result;
          };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
      return db;
    }
    await assert.rejects(incrementalUpdateDatabase({ ...options, Database: FaultDatabase, signal: controller.signal }),
      cancel ? error => error.name === 'AbortError' || error.code === 'ABORT_ERR' : /injected semantic projection failure/);
    assert.equal(injected, 1, 'fault fires after canonical semantic rows and ordinary changes were written');
    assert.deepEqual(snapshot(), before, 'caller transaction rolls back ordinary rows, semantic projections and generation together');
  }
  assert.equal((await incrementalUpdateDatabase(options)).used, true, 'a failed update leaves no transaction or savepoint behind');
  const disabled = { ...fixture.manifest, semanticEnabled: false, artifactSurfaceVersion: '0.0.0' };
  const after = snapshot();
  await assert.rejects(incrementalUpdateDatabase({ ...options, incrementalData: { manifest: disabled, bundleDir: fixture.bundleDir } }),
    { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  assert.deepEqual(snapshot(), after, 'disabled semantic mode still enforces exact format before mutating the database');
  console.log('semantic cache updates roll back lexical rows, immutable facts and generation on failure or cancellation');
} finally { await fixture.cleanup(); }
