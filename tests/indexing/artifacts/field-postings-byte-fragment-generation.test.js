import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { enqueueFieldPostingsShards, writeFieldPostingsFragments, mergeFieldPostingsFragments,
  FIELD_POSTINGS_FRAGMENT_LAYOUT } from '../../../src/index/build/artifacts/field-postings-shards.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-field-fragments-'));
const makeField = size => ({ vocab: Array.from({ length: size }, (_, index) => `雪😀,"${index}`),
  postings: Array.from({ length: size }, (_, index) => [[index, 1], [index + 1, 2]]),
  docLengths: [1, 2], totalDocs: 2, avgDocLen: 1.5 });
try {
  let index = 0;
  for (const fields of [{}, { only: '雪😀' }, { only: makeField(60) }, { dominant: makeField(60), tiny: makeField(1), empty: makeField(0) },
    Object.fromEntries(Array.from({ length: 40 }, (_, id) => [`field-${id}`, makeField(1)]))]) {
    const directory = path.join(root, String(index++));
    const expected = Buffer.from(JSON.stringify({ fields }) + '\n');
    for (const cap of [...(expected.length <= 64 ? [1] : []), 71, 1024, expected.length]) {
      const output = path.join(directory, String(cap));
      const result = await writeFieldPostingsFragments({ directory: output, fields, maxPartBytes: cap });
      assert.equal(result.totalBytes, expected.length);
      assert.equal(result.parts.length, Math.ceil(expected.length / cap));
      let offset = 0;
      const buffers = [];
      for (const part of result.parts) {
        assert.equal(part.offset, offset);
        assert.ok(part.bytes > 0 && part.bytes <= cap);
        const bytes = await fs.readFile(path.join(output, part.filename));
        assert.equal(bytes.length, part.bytes);
        assert.equal(createHash('sha1').update(bytes).digest('hex'), part.checksum);
        offset += part.bytes; buffers.push(bytes);
      }
      assert.deepEqual(Buffer.concat(buffers), expected, 'fragments retain UTF-8, punctuation and exact row order');
      const targetPath = path.join(directory, `merged-${cap}.json`), metrics = {};
      await mergeFieldPostingsFragments({ root: output, parts: result.parts, targetPath, metrics });
      assert.deepEqual(await fs.readFile(targetPath), expected);
      assert.ok(metrics.readChunkBytesHighWater <= 65536);
      assert.equal(metrics.readBytes, expected.length);
      if (cap === 71) {
        await fs.writeFile(targetPath, 'old authority');
        const corrupt = result.parts.map(part => ({ ...part })); corrupt[0].checksum = '0'.repeat(40);
        await assert.rejects(mergeFieldPostingsFragments({ root: output, parts: corrupt, targetPath }), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
        assert.equal(await fs.readFile(targetPath, 'utf8'), 'old authority');
        corrupt[0] = { ...result.parts[0], offset: 1 };
        await assert.rejects(mergeFieldPostingsFragments({ root: output, parts: corrupt, targetPath }), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
        await assert.rejects(mergeFieldPostingsFragments({ root: output, parts: result.parts.slice(0, -1), targetPath }),
          { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
        await assert.rejects(mergeFieldPostingsFragments({ root: output, parts: result.parts, targetPath,
          expectedTotalBytes: expected.length + 1 }), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
        assert.equal(await fs.readFile(targetPath, 'utf8'), 'old authority');
      }
    }
  }
  const generationRoot = path.join(root, 'generation'); await fs.mkdir(generationRoot);
  await fs.writeFile(path.join(generationRoot, 'field_postings.json'), '{"fields":{"old":{}}}\n');
  await fs.mkdir(path.join(generationRoot, 'field_postings.shards.bak'));
  await fs.writeFile(path.join(generationRoot, 'field_postings.shards.bak', 'recovery'), 'retained');
  for (const fault of ['source', 'metadata', null]) {
    const tasks = [], pieces = [];
    let serializations = 0;
    const fields = { only: { toJSON() { serializations++;
      if (fault === 'source') throw Object.assign(new Error('invalid source'), { code: 'EIO' });
      return makeField(30);
    } } };
    // A getter is used for the source failure because the legacy JSON encoder
    // deliberately tolerates exceptions from a user-defined toJSON method.
    if (fault === 'source') Object.defineProperty(fields, 'invalid', { enumerable: true, get() { throw new Error('invalid source'); } });
    const plan = await enqueueFieldPostingsShards({ outDir: generationRoot, fields, estimatedBytes: 4096,
      desiredShardCount: 2, targetPartBytes: 128,
      enqueueWrite: (label, job, meta) => tasks.push({ label, job, meta }),
      addPieceFile: (piece, file) => pieces.push({ ...piece, path: path.relative(generationRoot, file).split(path.sep).join('/') }),
      formatArtifactLabel: filename => path.relative(generationRoot, filename).split(path.sep).join('/') });
    assert.ok(plan.generation.startsWith('field_postings.gen-'));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].meta.estimatedBytes, 128, 'admitted encoder owns one bounded current fragment');
    const rename = fs.rename;
    if (fault === 'metadata') fs.rename = async (from, to) => {
      if (to === plan.metaPath) throw Object.assign(new Error('metadata write denied'), { code: 'EIO' });
      return rename(from, to);
    };
    try {
      if (fault) { await assert.rejects(tasks[0].job(), fault === 'source' ? /invalid source/ : { code: 'EIO' });
        assert.equal(pieces.length, 0, 'failed generation cannot register partial family authority'); }
      else {
        const result = await tasks[0].job();
        assert.ok(result.serializationMs >= 0);
        assert.equal(serializations, 1);
        const meta = JSON.parse(await fs.readFile(plan.metaPath, 'utf8'));
        assert.equal(meta.schemaVersion, '2.0.0');
        assert.equal(meta.layout, FIELD_POSTINGS_FRAGMENT_LAYOUT);
        assert.equal(meta.parts.length, meta.shardCount);
        assert.equal(pieces.length, meta.shardCount + 2);
        assert.deepEqual(JSON.parse(await fs.readFile(plan.legacyPath, 'utf8')), { fields: { only: makeField(30) } });
      }
    } finally { fs.rename = rename; }
    assert.equal(await fs.readFile(path.join(generationRoot, 'field_postings.json'), 'utf8'), '{"fields":{"old":{}}}\n');
    assert.equal(await fs.readFile(path.join(generationRoot, 'field_postings.shards.bak', 'recovery'), 'utf8'), 'retained');
  }
  const ownerRoot = path.join(root, 'read-owner');
  const owned = await writeFieldPostingsFragments({ directory: ownerRoot, fields: { only: makeField(30) }, maxPartBytes: 97 });
  const ownerTarget = path.join(root, 'read-owner.json'); await fs.writeFile(ownerTarget, 'old authority');
  const firstPath = path.join(ownerRoot, owned.parts[0].filename), nativeOpen = fs.open;
  const closeFailure = Object.freeze(new Error('independent original fragment close failed'));
  let rejectClose = true, closeCalls = 0, readCalls = 0, failure;
  fs.open = async (...args) => {
    const handle = await nativeOpen(...args);
    if (args[0] === firstPath) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = (buffer, offset, length, position) => { readCalls++; return read(buffer, offset, Math.min(3, length), position); };
      handle.close = async () => { closeCalls++; if (rejectClose) { rejectClose = false; throw closeFailure; } return close(); };
    }
    return handle;
  };
  try {
    const metrics = {}, corrupt = owned.parts.map((part, index) => index ? part : { ...part, checksum: '0'.repeat(40) });
    await assert.rejects(mergeFieldPostingsFragments({ root: ownerRoot, parts: corrupt, targetPath: ownerTarget, metrics }), error => {
      failure = error; return error.code === 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' && error.cacheOwnershipPending === true;
    });
    assert.equal(metrics.shardsRead || 0, 0, 'read completion is withheld until original closure');
    assert.equal(closeCalls, 1);
    const session = getContainedFileSession(failure); assert.ok(session);
    await session.releaseAfterClose();
    assert.equal(session.isSettled(), true); assert.equal(closeCalls, 2);
    assert.equal(await fs.readFile(ownerTarget, 'utf8'), 'old authority');
    const expected = Buffer.from(JSON.stringify({ fields: { only: makeField(30) } }) + '\n');
    await mergeFieldPostingsFragments({ root: ownerRoot, parts: owned.parts, expectedTotalBytes: owned.totalBytes,
      targetPath: ownerTarget });
    assert.deepEqual(await fs.readFile(ownerTarget), expected); assert.ok(readCalls > 2);
  } finally {
    if (failure) {
      const session = getContainedFileSession(failure);
      if (session && !session.isSettled()) await session.releaseAfterClose();
    }
    fs.open = nativeOpen;
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(writeFieldPostingsFragments({ directory: path.join(root, 'aborted'), fields: { only: makeField(1) },
    maxPartBytes: 1024, signal: controller.signal }), { name: 'AbortError' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Field-postings byte fragments preserve exact legacy output, byte caps and prior generation authority.');
