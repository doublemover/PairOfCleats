import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { enqueueSymbolsArtifacts } from '../../../../src/index/build/artifacts/writers/symbols.js';
import { makeTempDir, rmDirRecursive } from '../../../helpers/temp.js';

// Actual enqueue/trim/measurement/raw+gzip/sharded writer and offsets paths.
// Authored, unrun. No index, parser, native backend, child or user cache work.
const root = await makeTempDir('prepared-symbol-rows-');
const stringify = JSON.stringify;
const chunk = (id, extra = {}) => ({ file: 'src/雪.js', name: id, kind: 'function', lang: 'javascript',
  chunkUid: 'uid-' + id, docmeta: { exported: true, exportNames: [id], signature: id + '()' },
  metaV2: { file: 'src/雪.js', virtualPath: 'src/雪.js', chunkUid: 'uid-' + id,
    symbol: { symbolId: 'sym:' + id, scopedId: 'scope:' + id, symbolKey: 'key:' + id,
      qualifiedName: id, kindGroup: 'function', scheme: 'poc' } }, ...extra });
const expectedRow = id => ({ v: 1, symbolId: 'sym:' + id, scopedId: 'scope:' + id, scheme: 'poc',
  symbolKey: 'key:' + id, signatureKey: null, chunkUid: 'uid-' + id, virtualPath: 'src/雪.js',
  segmentUid: null, file: 'src/雪.js', lang: 'javascript', kind: 'function', kindGroup: 'function',
  name: id, qualifiedName: id, signature: id + '()', exported: true, exportNames: [id] });
const expected = [expectedRow('alpha'), expectedRow('beta')];
const expectedText = expected.map(row => stringify(row) + '\n').join('');
const maxLine = Math.max(...expected.map(row => Buffer.byteLength(stringify(row)) + 1));
try {
  for (const [name, compression, maxJsonBytes] of [
    ['raw', null, null], ['gzip', 'gzip', null], ['shards', null, maxLine], ['gzip-shards', 'gzip', maxLine]
  ]) {
    const outDir = path.join(root, name); await fs.mkdir(outDir);
    const chunks = [chunk('beta'), chunk('alpha')], writes = [], pieces = [];
    let rowEncodes = 0;
    JSON.stringify = function(value, ...args) {
      if (value?.v === 1 && Object.hasOwn(value, 'symbolId')) rowEncodes++;
      return stringify(value, ...args);
    };
    try {
      await enqueueSymbolsArtifacts({ state: { chunks }, outDir, compression, maxJsonBytes,
        enqueueWrite: (label, job) => writes.push(job), addPieceFile: (entry, filePath) => pieces.push({ entry, filePath }),
        formatArtifactLabel: value => value });
      assert.equal(rowEncodes, 2, 'admitted final rows encode once for fitting, statistics and measurement');
      chunks[0].docmeta.exportNames[0] = 'late replacement';
      chunks[0].name = 'late name';
      for (const job of writes) await job();
      assert.equal(rowEncodes, 2, 'actual writer consumes private final bytes without reserializing a whole row');
    } finally { JSON.stringify = stringify; }
    const data = pieces.filter(piece => piece.entry.name === 'symbols');
    assert.ok(data.length);
    let actual = '';
    for (const piece of data) {
      const bytes = await fs.readFile(piece.filePath);
      actual += (compression ? gunzipSync(bytes) : bytes).toString('utf8');
    }
    assert.equal(actual, expectedText, 'ordering, Unicode, full rows and deferred-input ownership remain exact');
    const offsets = pieces.filter(piece => piece.entry.name === 'symbols_offsets');
    assert.equal(offsets.length, compression ? 0 : data.length);
    for (let index = 0; index < offsets.length; index++) {
      const bytes = await fs.readFile(offsets[index].filePath);
      assert.equal(bytes.readBigUInt64LE(0), 0n);
      if (data.length === 1) assert.equal(bytes.readBigUInt64LE(8), BigInt(Buffer.byteLength(stringify(expected[0])) + 1));
    }
  }
  {
    const outDir = path.join(root, 'trim'); await fs.mkdir(outDir);
    const trimmed = chunk('trim', { docmeta: { signature: 'x'.repeat(40000), exported: false } });
    const dropped = chunk('drop'); dropped.metaV2.symbol.qualifiedName = 'x'.repeat(40000);
    const writes = [];
    await enqueueSymbolsArtifacts({ state: { chunks: [trimmed, dropped] }, outDir,
      enqueueWrite: (label, job) => writes.push(job), addPieceFile() {}, formatArtifactLabel: value => value });
    for (const job of writes) await job();
    const lines = (await fs.readFile(path.join(outDir, 'symbols.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.symbolId, 'sym:trim');
    assert.equal(row.signature, null); assert.equal(row.name, null); assert.equal(row.kind, null); assert.equal(row.lang, null);
    assert.ok(Buffer.byteLength(lines[0]) + 1 <= 32768, 'original trim stages and row limit are preserved');
  }
} finally { JSON.stringify = stringify; await rmDirRecursive(root); }
console.log('Prepared actual symbol raw/gzip/sharded/offset/trim controls authored; execution deferred.');
