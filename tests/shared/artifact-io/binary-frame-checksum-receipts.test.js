import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeBinaryRowFrames, encodeBinaryRowFrames, readBinaryRowFrameMetadata } from '../../../src/shared/artifact-io/binary-columnar.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createManifestWorkProbe } from '../../helpers/manifest-work-probe.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['positive', 'empty', 'partial', 'oversized', 'forged', 'changed', 'replaced', 'parent-changed'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir('binary-frame-checksum-' + selected);
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const directory = path.join(root, 'frames'); await fs.mkdir(directory);
const paths = { dataPath: path.join(directory, 'data.bin'), offsetsPath: path.join(directory, 'offsets.bin'),
  lengthsPath: path.join(directory, 'lengths.bin') };
const rows = selected === 'empty' ? [] : selected === 'partial' ? Array.from({ length: 600 }, (_, index) => Buffer.from(`${index}:雪`))
  : selected === 'oversized' ? [Buffer.from('prefix'), Buffer.alloc(1024 * 1024 + 12345, 97), Buffer.from('suffix')]
    : [Buffer.from('alpha'), Buffer.from('雪😀'), Buffer.alloc(0)];
const originalOpen = fs.open;
let writes = 0;
try {
  if (selected === 'partial') fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[1] === 'wx') {
      const write = handle.write;
      handle.write = async function(buffer, offset, length, position) {
        writes++; return write.call(this, buffer, offset, Math.min(length, 13), position);
      };
    }
    return handle;
  };
  const result = await writeBinaryRowFrames({ ...paths, rowBuffers: rows, preallocateBytes: selected === 'empty' ? 1024 : null });
  fs.open = originalOpen;
  const expected = encodeBinaryRowFrames(rows), members = [[paths.dataPath, expected.dataBuffer],
    [paths.offsetsPath, expected.offsetsBuffer], [paths.lengthsPath, expected.lengthsBuffer]];
  for (const [filename, bytes] of members) {
    assert.deepEqual(await fs.readFile(filename), bytes, 'stored bytes retain the independent in-memory encoder parity');
    assert.deepEqual(await readBinaryRowFrameMetadata(result, filename), {
      bytes: bytes.length, checksumAlgo: 'sha256', checksum: createHash('sha256').update(bytes).digest('hex')
    });
  }
  if (selected === 'partial') assert.ok(writes > 3);
  if (selected === 'oversized') {
    const pieces = [];
    for (const [filename] of members) {
      const metadata = await readBinaryRowFrameMetadata(result, filename);
      pieces.push({ name: path.basename(filename), path: path.basename(filename), format: 'binary',
        bytes: metadata.bytes, checksum: `sha256:${metadata.checksum}` });
    }
    await fs.writeFile(path.join(directory, 'metadata.json'), '{"schemaVersion":1}');
    pieces.push({ name: 'metadata', path: 'metadata.json', format: 'json' });
    const probe = createManifestWorkProbe();
    try {
      const { writePiecesManifest } = await import('../../../src/index/build/artifacts/checksums.js');
      await writePiecesManifest({ outDir: directory, mode: 'code', indexState: { buildId: 'large-frame-proof' }, pieceEntries: pieces });
    } finally { probe.close(); }
    assert.equal(probe.metrics.manifests.length, 1);
    assert.deepEqual(probe.metrics.checksums.map(call => path.basename(call.filename)), ['metadata.json'],
      'above-one-MiB binary data and sidecars cannot be reread solely for manifest construction');
    console.log(JSON.stringify({ largeManifest: probe.metrics,
      sealedBytes: members.reduce((sum, [, bytes]) => sum + bytes.length, 0), binaryManifestReadBytes: 0 }));
  }
  if (selected === 'forged') {
    for (const copied of [{ ...result }, JSON.parse(JSON.stringify(result)), {}]) {
      await assert.rejects(readBinaryRowFrameMetadata(copied, paths.dataPath), { code: 'ERR_BINARY_COLUMNAR_RECEIPT' });
    }
    await assert.rejects(readBinaryRowFrameMetadata(result, path.join(directory, 'foreign.bin')), { code: 'ERR_BINARY_COLUMNAR_RECEIPT' });
    result.totalBytes = 999;
    assert.equal((await readBinaryRowFrameMetadata(result, paths.dataPath)).bytes, expected.dataBuffer.length,
      'mutable diagnostic fields cannot replace the private completed-byte receipt');
  } else if (selected === 'changed') {
    const bytes = await fs.readFile(paths.dataPath); bytes[0] ^= 1; await fs.writeFile(paths.dataPath, bytes);
    await assert.rejects(readBinaryRowFrameMetadata(result, paths.dataPath), { code: 'ERR_PERSISTENCE_FILE_CHANGED' });
  } else if (selected === 'replaced') {
    const temporary = path.join(directory, 'replacement.bin'); await fs.copyFile(paths.dataPath, temporary);
    await fs.rename(temporary, paths.dataPath);
    await assert.rejects(readBinaryRowFrameMetadata(result, paths.dataPath), { code: 'ERR_PERSISTENCE_FILE_CHANGED' });
  } else if (selected === 'parent-changed') {
    const retired = path.join(root, 'retired'); await fs.rename(directory, retired); await fs.mkdir(directory);
    for (const [filename] of members) await fs.copyFile(path.join(retired, path.basename(filename)), filename);
    await assert.rejects(readBinaryRowFrameMetadata(result, paths.dataPath));
  }
  console.log(JSON.stringify({ case: selected, rows: rows.length, bytes: expected.dataBuffer.length,
    storedByteDigests: true, originalWriterOnly: true, originalNativeWrites: writes }));
} finally {
  fs.open = originalOpen;
  const relative = path.relative(process.cwd(), root);
  assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.startsWith('..'));
  await fs.rm(root, { recursive: true, force: true });
}
