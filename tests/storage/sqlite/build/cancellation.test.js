import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
import Database from 'better-sqlite3';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { writeSqliteArtifactManifest } from '../../../helpers/artifact-io-fixture.js';
import { writeSqliteShardFixtureArtifacts } from '../helpers/build-fixture.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { CREATE_INDEXES_SQL } from '../../../../src/storage/sqlite/schema.js';
import { replaceSqliteDatabase } from '../../../../src/storage/sqlite/utils.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { writeBundleFile } from '../../../../src/shared/bundle-io.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sqlite-build-cancel-')));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
let controller, when = 'success';
let handles = [], writes = 0, rollbacks = 0, commits = 0;
const workerTrace = [];
let workerStart;
const markWorker = phase => {
  if (workerTrace.length < 16) workerTrace.push({ phase, elapsedMs: Math.round(performance.now() - workerStart) });
};
function TrackingDatabase(...args) {
  if (when === 'worker') markWorker('database-open-enter');
  const db = new Database(...args);
  if (when === 'worker') markWorker('database-open-return');
  const tracked = { db, closes: 0 };
  handles.push(tracked);
  const prepare = db.prepare.bind(db), exec = db.exec.bind(db), close = db.close.bind(db);
  db.prepare = (sql, ...rest) => {
    const statement = prepare(sql, ...rest);
    if (/INSERT OR REPLACE INTO chunks_stage\b/.test(sql)) {
      const run = statement.run.bind(statement);
      statement.run = (...values) => {
        const result = run(...values);
        writes += 1;
        if (when === 'row') controller.abort();
        if (when === 'event-loop') {
          const activeController = controller;
          setImmediate(() => activeController.abort());
        }
        return result;
      };
    }
    return statement;
  };
  db.exec = (sql, ...rest) => {
    const result = exec(sql, ...rest);
    if (sql === 'ROLLBACK') rollbacks += 1;
    if (sql === 'COMMIT') commits += 1;
    if (sql === CREATE_INDEXES_SQL && when === 'commit') controller.abort();
    return result;
  };
  db.close = () => { tracked.closes += 1; return close(); };
  return db;
}
const reset = mode => {
  controller = new AbortController(); when = mode;
  handles = []; writes = 0; rollbacks = 0; commits = 0;
};
const assertClosed = () => {
  for (const handle of handles) {
    assert.equal(handle.closes, 1, 'every acquired native handle closes exactly once');
    assert.equal(handle.db.open, false);
  }
};
let hook;
try {
  const indexDir = path.join(root, 'input', 'index-code');
  await fs.mkdir(indexDir, { recursive: true });
  const { pieceEntries } = await writeSqliteShardFixtureArtifacts({ indexDir, chunkCount: 40, fileCount: 2 });
  await writeSqliteArtifactManifest(indexDir, pieceEntries);
  const runArtifact = async mode => {
    reset(mode);
    if (mode === 'before') controller.abort();
    const outPath = path.join(root, `${mode}.db`);
    // Each invocation needs fresh pieces: the importer releases consumed arrays.
    const pieces = await loadIndexPieces(indexDir);
    const work = () => buildDatabaseFromArtifacts({ Database: TrackingDatabase, outPath, indexDir,
      index: pieces, mode: 'code', signal: controller.signal, batchSize: 8,
      emitOutput: false, validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null },
      statementStrategy: 'prepared', optimize: false, buildPragmas: false });
    if (mode === 'success') {
      assert.equal(await work(), 40);
      const reader = new Database(outPath, { readonly: true });
      try { assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 40); }
      finally { reader.close(); }
    } else {
      await assert.rejects(work, { code: 'ABORT_ERR' }, `${mode}: cancellation must reject instead of publishing a partial build`);
      await assert.rejects(fs.stat(outPath), { code: 'ENOENT' });
      assert.equal(commits, 0);
      if (mode === 'before') assert.equal(handles.length, 0);
      else { assert.ok(writes > 0, 'cancel only after actual native row insertion'); assert.equal(rollbacks, 1); }
    }
    assertClosed();
  };
  for (const mode of ['row', 'event-loop', 'commit', 'before', 'success']) await runArtifact(mode);

  globalThis.__sqliteCancellationDatabase = TrackingDatabase;
  hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/storage/sqlite/build/runner.js') && specifier === 'better-sqlite3') {
      return { url: 'sqlite-cancellation:database', shortCircuit: true };
    }
    return next(specifier, context);
  }, load(url, context, next) {
    if (url === 'sqlite-cancellation:database') return { format: 'module', shortCircuit: true,
      source: 'export default globalThis.__sqliteCancellationDatabase;' };
    return next(url, context);
  } });
  const { buildSqliteIndex } = await import('../../../../src/integrations/core/build-index/sqlite.js');
  const finalPath = path.join(root, 'published.db');
  const options = { mode: 'code', indexRoot: path.join(root, 'input'), out: finalPath, emitOutput: false, validateMode: 'off' };
  reset('success');
  const baseline = await buildSqliteIndex(root, options);
  assert.equal(baseline.outputPaths.code, finalPath, 'an explicit single-mode output must be the actual publication target');
  assertClosed();
  const before = await fs.readFile(finalPath);
  for (const mode of ['before', 'event-loop', 'commit']) {
    reset(mode);
    if (mode === 'before') controller.abort();
    await assert.rejects(buildSqliteIndex(root, { ...options, abortSignal: controller.signal }), { code: 'ABORT_ERR' });
    assertClosed();
    assert.deepEqual(await fs.readFile(finalPath), before, `${mode}: prior authoritative SQLite bytes must survive`);
    assert.ok(!(await fs.readdir(root)).some(file => file.startsWith('published.db.') && file !== 'published.db.bak'),
      'aborted builds clean staged databases and SQLite sidecars');
  }
  // Keep the production bundle parser; delay its entry to cancel actual worker work deterministically.
  const worker = path.join(root, 'controlled-worker.mjs');
  const productionWorker = new URL('../../../../src/storage/sqlite/build/bundle-loader-worker.js', import.meta.url).href;
  await fs.writeFile(worker, `import fs from 'node:fs/promises'; import path from 'node:path';
    import load from ${JSON.stringify(productionWorker)};
    export default async task => {
      await fs.writeFile(path.join(task.repoRoot, 'worker-started'), 'started');
      await new Promise(resolve => setTimeout(resolve, 300));
      await fs.writeFile(path.join(task.repoRoot, 'worker-late'), 'not cancelled');
      return load(task);
    };`);
  await writeBundleFile({ bundlePath: path.join(root, 'bundle.json'), format: 'json', bundle: {
    chunks: [{ file: 'sample.js', start: 0, end: 1, tokens: ['alpha'] }]
  } });
  reset('worker');
  let outcome;
  workerStart = performance.now();
  markWorker('build-enter');
  const pending = buildDatabaseFromBundles({ repoRoot: root, Database: TrackingDatabase, outPath: path.join(root, 'worker.db'),
    mode: 'code', incrementalData: { bundleDir: root, manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      files: { 'sample.js': { bundles: ['bundle.json'], hash: 'alpha', mtimeMs: 1, size: 1 } } } },
    workerPath: worker, envConfig: { bundleThreads: 2 }, threadLimits: { fileConcurrency: 1 },
    signal: controller.signal, modelConfig: { id: null }, vectorConfig: { enabled: false }, emitOutput: true,
    logger: { log: message => markWorker(message), warn: message => { throw new Error(`Unexpected worker-build warning: ${message}`); } },
    validateMode: 'off', optimize: false, buildPragmas: false })
    .then(value => { markWorker('build-resolved'); outcome = { value }; }, error => { markWorker('build-rejected'); outcome = { error }; });
  try {
    const deadline = Date.now() + 3000;
    while (!(await fs.stat(path.join(root, 'worker-started')).catch(() => null))) {
      assert.equal(outcome, undefined, `worker must actually start: ${outcome?.error?.stack}`);
      assert.ok(Date.now() < deadline, 'bounded worker-start witness');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    markWorker('worker-start-witness');
    controller.abort();
    markWorker('abort-requested');
    await pending;
    assert.equal(outcome.error?.code, 'ABORT_ERR', 'worker cancellation must propagate without direct-parser fallback');
    assertClosed();
    await assert.rejects(fs.stat(path.join(root, 'worker.db')), { code: 'ENOENT' });
    await new Promise(resolve => setTimeout(resolve, 350));
    await assert.rejects(fs.stat(path.join(root, 'worker-late')), { code: 'ENOENT' }, 'closed workers cannot finish later work');
    markWorker('no-late-work-witness');
  } catch (error) {
    console.error(`SQLite worker failure phases: ${JSON.stringify(workerTrace)}`);
    throw error;
  } finally { controller.abort(); await pending; }
  console.log(`SQLite worker lifecycle phases: ${JSON.stringify(workerTrace)}`);
  // Cancellation between backup and promotion must restore the old authority.
  const staged = path.join(root, 'staged.db');
  await fs.writeFile(staged, 'replacement');
  reset('promotion');
  const rename = fs.rename;
  fs.rename = async (source, destination) => {
    const result = await rename(source, destination);
    if (source === finalPath) controller.abort();
    return result;
  };
  try { await assert.rejects(replaceSqliteDatabase(staged, finalPath, { signal: controller.signal }), { code: 'ABORT_ERR' }); }
  finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(finalPath), before);
  assert.equal(await fs.readFile(staged, 'utf8'), 'replacement');
} finally {
  hook?.deregister(); delete globalThis.__sqliteCancellationDatabase;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('SQLite cancellation rejects before commit, rolls back real writes, closes native handles, cleans staging, and preserves publication authority.');
