import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { SQLITE_FILTER_FACTS_VERSION } from '../../../src/storage/sqlite/filter-facts.js';

/** Independent SQLite observation outside timing. Selected immutable input rows
 * are checked against stable chunk fields, resolved postings, lengths, manifest
 * and enabled filter facts; database existence cannot qualify a measurement. */
export const validateSqliteBenchDatabase = async ({ Database, dbPath, bundleDir, manifest, mode, expectedRows }) => {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const digest = createHash('sha256');
  let chunks = 0, postings = 0, sourceBytes = 0, bundleBytes = 0;
  try {
    const filterSeal = db.prepare('SELECT version,row_count FROM chunk_filter_facts_meta WHERE mode=?').get(mode);
    for (const file of Object.keys(manifest.files).sort()) {
      const entry = manifest.files[file];
      const snapshot = await readIncrementalBundleSnapshot({ bundleDir, relKey: file, entry });
      assert.ok(snapshot, `SQLite benchmark source snapshot must admit ${file}`);
      const expected = snapshot.bundle.chunks.map(chunk => ({ file: chunk.file, start: chunk.start, end: chunk.end,
        startLine: chunk.startLine, endLine: chunk.endLine, kind: chunk.kind, name: chunk.name, tokens: JSON.stringify(chunk.tokens) }));
      const actual = db.prepare('SELECT file,start,end,startLine,endLine,kind,name,tokens FROM chunks WHERE mode=? AND file=? ORDER BY start,end,name').all(mode, file);
      assert.deepEqual(actual, expected, `SQLite benchmark chunk contents differ for ${file}`);
      if (expected.length) {
        const query = `"${expected[0].name.replace(/"/gu, '""')}"`;
        const matched = db.prepare(`SELECT COUNT(*) AS count FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.mode=? AND c.file=?`).get(query, mode, file);
        assert.ok(matched.count > 0, `SQLite benchmark FTS must retrieve ${file}`);
      }
      const expectedPostings = snapshot.bundle.chunks.flatMap(chunk => {
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
      assert.deepEqual(lengths, snapshot.bundle.chunks.map(chunk => ({ start: chunk.start, len: chunk.tokens.length })));
      const fileRow = db.prepare('SELECT hash,mtimeMs,size,chunk_count FROM file_manifest WHERE mode=? AND file=?').get(mode, file);
      assert.deepEqual(fileRow, { hash: entry.hash, mtimeMs: entry.mtimeMs, size: entry.size, chunk_count: expected.length });
      if (filterSeal) {
        const facts = db.prepare(`SELECT c.start,f.file,f.kind FROM chunks c JOIN chunk_filter_facts f ON f.doc_id=c.id AND f.mode=c.mode
          WHERE c.mode=? AND c.file=? ORDER BY c.start`).all(mode, file);
        assert.deepEqual(facts, snapshot.bundle.chunks.map(chunk => ({ start: chunk.start, file, kind: chunk.kind.toLowerCase() })));
      }
      chunks += expected.length; postings += actualPostings.length; sourceBytes += entry.size;
      for (const part of snapshot.shards) bundleBytes += (await fs.stat(path.join(bundleDir, part.bundleName))).size;
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
    return { chunks, files: Object.keys(manifest.files).length, postings, sourceBytes, bundleBytes,
      stableContentSha256: digest.digest('hex'), filterFacts: { status: filterSeal ? 'sealed-validated' : 'unavailable',
        reason: filterSeal ? null : 'seal-absent' }, lanes: { sparse: true, dense: false, phrase: false, chargram: false } };
  } finally { db.close(); }
};
