import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { SQLITE_FILTER_FACTS_VERSION } from '../../../src/storage/sqlite/filter-facts.js';
import { assertCurrentIndexFormat } from '../../../src/contracts/index-format.js';
import { createSqliteCacheCloseOwner } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

const inputCaches = new WeakMap(), admittedInputs = new WeakMap();
const manifestDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const createSqliteBenchInputCache = () => {
  const token = Object.freeze({}); inputCaches.set(token, new Map()); return token;
};

/** Capture canonical immutable source facts once. A token is an in-process
 * capability, never an arbitrary serialized caller-authored validation oracle.
 * Core build/update admission remains unchanged and independently reads inputs. */
export const prepareSqliteBenchValidation = async ({ bundleDir, manifest, cache = null }) => {
  assertCurrentIndexFormat({ operation: 'benchmark-validation', component: 'bundle manifest', foundVersion: manifest?.artifactSurfaceVersion,
    repoRoot: process.cwd(), indexPath: bundleDir });
  const store = cache === null ? new Map() : inputCaches.get(cache);
  if (!store) throw new TypeError('SQLite benchmark validation requires its original source-cache capability.');
  const directory = path.resolve(bundleDir), facts = new Map(), uniqueParts = new Map();
  let rows = 0, sourceBytes = 0;
  for (const file of Object.keys(manifest.files).sort()) {
    const entry = structuredClone(manifest.files[file]), key = JSON.stringify([directory, file, entry]);
    let captured = store.get(key);
    if (!captured) {
      const snapshot = await readIncrementalBundleSnapshot({ bundleDir: directory, relKey: file, entry });
      assert.ok(snapshot, `SQLite benchmark source snapshot must admit ${file}`);
      const parts = await Promise.all(snapshot.shards.map(async part => ({ name: part.bundleName,
        bytes: (await fs.stat(path.join(directory, part.bundleName))).size })));
      captured = { entry, chunks: structuredClone(snapshot.bundle.chunks), parts }; store.set(key, captured);
    }
    facts.set(file, captured); rows += captured.chunks.length; sourceBytes += captured.entry.size;
    for (const part of captured.parts) uniqueParts.set(part.name, part.bytes);
  }
  const bundleBytes = [...uniqueParts.values()].reduce((sum, value) => sum + value, 0);
  if (![rows, sourceBytes, bundleBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('SQLite benchmark input accounting is unavailable.');
  const token = Object.freeze({ schemaVersion: 1, manifestSha256: manifestDigest(manifest), rows, files: facts.size, sourceBytes, bundleBytes,
    policy: 'canonical-immutable-snapshot-facts-captured-before-database-validation',
    bundleByteObservation: 'post-admission-file-sizes;not-physical-IO' });
  admittedInputs.set(token, { directory, facts }); return token;
};

/** Independent SQLite observation outside timing. Selected immutable input rows
 * are checked against stable chunk fields, resolved postings, lengths, manifest
 * and enabled filter facts; database existence cannot qualify a measurement. */
export const validateSqliteBenchDatabase = async ({ Database, dbPath, bundleDir, manifest, mode, expectedRows, admission = null }) => {
  admission ||= await prepareSqliteBenchValidation({ bundleDir, manifest });
  const input = admittedInputs.get(admission);
  if (!input || input.directory !== path.resolve(bundleDir) || admission.manifestSha256 !== manifestDigest(manifest)) {
    throw new TypeError('SQLite benchmark validation source capability does not match its selected immutable manifest.');
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const native = createSqliteCacheCloseOwner(db, { canClose: () => true, onClosed() {} });
  const digest = createHash('sha256');
  let chunks = 0, postings = 0, failed = false, primary;
  try {
    const filterSeal = db.prepare('SELECT version,row_count FROM chunk_filter_facts_meta WHERE mode=?').get(mode);
    for (const file of Object.keys(manifest.files).sort()) {
      const { entry, chunks: sourceChunks } = input.facts.get(file);
      const expected = sourceChunks.map(chunk => ({ file: chunk.file, start: chunk.start, end: chunk.end,
        startLine: chunk.startLine, endLine: chunk.endLine, kind: chunk.kind, name: chunk.name, tokens: JSON.stringify(chunk.tokens) }));
      const actual = db.prepare('SELECT file,start,end,startLine,endLine,kind,name,tokens FROM chunks WHERE mode=? AND file=? ORDER BY start,end,name').all(mode, file);
      assert.deepEqual(actual, expected, `SQLite benchmark chunk contents differ for ${file}`);
      if (expected.length) {
        const query = `"${expected[0].name.replace(/"/gu, '""')}"`;
        const matched = db.prepare(`SELECT COUNT(*) AS count FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.mode=? AND c.file=?`).get(query, mode, file);
        assert.ok(matched.count > 0, `SQLite benchmark FTS must retrieve ${file}`);
      }
      const expectedPostings = sourceChunks.flatMap(chunk => {
        const frequencies = new Map();
        for (const token of chunk.tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
        return [...frequencies].map(([token, tf]) => ({ start: chunk.start, name: chunk.name, token, tf }));
      }).sort((a, b) => a.start - b.start || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
      const actualPostings = db.prepare(`SELECT c.start,c.name,v.token,p.tf FROM token_postings p
        JOIN token_vocab v ON v.mode=p.mode AND v.token_id=p.token_id
        JOIN chunks c ON c.mode=p.mode AND c.id=p.doc_id WHERE c.mode=? AND c.file=? ORDER BY c.start,v.token`).all(mode, file);
      assert.deepEqual(actualPostings, expectedPostings, `SQLite benchmark postings differ for ${file}`);
      const lengths = db.prepare(`SELECT c.start,l.len FROM chunks c JOIN doc_lengths l ON l.mode=c.mode AND l.doc_id=c.id
        WHERE c.mode=? AND c.file=? ORDER BY c.start`).all(mode, file);
      assert.deepEqual(lengths, sourceChunks.map(chunk => ({ start: chunk.start, len: chunk.tokens.length })));
      const fileRow = db.prepare('SELECT hash,mtimeMs,size,chunk_count FROM file_manifest WHERE mode=? AND file=?').get(mode, file);
      assert.deepEqual(fileRow, { hash: entry.hash, mtimeMs: entry.mtimeMs, size: entry.size, chunk_count: expected.length });
      if (filterSeal) {
        const facts = db.prepare(`SELECT c.start,f.file,f.kind FROM chunks c JOIN chunk_filter_facts f ON f.doc_id=c.id AND f.mode=c.mode
          WHERE c.mode=? AND c.file=? ORDER BY c.start`).all(mode, file);
        assert.deepEqual(facts, sourceChunks.map(chunk => ({ start: chunk.start, file, kind: chunk.kind.toLowerCase() })));
      }
      chunks += expected.length; postings += actualPostings.length;
      digest.update(JSON.stringify([file, actual, actualPostings, lengths, fileRow]));
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE mode=?').get(mode).count, chunks);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM file_manifest WHERE mode=?').get(mode).count, Object.keys(manifest.files).length);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM token_postings WHERE mode=?').get(mode).count, postings);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dense_vectors WHERE mode=?').get(mode).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM phrase_postings WHERE mode=?').get(mode).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chargram_postings WHERE mode=?').get(mode).count, 0);
    if (filterSeal) {
      assert.equal(filterSeal.version, SQLITE_FILTER_FACTS_VERSION);
      assert.equal(filterSeal.row_count, chunks);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunk_filter_facts WHERE mode=?').get(mode).count, chunks);
    }
    if (expectedRows !== undefined) assert.equal(chunks, expectedRows, 'SQLite benchmark must perform the expected nonzero work');
    assert.ok(chunks > 0 && postings > 0, 'SQLite benchmark must perform nonzero lexical work');
    return { chunks, files: Object.keys(manifest.files).length, postings, sourceBytes: admission.sourceBytes, bundleBytes: admission.bundleBytes,
      stableContentSha256: digest.digest('hex'), filterFacts: { status: filterSeal ? 'sealed-validated' : 'unavailable',
        reason: filterSeal ? null : 'seal-absent' }, inputAdmission: admission,
      lanes: { sparse: true, dense: false, phrase: false, chargram: false } };
  } catch (error) { failed = true; primary = error; native.retainFailure(error); throw error; }
  finally {
    try { native.retire(); }
    catch (cleanup) { if (failed) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }); throw cleanup; }
  }
};
