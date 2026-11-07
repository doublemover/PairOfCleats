import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildDatabaseFromArtifacts } from '../../../../src/storage/sqlite/build/from-artifacts/build.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { CREATE_INDEXES_SQL } from '../../../../src/storage/sqlite/schema.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { writeBundleFile } from '../../../../src/shared/bundle-io.js';
import { writeSqliteArtifactManifest } from '../../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

// UNRUN: real exported full builders, preserving an existing native authority.
const { dir } = await prepareIsolatedTestCacheDir('sqlite-existing-output-staging');
const primary = Object.freeze(new Error('controlled post-insert index failure'));
try {
  const indexDir = path.join(dir, 'input');
  await fs.mkdir(indexDir);
  await writeSqliteArtifactManifest(indexDir, []);
  const chunk = { id: 0, file: 'source.js', start: 0, end: 1, tokens: ['replacement'] };
  await writeBundleFile({ bundlePath: path.join(dir, 'bundle.json'), bundle: { chunks: [chunk] } });
  for (const consumer of ['artifacts', 'bundles']) {
    const output = path.join(dir, `${consumer}.db`);
    const previous = new Database(output);
    previous.exec("CREATE TABLE witness(value TEXT); INSERT INTO witness VALUES ('old-authority')");
    previous.close();
    const authority = await fs.readFile(output);
    let fail = true;
    const openedPaths = [];
    let inserted = 0;
    function TrackingDatabase(file) {
      const db = new Database(file);
      openedPaths.push(path.resolve(file));
      const exec = db.exec.bind(db), prepare = db.prepare.bind(db);
      db.exec = sql => {
        if (fail && sql === CREATE_INDEXES_SQL) throw primary;
        return exec(sql);
      };
      db.prepare = sql => {
        const statement = prepare(sql);
        if (/INSERT(?: OR REPLACE)? INTO chunks(?:_stage)?\b/.test(sql)) {
          const run = statement.run.bind(statement);
          statement.run = (...args) => { const result = run(...args); inserted++; return result; };
        }
        return statement;
      };
      return db;
    }
    const run = () => consumer === 'artifacts'
      ? buildDatabaseFromArtifacts({ Database: TrackingDatabase, outPath: output, indexDir, mode: 'code',
        index: { chunkMeta: [{ ...chunk }], tokenPostings: { vocab: ['replacement'], postings: [[[0, 1]]],
          docLengths: [1], avgDocLen: 1, totalDocs: 1 } },
        emitOutput: false, validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null },
        buildPragmas: false, optimize: false })
      : buildDatabaseFromBundles({ Database: TrackingDatabase, outPath: output, mode: 'code',
        incrementalData: { bundleDir: dir, manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
          files: { 'source.js': { bundles: ['bundle.json'], hash: 'source-hash', mtimeMs: 1, size: 1 } } } },
        envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 },
        emitOutput: false, validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null },
        buildPragmas: false, optimize: false });
    await assert.rejects(run, error => error === primary);
    assert.ok(inserted > 0, 'the failure occurs after actual staged chunk insertion');
    assert.ok(openedPaths.every(file => file !== path.resolve(output)), 'neither full consumer mutates the existing authority in place');
    assert.deepEqual(await fs.readFile(output), authority);
    const old = new Database(output, { readonly: true });
    try { assert.equal(old.prepare('SELECT value FROM witness').get().value, 'old-authority'); }
    finally { old.close(); }
    fail = false;
    const result = await run();
    assert.equal(consumer === 'artifacts' ? result : result.count, 1);
    const replacement = new Database(output, { readonly: true });
    try { assert.deepEqual(replacement.prepare('SELECT file FROM chunks').all(), [{ file: 'source.js' }]); }
    finally { replacement.close(); }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Exported SQLite artifact and bundle full builders stage existing outputs until validated publication.');
