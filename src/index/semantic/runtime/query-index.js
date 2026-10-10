import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { runtimeByteHash, readRuntimeLines, runtimeImportError } from './raw-store.js';
import { throwIfAborted } from '../../../shared/abort.js';

export const RUNTIME_QUERY_INDEX_VERSION = '1';
export const runtimeIndexRow = (row, ordinal, byteLength, hash) => {
  const key = row.data.key || row.data.codeVersion || null;
  const fields = [row.evidenceId, row.kind, row.evidenceClass, row.join.sourceUnitId, row.join.sourceHash,
    row.join.quality, key?.sessionId || null, key?.processId || null, key?.codeId || null, key?.lifetimeId || null];
  if (fields.some(value => value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > 4096))) {
    throw runtimeImportError('Runtime lookup key exceeds the bounded index allowance.');
  }
  return [ordinal, byteLength, hash, ...fields];
};
export const assertRuntimeIndexedRow = (row, entry) => {
  if (!entry) throw runtimeImportError('Runtime lookup row is missing.');
  const expected = runtimeIndexRow(row, entry.ordinal, entry.byte_length, entry.row_hash);
  const actual = [entry.ordinal, entry.byte_length, entry.row_hash, entry.evidence_id, entry.kind, entry.evidence_class,
    entry.source_unit_id, entry.source_hash, entry.join_quality, entry.session_id, entry.process_id, entry.code_id, entry.lifetime_id];
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw runtimeImportError('Runtime hydrated row does not match its lookup keys.');
};

/** Owned staging only: immutable lookup pages are registered in the same family publication. */
export const writeRuntimeQueryIndex = async ({ root, evidence, capture, reserve, release, signal }) => {
  const allowance = Math.max(256 * 1024, evidence.byteLength * 12 + evidence.count * 256);
  if (!Number.isSafeInteger(allowance)) throw runtimeImportError('Runtime lookup disk allowance overflows.');
  await reserve(allowance);
  const filename = path.join(root, 'query.sqlite');
  let db = null, retainedBytes = 0;
  try {
    throwIfAborted(signal);
    db = new Database(filename);
    db.pragma('page_size = 4096'); db.pragma('journal_mode = OFF'); db.pragma('synchronous = FULL');
    db.pragma('cache_size = -512'); db.pragma('temp_store = FILE');
    db.pragma('max_page_count = ' + Math.floor(allowance / 4096));
    db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE evidence(ordinal INTEGER PRIMARY KEY,byte_length INTEGER NOT NULL,row_hash TEXT NOT NULL,
        evidence_id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,evidence_class TEXT NOT NULL,source_unit_id TEXT,source_hash TEXT,
        join_quality TEXT NOT NULL,session_id TEXT,process_id TEXT,code_id TEXT,lifetime_id TEXT);
      CREATE TABLE source_refs(partition_id TEXT NOT NULL,local_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,
        PRIMARY KEY(partition_id,local_id,ordinal)) WITHOUT ROWID;
      CREATE INDEX evidence_source ON evidence(source_unit_id,source_hash,ordinal);
      CREATE INDEX evidence_kind ON evidence(kind,ordinal);
      CREATE INDEX evidence_join ON evidence(join_quality,ordinal);
      CREATE INDEX evidence_code ON evidence(session_id,process_id,code_id,lifetime_id,ordinal);`);
    const meta = db.prepare('INSERT INTO metadata VALUES(?,?)');
    for (const [key, value] of Object.entries({ version: RUNTIME_QUERY_INDEX_VERSION,
      evidenceHash: evidence.hash, offsetsHash: evidence.offsetsHash, count: String(evidence.count), captureId: capture.captureId })) meta.run(key, value);
    const insert = db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const reference = db.prepare('INSERT OR IGNORE INTO source_refs VALUES(?,?,?)');
    db.exec('BEGIN');
    let ordinal = 0;
    for await (const line of readRuntimeLines({ filename: path.join(root, evidence.path), maxLineBytes: 16 * 1024 * 1024, signal })) {
      throwIfAborted(signal);
      if (!line.terminated || line.oversized) throw runtimeImportError('Runtime lookup input row is malformed.');
      const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line.bytes));
      insert.run(...runtimeIndexRow(row, ordinal, line.bytes.length + 1, runtimeByteHash(Buffer.concat([line.bytes, Buffer.from('\n')]))));
      for (const ref of row.join.targets) reference.run(ref.partitionId, ref.localId, ordinal);
      ordinal += 1;
    }
    if (ordinal !== evidence.count) throw runtimeImportError('Runtime lookup input count mismatch.');
    db.exec('COMMIT'); db.close(); db = null;
    const handle = await fs.open(filename, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    retainedBytes = (await fs.stat(filename)).size;
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(filename, { highWaterMark: 64 * 1024 })) { throwIfAborted(signal); digest.update(bytes); }
    const hash = digest.digest('hex');
    release(allowance - retainedBytes);
    return { path: 'query.sqlite', hash, byteLength: retainedBytes, formatVersion: RUNTIME_QUERY_INDEX_VERSION };
  } catch (error) {
    db?.close(); await fs.rm(filename, { force: true }); release(allowance); throw error;
  }
};

export const openRuntimeQueryIndex = ({ filename, manifest, capture }) => {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON'); db.pragma('cache_size = -512'); db.pragma('trusted_schema = OFF');
    const metadataRows = db.prepare('SELECT key,value FROM metadata LIMIT 6').all();
    const metadata = Object.fromEntries(metadataRows.map(row => [row.key, row.value]));
    if (metadataRows.length !== 5 || metadata.version !== RUNTIME_QUERY_INDEX_VERSION || metadata.evidenceHash !== manifest.evidence.hash
      || metadata.offsetsHash !== manifest.evidence.offsetsHash || metadata.captureId !== capture.captureId
      || metadata.count !== String(manifest.evidence.count)) throw runtimeImportError('Runtime lookup authority mismatch.');
    return db;
  } catch (error) { db.close(); throw error; }
};
