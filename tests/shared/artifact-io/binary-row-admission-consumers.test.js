import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { loadChunkMetaRows, loadChunkMetaIdentityRows } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('binary-row-admission-consumers');
const allowance = 32768, count = 2048, samples = [];
const writeFixture = async (family, rows) => {
  const target = path.join(dir, family); await fs.mkdir(target, { recursive: true });
  const base = `${family}.binary-columnar`, framed = encodeBinaryRowFrames(rows.map(row => Buffer.from(JSON.stringify(row))));
  const files = { [`${base}.bin`]: framed.dataBuffer, [`${base}.offsets.bin`]: framed.offsetsBuffer,
    [`${base}.lengths.varint`]: framed.lengthsBuffer,
    [`${base}.meta.json`]: JSON.stringify({ fields: { format: 'binary-columnar-v1', count: rows.length,
      data: `${base}.bin`, offsets: `${base}.offsets.bin`, lengths: `${base}.lengths.varint` }, arrays: { fileTable: ['src/source.js'] } }) };
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(target, name), bytes);
  await writePiecesManifest(target, Object.keys(files).map((name, index) => ({
    name: index === 0 ? family : `${family}_binary_columnar_${index}`, path: name,
    format: index === 0 ? 'binary-columnar' : index === 3 ? 'json' : 'bin' })));
  return { target, framed, dataPath: path.join(target, base + '.bin') };
};
const row = id => ({ id, fileRef: 0, file: 'src/source.js', virtualPath: 'src/source.js',
  chunkId: `chunk-${id}`, chunkUid: `ck64:v1:test:src/source.js:${id.toString(16).padStart(16, '0')}`,
  start: id, end: id + 1, docmeta: { doc: '雪'.repeat(256) } });
const originalRead = fsSync.readSync;
try {
  for (const family of ['sample', 'chunk_meta']) {
    const fixture = await writeFixture(family, Array.from({ length: count }, (_value, id) => row(id)));
    assert.ok(fixture.framed.dataBuffer.length > allowance * 32, 'corpus size and row allowance vary independently');
    let largestBuffer = 0, largestRequest = 0, dataReads = 0;
    fsSync.readSync = function (fd, buffer, offset, length, position) {
      if (fsSync.fstatSync(fd).size === fixture.framed.dataBuffer.length) {
        largestBuffer = Math.max(largestBuffer, buffer.length); largestRequest = Math.max(largestRequest, length); dataReads++;
        length = Math.min(length, 73); // positive short-read loops remain active
      }
      return originalRead.call(this, fd, buffer, offset, length, position);
    };
    const loader = (strict, identity = false) => family === 'sample'
      ? loadJsonArrayArtifactRows(fixture.target, family, { strict, maxBytes: allowance, enforceBinaryDataBudget: false })
      : (identity ? loadChunkMetaIdentityRows : loadChunkMetaRows)(fixture.target,
        { strict, maxBytes: allowance, includeCold: false, enforceBinaryDataBudget: false });
    for (const strict of [true, false]) for (const identity of family === 'sample' ? [false] : [false, true]) {
      let observed = 0;
      for await (const actual of loader(strict, identity)) {
        assert.equal(actual.id, observed); assert.equal(actual.chunkUid, row(observed).chunkUid);
        if (!identity) assert.equal(actual.docmeta.doc, row(observed).docmeta.doc);
        observed++;
      }
      assert.equal(observed, count);
    }
    assert.ok(largestBuffer <= allowance); assert.ok(largestRequest <= allowance);
    samples.push({ family, rows: count, corpusBytes: fixture.framed.dataBuffer.length, rowAllowance: allowance,
      largestBuffer, largestRequest, dataReads,
      retainedFrameAndSidecarBytes: largestBuffer + fixture.framed.offsetsBuffer.length + fixture.framed.lengthsBuffer.length });
    fsSync.readSync = originalRead;
    const empty = row(0); empty.docmeta.doc = '';
    const overhead = Buffer.byteLength(JSON.stringify(empty));
    for (const width of [allowance - 1, allowance, allowance + 1]) {
      const wide = { ...empty, docmeta: { doc: 'x'.repeat(width - overhead) } };
      const next = await writeFixture(family, [wide]); assert.equal(next.framed.dataBuffer.length, width);
      let readBytes = 0;
      fsSync.readSync = function (fd, buffer, offset, length, position) {
        if (fsSync.fstatSync(fd).size === width) readBytes += length;
        return originalRead.call(this, fd, buffer, offset, length, position);
      };
      for (const strict of [true, false]) {
        const consume = async () => {
          const values = family === 'sample' ? loadJsonArrayArtifactRows(next.target, family,
            { strict, maxBytes: allowance, enforceBinaryDataBudget: false })
            : loadChunkMetaIdentityRows(next.target, { strict, maxBytes: allowance, enforceBinaryDataBudget: false });
          let actual = 0; for await (const _value of values) actual++; return actual;
        };
        if (width > allowance) { await assert.rejects(consume, { code: 'ERR_ARTIFACT_TOO_LARGE' }); assert.equal(readBytes, 0); }
        else assert.equal(await consume(), 1);
      }
      fsSync.readSync = originalRead;
    }
  }
} finally { fsSync.readSync = originalRead; await fs.rm(dir, { recursive: true, force: true }); }
console.log(JSON.stringify({ samples }));
console.log('Generic, strict/trusted and identity-projection streams admit one bounded row independently of large corpus size.');
