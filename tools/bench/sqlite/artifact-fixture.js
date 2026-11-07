import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { enqueueSemanticArtifacts } from '../../../src/index/build/artifacts/writers/semantic/family.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';

/** One private generated-work directory. Compact receipts live beside it and
 * caller-selected index directories never enter this deletion authority. */
export const createSqliteArtifactWorkOwner = async ({ parentRoot, runRoot }) => {
  const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const parent = await fs.realpath(parentRoot), root = await fs.realpath(runRoot);
  const relative = path.relative(parent, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(relative) !== '.') throw new Error('Artifact benchmark run is outside its unique parent.');
  const rootIdentity = await fs.lstat(root, { bigint: true }), runIdentity = randomUUID(), workRoot = path.join(root, 'work');
  await fs.mkdir(workRoot);
  const workIdentity = await fs.lstat(workRoot, { bigint: true }), markerPath = path.join(root, 'artifact-benchmark-owner.json');
  const marker = JSON.stringify({ kind: 'sqlite-artifact-benchmark-work-v1', runIdentity, workRoot });
  await fs.writeFile(markerPath, marker, { flag: 'wx' });
  const markerHash = createHash('sha256').update(marker).digest('hex');
  const same = (actual, expected) => actual.isDirectory() && !actual.isSymbolicLink()
    && actual.dev === expected.dev && actual.ino === expected.ino;
  return Object.freeze({ workRoot, runIdentity, async reclaim() {
    if (canonical(await fs.realpath(parentRoot)) !== canonical(parent)
      || canonical(await fs.realpath(runRoot)) !== canonical(root) || !same(await fs.lstat(root, { bigint: true }), rootIdentity)
      || canonical(await fs.realpath(workRoot)) !== canonical(path.join(root, 'work'))
      || !same(await fs.lstat(workRoot, { bigint: true }), workIdentity)) throw new Error('Artifact benchmark work ownership changed; work retained.');
    const read = await readVerifiedContainedFile(root, markerPath, { maxBytes: 8192 });
    if (read.hash !== markerHash) throw new Error('Artifact benchmark run identity changed; work retained.');
    let bytesReclaimed = 0;
    const pending = [workRoot];
    while (pending.length) for (const entry of await fs.readdir(pending.pop(), { withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Unknown artifact benchmark work kind; work retained.');
      if (stat.isDirectory()) pending.push(file); else bytesReclaimed += stat.size;
    }
    if (!Number.isSafeInteger(bytesReclaimed)) throw new Error('Artifact benchmark work bytes exceed exact accounting.');
    await fs.rm(workRoot, { recursive: true, force: false });
    return { state: 'completed', scope: 'verified-unique-generated-work-only', runIdentity, workRoot,
      bytesReclaimed, retainedReceiptRoot: root, callerIndexRetained: true };
  } });
};

/** Register the generated lexical artifacts and a genuinely disabled semantic
 * family through the production writer. No semantic facts are fabricated and
 * code-mode SQLite admission is retained for both experiment arms. */
export const publishSqliteBenchmarkArtifacts = async ({ indexDir, chunkParts, repoRoot }) => {
  const indexState = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'sqlite-artifact-benchmark-' + path.basename(path.dirname(indexDir)), mode: 'code', stage: 'stage2' };
  const pieces = [], writes = [];
  const register = (entry, file) => pieces.push({ ...entry, path: path.relative(indexDir, file).replace(/\\/g, '/') });
  register({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, path.join(indexDir, 'chunk_meta.meta.json'));
  for (const part of chunkParts) register({ type: 'chunks', name: 'chunk_meta', format: 'jsonl' }, path.join(indexDir, part));
  register({ type: 'postings', name: 'token_postings_meta', format: 'json' }, path.join(indexDir, 'token_postings.meta.json'));
  register({ type: 'postings', name: 'token_postings', format: 'json' }, path.join(indexDir, 'token_postings.shards/token_postings.part-00000.json'));
  enqueueSemanticArtifacts({ state: {}, root: repoRoot, outDir: indexDir, indexState, enabled: false,
    enqueueWrite: (_label, write) => writes.push(write), addPieceFile: register, declareArtifactFamily: () => {} });
  for (const write of writes) await write();
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexState));
  await writePiecesManifest({ pieceEntries: pieces, outDir: indexDir, mode: 'code', indexState });
  const admitted = await openPublishedSemanticStore({ indexDir, repoRoot });
  assert.equal(admitted.manifest.status, 'disabled');
  assert.equal(admitted.manifest.partitions.length, 0);
  return indexState;
};

/** Independent source-row/posting oracle, outside measured database work. */
export const validateSqliteArtifactBenchmark = ({ Database, dbPath, source }) => {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let primary, failed = false;
  try {
    const fields = row => ({ file: row.file, start: row.start, end: row.end, name: row.name, kind: row.kind,
      docmeta: row.docmeta ? JSON.stringify(row.docmeta) : null });
    const sort = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const expected = source.chunkMeta.map(fields).sort(sort);
    const actual = db.prepare('SELECT file,start,end,name,kind,docmeta FROM chunks WHERE mode=?').all('code').sort(sort);
    assert.deepEqual(actual, expected);
    const expectedPostings = source.chunkMeta.flatMap(row => {
      const frequencies = new Map();
      for (const token of row.tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
      return [...frequencies].map(([token, tf]) => ({ name: row.name, token, tf }));
    }).sort((a, b) => sort(a, b) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
    const actualPostings = db.prepare(`SELECT c.name,v.token,p.tf FROM token_postings p
      JOIN token_vocab v ON v.mode=p.mode AND v.token_id=p.token_id JOIN chunks c ON c.mode=p.mode AND c.id=p.doc_id
      WHERE c.mode=?`).all('code').sort((a, b) => sort(a, b) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
    assert.deepEqual(actualPostings, expectedPostings);
    const lengths = db.prepare('SELECT c.name,l.len FROM chunks c JOIN doc_lengths l ON l.mode=c.mode AND l.doc_id=c.id WHERE c.mode=?').all('code').sort(sort);
    assert.deepEqual(lengths, source.chunkMeta.map(row => ({ name: row.name, len: row.tokens.length })).sort(sort));
    assert.ok(expected.length > 0 && actualPostings.length > 0);
    return { chunks: actual.length, postings: actualPostings.length, files: new Set(actual.map(row => row.file)).size,
      contentSha256: createHash('sha256').update(JSON.stringify([actual, actualPostings, lengths])).digest('hex'),
      semantic: 'admitted-disabled-family', lanes: { sparse: true, dense: false, phrase: false, chargram: false } };
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { db.close(); }
    catch (error) { if (failed) throw addStorageFailureContext(primary, {}, error, { secondaryPresent: true }); throw error; }
  }
};
