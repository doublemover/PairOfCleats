import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Packr } from 'msgpackr';
import { loadLmdbArtifactInputs } from '../../../src/storage/lmdb/artifact-inputs.js';
import { createLmdbHelpers } from '../../../src/retrieval/lmdb-helpers.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../../../src/storage/lmdb/schema.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lmdb-selected-inputs-'));
const packr = new Packr();
try {
  for (const format of ['json', 'jsonl', 'columnar']) {
    const dir = path.join(root, format); await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
    await fs.mkdir(path.join(dir, 'selected'));
    const chunks = [{ id: 0, fileId: 0, file: 'a.js', ext: '.js', start: 0, end: 1 },
      { id: 1, fileId: 1, file: 'b.js', ext: '.js', start: 0, end: 1, churn: 0 }];
    const files = [{ id: 0, file: 'a.js', ext: '.js', last_author: 'Ada', last_modified: 123, churn: 7, externalDocs: ['a.md'] },
      { id: 1, file: 'b.js', ext: '.js', last_author: 'Grace', churn: 9 }];
    const fields = [{ body: ['alpha'] }, { body: ['beta'] }];
    const tokens = { totalDocs: 2, avgDocLen: 1, vocab: ['alpha'], postings: [[[0, 1], [1, 1]]], docLengths: [1, 1] };
    const pieces = [];
    const json = async (name, payload, filename = `${name}.json`) => {
      await fs.writeFile(path.join(dir, filename), JSON.stringify(payload)); pieces.push({ name, path: filename, format: 'json' });
    };
    await json('chunk_meta', chunks); await json('token_postings', tokens); await json('index_state', { mode: 'code' });
    for (const [name, rows] of [['file_meta', files], ['field_tokens', fields]]) {
      if (format === 'json') await json(name, rows, `selected/${name}.json`);
      else if (format === 'jsonl') {
        const parts = rows.map((_row, index) => `selected/${name}.part-${index}.jsonl`);
        for (let index = 0; index < rows.length; index++) {
          await fs.writeFile(path.join(dir, parts[index]), JSON.stringify(rows[index]) + '\n');
          pieces.push({ name, path: parts[index], format: 'jsonl', count: 1 });
        }
        await json(`${name}_meta`, { format: 'jsonl-sharded', parts, count: rows.length });
      } else {
        const columns = [...new Set(rows.flatMap(Object.keys))];
        await json(name, { format: 'columnar', columns, length: rows.length,
          arrays: Object.fromEntries(columns.map(key => [key, rows.map(row => row[key] ?? null)])) }, `selected/${name}.columnar.json`);
        pieces[pieces.length - 1].format = 'columnar';
      }
      await fs.writeFile(path.join(dir, `${name}.json`), '["stale unselected copy"]');
    }
    const freshFieldPostings = { fields: { body: { vocab: ['alpha'], postings: [[[0, 1]]], docLengths: [1, 1] } } };
    await json('field_postings', freshFieldPostings, 'selected/field_postings.json');
    await fs.writeFile(path.join(dir, 'field_postings.json'), '{"fields":{"stale":{}}}');
    const phrase = { vocab: ['fresh phrase'], postings: [[0]] };
    await writeJsonObjectFile(path.join(dir, 'selected/phrase_ngrams.json.gz'), { fields: phrase, compression: 'gzip' });
    pieces.push({ name: 'phrase_ngrams', path: 'selected/phrase_ngrams.json.gz', format: 'json', compression: 'gzip' });
    await fs.writeFile(path.join(dir, 'phrase_ngrams.json'), '{broken stale alias');
    await fs.writeFile(path.join(dir, 'minhash_signatures.json'), '{broken unlisted optional artifact');
    const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces };
    const writeManifest = value => fs.writeFile(path.join(dir, 'pieces/manifest.json'), JSON.stringify(value));
    await writeManifest(manifest);
    const admitted = await loadLmdbArtifactInputs(dir, { mode: 'code' });
    assert.equal(admitted.fileMeta.length, 2); assert.deepEqual(admitted.fieldTokens, fields);
    assert.deepEqual(admitted.fieldPostings, freshFieldPostings); assert.deepEqual(admitted.phraseNgrams, phrase);
    assert.equal(admitted.minhashSignatures, null); assert.equal(admitted.fileRelations, null);
    const values = new Map([[LMDB_META_KEYS.chunkCount, chunks.length], [LMDB_ARTIFACT_KEYS.chunkMeta, admitted.chunkMeta],
      [LMDB_ARTIFACT_KEYS.fileMeta, admitted.fileMeta], [LMDB_ARTIFACT_KEYS.tokenPostings, admitted.tokenPostings]]
      .map(([key, value]) => [key, packr.pack(value)]));
    const helpers = createLmdbHelpers({ getDb: () => ({ get: key => values.get(key) }), hnswConfig: { enabled: false }, fileChargramN: 3 });
    const hydrated = helpers.loadIndexFromLmdb('code', { includeDense: false, includeHnsw: false, includeMinhash: false, includeFilterIndex: false });
    assert.equal(hydrated.chunkMeta[0].file, 'a.js'); assert.equal(hydrated.chunkMeta[0].ext, '.js');
    assert.equal(hydrated.chunkMeta[0].last_author, 'Ada'); assert.equal(hydrated.chunkMeta[0].churn, 7);
    assert.deepEqual(hydrated.chunkMeta[0].externalDocs, ['a.md']); assert.equal(hydrated.chunkMeta[1].churn, 0);
    await assert.rejects(loadLmdbArtifactInputs(dir, { mode: 'prose' }), { code: 'ERR_LMDB_ARTIFACT_INVALID' });
    const metadataOnly = structuredClone(manifest);
    metadataOnly.pieces = metadataOnly.pieces.filter(piece => piece.name !== 'file_meta');
    if (!metadataOnly.pieces.some(piece => piece.name === 'file_meta_meta')) {
      await fs.writeFile(path.join(dir, 'file_meta.meta.json'), '{}');
      metadataOnly.pieces.push({ name: 'file_meta_meta', path: 'file_meta.meta.json', format: 'json' });
    }
    await writeManifest(metadataOnly); await assert.rejects(loadLmdbArtifactInputs(dir, { mode: 'code' }));
    await writeManifest(manifest);
    const primaryPath = path.join(dir, pieces.find(piece => piece.name === 'field_postings').path);
    await fs.writeFile(primaryPath, '{broken selected generation');
    await assert.rejects(loadLmdbArtifactInputs(dir, { mode: 'code' }), /JSON|parse|Unexpected/i);
    await fs.writeFile(primaryPath, JSON.stringify(freshFieldPostings));
    await fs.writeFile(path.join(dir, 'token_postings.json'), '{"parts":[],"count":2}');
    await assert.rejects(loadLmdbArtifactInputs(dir, { mode: 'code' }), { code: 'ERR_LMDB_ARTIFACT_INVALID' });
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('LMDB source admission follows selected JSON/JSONL/columnar generations and actual hydration retains file metadata.');
