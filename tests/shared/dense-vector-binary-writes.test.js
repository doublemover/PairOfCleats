import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeDenseVectorBinaryFile, loadDenseVectorBinaryFromMetaAsync } from '../../src/shared/dense-vector-binary.js';
import { writeDenseVectorArtifacts, normalizeDenseVectorMeta } from '../../src/shared/dense-vector-artifacts.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { ensureTestingEnv } from '../helpers/test-env.js';

ensureTestingEnv(process.env);
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/dense-vector-binary-writes/')[1];
assert.ok(['normal', 'partial', 'zero-progress', 'write-error', 'artifact-api'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir(`dense-writes-${mode}`);
const output = path.join(dir, 'artifacts'), binPath = path.join(output, 'dense.bin');
await fs.mkdir(output);
const prior = Buffer.from([91, 92, 93, 94, 95, 96]);
await fs.writeFile(binPath, prior);
// Multiple physical chunks and distinct rows reveal dropped tails or reordered bytes.
const small = mode === 'normal' || mode === 'zero-progress' || mode === 'artifact-api';
const dims = small ? 3 : 1536;
const vectors = small ? [[1, 2, 3], [4, 5, 6]]
  : Array.from({ length: 1000 }, (_, row) => Uint8Array.from({ length: dims }, (_, column) => (17 * row + column) & 255));
const expected = Buffer.concat(vectors.map(vector => Buffer.from(vector)));
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const originalOpen = fs.open, handles = [], writes = [];
let result = null, failure = null;
fs.open = async (file, flags, ...rest) => {
  const handle = await originalOpen(file, flags, ...rest);
  if (flags !== 'w' || !file.startsWith(`${binPath}.tmp-`)) return handle;
  handles.push(handle);
  const originalWrite = handle.write.bind(handle);
  handle.write = async (buffer, offset, length, position) => {
    writes.push({ offset, length, position: position ?? null });
    if (mode === 'zero-progress') {
      assert.equal(writes.length, 1, 'zero progress must fail immediately, without spinning');
      return { bytesWritten: 0, buffer };
    }
    if (mode === 'write-error' && writes.length === 2) {
      throw Object.assign(new Error('Explicit actual-handle I/O fault'), { code: 'EIO' });
    }
    const requested = ['partial', 'write-error', 'artifact-api'].includes(mode)
      ? Math.max(1, Math.floor(length / 3)) : length;
    return originalWrite(buffer, offset, requested, position);
  };
  return handle;
};
try {
  if (mode === 'artifact-api') {
    const artifacts = await writeDenseVectorArtifacts({ indexDir: output, baseName: 'dense',
      vectorFields: { dims }, vectors, writeBinary: true });
    assert.equal(artifacts.binPath, binPath);
    const meta = normalizeDenseVectorMeta(JSON.parse(await fs.readFile(artifacts.binMetaPath, 'utf8')));
    assert.equal(meta.format, 'uint8-row-major');
    result = { count: meta.count, rowWidth: meta.dims, totalBytes: meta.bytes };
  } else result = await writeDenseVectorBinaryFile({ binPath, vectors, dims });
}
catch (error) { failure = error; }
finally { fs.open = originalOpen; }
const actual = await fs.readFile(binPath), files = (await fs.readdir(output)).sort();
const receipt = { mode, result, errorCode: failure?.code ?? null, writeCount: writes.length,
  intendedBytes: expected.length, actualBytes: actual.length,
  intendedSha256: hash(expected), actualSha256: hash(actual), previousPreserved: actual.equals(prior), files };
await fs.writeFile(path.join(dir, 'write-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
assert.equal(handles.length, 1, 'the actual temporary FileHandle supplies the fault injection');
assert.ok(handles.every(handle => handle.fd === -1), 'temporary handles close before return or rejection');
if (['normal', 'partial', 'artifact-api'].includes(mode)) {
  assert.equal(failure, null);
  assert.deepEqual(result, { count: vectors.length, rowWidth: dims, totalBytes: expected.length });
  assert.equal(actual.length, expected.length, 'all intended bytes must reach the promoted file');
  assert.equal(hash(actual), hash(expected), 'every row and chunk preserves byte order');
  if (mode === 'partial') {
    assert.ok(writes.some(write => write.offset > 0), 'the writer retries an unwritten suffix');
    assert.ok(writes.filter(write => write.offset === 0).length >= 2, 'the fixture spans physical chunks');
  }
  const loaded = await loadDenseVectorBinaryFromMetaAsync({ dir: output, baseName: 'dense',
    meta: { path: 'dense.bin', dims, count: vectors.length } });
  assert.ok(loaded, 'the production binary loader admits the complete promoted payload');
  assert.equal(hash(loaded.buffer), hash(expected));
} else {
  assert.ok(failure, 'failed/zero-progress I/O cannot report successful artifact publication');
  assert.equal(failure.code, mode === 'zero-progress' ? 'ERR_DENSE_VECTOR_SHORT_WRITE' : 'EIO');
  assert.equal(actual.equals(prior), true, 'the previous complete destination remains intact');
}
assert.deepEqual(files, mode === 'artifact-api'
  ? ['dense.bin', 'dense.bin.meta.json', 'dense.meta.json', 'dense.parts'] : ['dense.bin'],
'completed and failed operations leave no temporary artifacts');
