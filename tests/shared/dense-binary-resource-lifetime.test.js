import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { iterateDenseVectorBinaryRows, openDenseVectorBinarySourceSync } from '../../src/shared/dense-vector-stream.js';
import { loadDenseVectorBinaryFromMetaAsync, loadDenseVectorBinaryFromMetaSync, writeDenseVectorBinaryFile } from '../../src/shared/dense-vector-binary.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { writePiecesManifest } from '../helpers/artifact-io-fixture.js';

const { dir: root } = await prepareIsolatedTestCacheDir('dense-binary-resource-lifetime');
const filename = path.join(root, 'dense_vectors_uint8.bin'), bytes = Buffer.from([1, 2, 3, 4, 5, 6]);
const meta = { format: 'uint8-row-major', path: path.basename(filename), dims: 3, count: 2 };
await fsPromises.writeFile(filename, bytes);
const originalOpen = fsPromises.open, originalClose = fs.closeSync;
try {
  for (const mode of ['exhaust', 'early-return', 'optional-load', 'write']) {
    let attempts = 0, replacementCalls = 0, openedHandle = null, openedPath = null;
    const injected = new Error(`original close failure: ${mode}`);
    fsPromises.open = async (target, ...args) => {
      const handle = await originalOpen(target, ...args);
      if (target === filename && mode !== 'write' || mode === 'write' && args[0] === 'w') {
        openedHandle = handle; openedPath = target;
        const close = handle.close.bind(handle);
        handle.close = async () => { if (++attempts === 1) throw injected; await close(); };
      }
      return handle;
    };
    let failure;
    const action = async () => {
      if (mode === 'write') return writeDenseVectorBinaryFile({ binPath: filename, dims: 3, vectors: [[7, 8, 9], [10, 11, 12]] });
      if (mode === 'optional-load') return loadDenseVectorBinaryFromMetaAsync({ dir: root, baseName: 'dense_vectors_uint8', meta, strict: false });
      const rows = iterateDenseVectorBinaryRows({ root, filename, meta });
      for await (const row of rows) { assert.ok(row.vector.length); if (mode === 'early-return') break; }
    };
    await assert.rejects(action(), error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(attempts, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    const session = getContainedFileSession(failure);
    assert.ok(session, 'the actual consumer failure retains its original close-only capability');
    openedHandle.close = async () => { replacementCalls++; };
    assert.equal((await session.releaseAfterClose()).settled, true);
    assert.equal(attempts, 2); assert.equal(replacementCalls, 0);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.deepEqual(await fsPromises.readFile(filename), bytes, 'failed write never replaces the previous destination');
    if (mode === 'write') {
      assert.notEqual(openedPath, filename);
      assert.deepEqual(await fsPromises.readFile(openedPath), Buffer.from([7, 8, 9, 10, 11, 12]), 'close-only recovery never publishes a failed write');
      await fsPromises.rm(openedPath);
    }
    fsPromises.open = originalOpen;
  }
  let closed = 0;
  fs.closeSync = fd => { closed++; return originalClose(fd); };
  const source = openDenseVectorBinarySourceSync({ root, filename, meta });
  fs.closeSync = () => { throw new Error('replacement close must not receive original descriptor'); };
  for (const row of source) { assert.equal(row.docId, 0); break; }
  source.close();
  assert.equal(closed, 1, 'early return confirms the captured synchronous closer once');
  fs.closeSync = originalClose;
  await assert.rejects(loadDenseVectorBinaryFromMetaAsync({ dir: root, baseName: 'dense_vectors_uint8', meta, strict: true }),
    { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  await writePiecesManifest(root, [{ name: 'dense_vectors', path: path.basename(filename), format: 'bin' }]);
  const valid = await loadDenseVectorBinaryFromMetaAsync({ dir: root, baseName: 'dense_vectors_uint8', meta, strict: true });
  assert.deepEqual(Buffer.from(valid.buffer), bytes, 'strict reads reach the declared binary payload');
  for (const malformed of [{ ...meta, count: 0 }, { ...meta, count: null }, { ...meta, format: 'float32' }]) {
    assert.equal(loadDenseVectorBinaryFromMetaSync({ dir: root, baseName: 'dense_vectors_uint8', meta: malformed }), null);
    await assert.rejects(loadDenseVectorBinaryFromMetaAsync({ dir: root, baseName: 'dense_vectors_uint8', meta: malformed, strict: true }), { code: 'ERR_DENSE_VECTOR_INVALID' });
    assert.throws(() => loadDenseVectorBinaryFromMetaSync({ dir: root, baseName: 'dense_vectors_uint8', meta: malformed, strict: true }), { code: 'ERR_DENSE_VECTOR_INVALID' });
  }
} finally {
  fsPromises.open = originalOpen; fs.closeSync = originalClose;
  await fsPromises.rm(root, { recursive: true, force: true });
}
console.log('Dense binary readers, writers and early-return consumers retain original descriptor closure before success.');
