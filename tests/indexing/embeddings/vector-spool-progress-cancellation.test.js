import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createEmbeddingVectorSpool } from '../../../tools/build/embeddings/vector-spool.js';
import { buildEmbeddingGenerationAsync } from '../../../src/shared/embedding-generation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('vector-spool-progress-cancellation', { clean: true });
const rows = indices => ({ items: indices.map(index => ({ index })), channels: Object.fromEntries(['code', 'doc', 'merged'].map(channel =>
  [channel, indices.map(index => Uint8Array.of(index, index + 1, index + 2, index + 3))])) });
const originalOpen = fsp.open, originalRead = fs.readSync;
let writeMode = 'short', abortOnWrite = null, releaseBlocked = null, blocked = null;
fsp.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (String(args[0]).includes('.stage3-vector-spool-')) {
    const write = handle.write.bind(handle);
    handle.write = async (buffer, offset, length, position) => {
      if (writeMode === 'zero') return { bytesWritten: 0, buffer };
      if (writeMode === 'block') { writeMode = 'short'; blocked?.(); await new Promise(resolve => { releaseBlocked = resolve; }); }
      const result = await write(buffer, offset, Math.min(2, length), position);
      if (abortOnWrite) { abortOnWrite.abort(); abortOnWrite = null; }
      return result;
    };
  }
  return handle;
};
try {
  const short = await createEmbeddingVectorSpool({ parentDir: dir, count: 8, dims: 4, windowBytes: 8 });
  try {
    const input = rows([0, 1, 6, 7]);
    await short.writeFile(input.items, input.channels); await short.seal();
    fs.readSync = (fd, buffer, offset, length, position) => originalRead(fd, buffer, offset, Math.min(2, length), position);
    assert.deepEqual([...short.vectors.code].map(row => Array.from(row)), [[0, 1, 2, 3], [1, 2, 3, 4], [], [], [], [], [6, 7, 8, 9], [7, 8, 9, 10]]);
    assert(short.stats().writeCalls > 6); assert(short.stats().readCalls > 2);
    fs.readSync = () => 0;
    assert.throws(() => short.vectors.code[0], { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
    fs.readSync = originalRead;
    const abort = new AbortController();
    setImmediate(() => abort.abort());
    await assert.rejects(buildEmbeddingGenerationAsync({ embeddingIdentity: {}, chunksByFile: new Map(), vectors: short.vectors,
      signal: abort.signal }), { name: 'AbortError' });
  } finally { fs.readSync = originalRead; await short.close(); }

  writeMode = 'zero';
  const zero = await createEmbeddingVectorSpool({ parentDir: dir, count: 1, dims: 4 });
  let primary;
  try {
    const input = rows([0]);
    await assert.rejects(zero.writeFile(input.items, input.channels), error => {
      primary = error; return error.code === 'ERR_EMBEDDING_VECTOR_SPOOL' && error.vectorSpoolFailure === true;
    });
    await assert.rejects(zero.seal(), error => error === primary);
    assert.equal(zero.stats().sealed, false);
  } finally { await zero.close(); }
  await assert.rejects(fsp.stat(zero.directory), { code: 'ENOENT' });

  writeMode = 'block';
  let signalBlocked;
  const blockedWrite = new Promise(resolve => { signalBlocked = resolve; }); blocked = signalBlocked;
  const owned = await createEmbeddingVectorSpool({ parentDir: dir, count: 2, dims: 4 });
  try {
    const input = rows([0, 1]), pending = owned.writeFile(input.items, input.channels);
    await blockedWrite;
    await assert.rejects(owned.seal(), { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
    await assert.rejects(owned.writeFile(input.items, input.channels), { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
    releaseBlocked(); await pending; await owned.seal();
    assert.equal(owned.stats().rowsWritten, 2);
  } finally { releaseBlocked?.(); await owned.close(); }

  const abort = new AbortController(); abortOnWrite = abort; writeMode = 'short';
  const cancelled = await createEmbeddingVectorSpool({ parentDir: dir, count: 2, dims: 4, signal: abort.signal });
  try {
    const input = rows([0, 1]);
    await assert.rejects(cancelled.writeFile(input.items, input.channels), { name: 'AbortError' });
    assert.equal(cancelled.stats().sealed, false);
    assert.equal(cancelled.stats().rowsWritten, 0, 'partial channel bytes never become occupied durable rows');
  } finally { await cancelled.close(); }
  await assert.rejects(fsp.stat(cancelled.directory), { code: 'ENOENT' });
} finally { fsp.open = originalOpen; fs.readSync = originalRead; }
console.log('vector spool short progress, duplicate admission, seal ownership and cancellation assertions complete');
