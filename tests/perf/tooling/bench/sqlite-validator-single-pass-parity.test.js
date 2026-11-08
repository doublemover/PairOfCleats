import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { createSqliteBenchChunks, publishSqliteBenchSource } from '../../../../tools/bench/sqlite/shared.js';
import { prepareSqliteBenchValidation, validateSqliteBenchDatabase } from '../../../../tools/bench/sqlite/validate.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-validator-single-pass');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const bundleDir = path.join(dir, 'bundles'); await fs.mkdir(bundleDir);
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {} };
const source = new Map();
for (const [index, file] of ['src/😀.js', 'src/\uE000.js', 'src/a.js'].entries()) {
  const chunks = createSqliteBenchChunks({ file, suffix: 'source-' + index, chunksPerFile: 3, kind: 'FunctionDeclaration' });
  chunks[0].tokens = ['same', 'same', 'tail-' + index];
  chunks[1].tokens = Array.from({ length: 40 }, (_, n) => 'wide-' + n);
  source.set(file, chunks);
  manifest.files[file] = await publishSqliteBenchSource({ bundleDir, file, chunks, mtimeMs: 1000 + index });
}
const originalPath = path.join(dir, 'original.db');
await buildDatabaseFromBundles({ Database, outPath: originalPath, mode: 'code', incrementalData: { manifest, bundleDir },
  envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 }, vectorConfig: { enabled: false },
  modelConfig: { id: null }, emitOutput: false, validateMode: 'off' });
const admission = await prepareSqliteBenchValidation({ bundleDir, manifest });
const nativeReference = () => {
  const db = new Database(originalPath, { readonly: true }), digest = createHash('sha256');
  try {
    for (const file of Object.keys(manifest.files).sort()) {
      const actual = db.prepare('SELECT file,start,end,startLine,endLine,kind,name,tokens FROM chunks WHERE mode=? AND file=? ORDER BY start,end,name').all('code', file);
      const postings = db.prepare(`SELECT c.start,c.name,v.token,p.tf FROM token_postings p
        JOIN token_vocab v ON v.mode=p.mode AND v.token_id=p.token_id
        JOIN chunks c ON c.mode=p.mode AND c.id=p.doc_id WHERE c.mode=? AND c.file=? ORDER BY c.start,v.token`).all('code', file);
      const lengths = db.prepare(`SELECT c.start,l.len FROM chunks c JOIN doc_lengths l ON l.mode=c.mode AND l.doc_id=c.id
        WHERE c.mode=? AND c.file=? ORDER BY c.start`).all('code', file);
      const saved = db.prepare('SELECT hash,mtimeMs,size,chunk_count FROM file_manifest WHERE mode=? AND file=?').get('code', file);
      digest.update(JSON.stringify([file, actual, postings, lengths, saved]));
    }
    return digest.digest('hex');
  } finally { db.close(); }
};
const expectedDigest = nativeReference();
const graph = error => {
  const values = new Set(), stack = [error];
  while (stack.length) { const value = stack.pop(); if (values.has(value)) continue; values.add(value);
    if (!value || typeof value !== 'object') continue;
    if (Object.hasOwn(value, 'cause')) stack.push(value.cause); if (value.errors) stack.push(...value.errors); }
  return values;
};
let active, closes, streams, visits, iteratorReturns, primary, secondary, denyClose, denyReturn, released, nativeReturn, repeat;
function RecordingDatabase(...args) {
  const db = new Database(...args); active = db;
  const prepare = db.prepare, close = db.close;
  db.close = function () { closes++; if (denyClose) throw secondary; return close.call(db); };
  db.prepare = function (sql) {
    const statement = prepare.call(db, sql);
    if (/FROM token_postings p/.test(sql)) {
      assert.equal(/c\.file\s*=/.test(sql), false, 'native postings cannot be rescanned for each file');
      statement.all = () => assert.fail('native postings must stream rather than materialize all rows');
      const iterate = statement.iterate;
      statement.iterate = function (...bindings) {
        streams++; const iterator = iterate.apply(statement, bindings), next = iterator.next, finish = iterator.return;
        nativeReturn = () => finish.call(iterator);
        let saved = null;
        return { next() {
          if (primary) throw primary;
          const value = repeat && saved ? (repeat = false, saved) : next.call(iterator);
          if (!value.done) { visits++; saved = value; } return value;
        }, return() { iteratorReturns++; if (denyReturn) throw secondary; return nativeReturn(); } };
      };
    }
    return statement;
  };
  return db;
}
const reset = () => { closes = 0; streams = 0; visits = 0; iteratorReturns = 0;
  primary = null; secondary = null; denyClose = false; denyReturn = false; released = false; repeat = false; };
const validate = dbPath => validateSqliteBenchDatabase({ Database: RecordingDatabase, dbPath, bundleDir, manifest,
  mode: 'code', expectedRows: 9, admission });
try {
  reset(); const positive = await validate(originalPath);
  assert.equal(positive.stableContentSha256, expectedDigest);
  const expectedRows = [...source.values()].flatMap(chunks => chunks).reduce((sum, chunk) => sum + new Set(chunk.tokens).size, 0);
  assert.equal(positive.postings, expectedRows); assert.equal(visits, expectedRows);
  assert.equal(streams, 1); assert.equal(iteratorReturns, 1); assert.equal(closes, 1); assert.equal(active.open, false);
  for (const fault of ['tf', 'missing', 'extra', 'orphan', 'missing-vocab', 'chunk', 'length']) {
    const dbPath = path.join(dir, fault + '.db'); await fs.copyFile(originalPath, dbPath);
    const db = new Database(dbPath);
    try {
      if (fault === 'tf') db.exec('UPDATE token_postings SET tf=tf+1 WHERE doc_id=0');
      if (fault === 'missing') db.exec('DELETE FROM token_postings WHERE doc_id=0');
      if (fault === 'extra' || fault === 'orphan') {
        db.prepare('INSERT INTO token_vocab VALUES (?,?,?)').run('code', 999999, 'never-in-source');
        db.prepare('INSERT INTO token_postings VALUES (?,?,?,?)').run('code', 999999, fault === 'extra' ? 0 : 999999, 1);
      }
      if (fault === 'missing-vocab') db.exec('DELETE FROM token_vocab WHERE token_id=(SELECT token_id FROM token_postings LIMIT 1)');
      if (fault === 'chunk') db.exec("UPDATE chunks SET name='wrong-source' WHERE id=0");
      if (fault === 'length') db.exec('UPDATE doc_lengths SET len=len+1 WHERE doc_id=0');
    } finally { db.close(); }
    reset(); await assert.rejects(validate(dbPath)); assert.equal(closes, 1); assert.equal(active.open, false);
  }
  reset(); repeat = true;
  await assert.rejects(validate(originalPath), /postings differ: duplicate row/);
  assert.equal(iteratorReturns, 1); assert.equal(closes, 1); assert.equal(active.open, false);
  for (const hold of ['close', 'iterator']) {
    reset(); primary = Object.freeze(new Error('original native iteration failure'));
    secondary = Object.freeze(Object.assign(new Error('original ' + hold + ' close failure'), hold === 'iterator'
      ? { cacheOwnershipPending: true, cacheOwnershipReleased: () => released } : {}));
    denyClose = hold === 'close'; denyReturn = hold === 'iterator';
    let failure;
    await assert.rejects(validate(originalPath), error => {
      failure = error; const values = graph(error); return values.has(primary) && values.has(secondary);
    });
    const owner = [...graph(failure)].find(value => value?.sqliteCacheOwner)?.sqliteCacheOwner;
    assert.ok(owner); assert.equal(owner.isSettled(), false); assert.equal(active.open, true);
    assert.equal(closes, hold === 'close' ? 1 : 0);
    denyClose = false; denyReturn = false; nativeReturn(); released = true;
    owner.release(); assert.equal(owner.isSettled(), true); assert.equal(active.open, false);
    assert.equal(streams, 1); assert.equal(iteratorReturns, 1, 'explicit original iterator recovery never repeats its failed validation');
  }
} finally { if (active?.open) { denyClose = false; denyReturn = false; nativeReturn?.(); released = true; active.close(); }
  await fs.rm(dir, { recursive: true, force: true }); }
console.log('One native postings correspondence stream preserves independent canonical digest, exact TF/coverage and original cleanup ownership.');
