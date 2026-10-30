import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { loadJsonArrayArtifactRows, loadFileMetaRows } from '../../../src/shared/artifact-io/loaders.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('offsets-canonical-count-consumers');
const collect = async rows => { const result = []; for await (const row of rows) result.push(row); return result; };
const originalOpen = fs.open;
const originalSyncOpen = fsSync.openSync, originalSyncRead = fsSync.readSync, originalSyncClose = fsSync.closeSync;
const syncData = new Set();
let opened = 0, closed = 0, dataReadBytes = 0, abortDuringRead = null;
const dataPaths = new Set();
fsSync.openSync = (target, ...args) => {
  const fd = originalSyncOpen(target, ...args);
  if (typeof target === 'string' && dataPaths.has(path.resolve(target))) { syncData.add(fd); opened++; }
  return fd;
};
fsSync.readSync = (fd, ...args) => {
  const count = originalSyncRead(fd, ...args);
  if (syncData.has(fd)) dataReadBytes += count;
  return count;
};
fsSync.closeSync = fd => {
  const result = originalSyncClose(fd);
  if (syncData.delete(fd)) closed++;
  return result;
};
fs.open = async (target, ...options) => {
  const handle = await originalOpen(target, ...options); opened++;
  const close = handle.close.bind(handle), read = handle.read.bind(handle);
  handle.close = async () => { closed++; return close(); };
  handle.read = async (...args) => {
    const result = await read(...args);
    if (dataPaths.has(path.resolve(target))) dataReadBytes += result.bytesRead;
    abortDuringRead?.abort(); return result;
  };
  return handle;
};
try {
  for (const family of ['sample', 'file_meta']) for (const backupData of [false, true]) for (const backupOffsets of [false, true]) {
    const target = path.join(dir, `${family}-${backupData}-${backupOffsets}`); await fs.mkdir(target);
    const expected = [], pieces = [], parts = [], offsets = [], sidecars = [];
    let payloadBytes = 0;
    for (const [part, count] of [2, 3].entries()) {
      // .bak is part of this legitimate canonical filename, not a recovery suffix.
      const filename = `rows.bak.part-${String(part).padStart(6, '0')}.jsonl`, sidecar = filename + '.offsets.bin';
      const rows = Array.from({ length: count }, (_, id) => ({ id: part * 10 + id, file: `src/${part}-${id}.js` }));
      const lines = rows.map(row => JSON.stringify(row) + '\n'), positions = Buffer.alloc(count * 8);
      let position = 0; lines.forEach((line, index) => { positions.writeBigUInt64LE(BigInt(position), index * 8); position += Buffer.byteLength(line); });
      const dataPath = path.join(target, filename + (backupData ? '.bak' : ''));
      const offsetsPath = path.join(target, sidecar + (backupOffsets ? '.bak' : ''));
      await fs.writeFile(dataPath, lines.join('')); await fs.writeFile(offsetsPath, positions);
      dataPaths.add(dataPath); payloadBytes += position; expected.push(...rows); sidecars.push({ offsetsPath, positions });
      parts.push(filename); offsets.push(sidecar); pieces.push({ name: family, path: filename, format: 'jsonl', count });
    }
    await fs.writeFile(path.join(target, 'rows.meta.json'), JSON.stringify({ format: 'jsonl-sharded', parts, offsets }));
    pieces.push({ name: family + '_meta', path: 'rows.meta.json', format: 'json' });
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces };
    const load = signal => family === 'file_meta' ? loadFileMetaRows(target, { manifest, signal })
      : loadJsonArrayArtifactRows(target, family, { manifest, signal });
    dataReadBytes = 0;
    assert.deepEqual(await collect(load()), expected);
    assert.ok(dataReadBytes >= payloadBytes, 'observe actual sequential payload bytes as well as offset-boundary reads');
    assert.ok(dataReadBytes <= payloadBytes * 2, 'canonical count binding adds no new payload scan');
    assert.equal(opened, closed);
    delete pieces[0].count;
    assert.deepEqual(await collect(load()), expected, 'legacy absent-count evidence stays distinct from a failed canonical lookup');
    pieces[0].count = 2;
    for (const { offsetsPath, positions } of sidecars) {
      await fs.writeFile(offsetsPath, positions.subarray(0, 8));
      dataReadBytes = 0;
      const iterator = load();
      if (sidecars[0].offsetsPath === offsetsPath) {
        await assert.rejects(iterator.next(), { code: 'ERR_OFFSETS_INVALID' });
        assert.equal(dataReadBytes, 0, 'declared cardinality fails before any payload scan');
      }
      else await assert.rejects(collect(iterator), { code: 'ERR_OFFSETS_INVALID' });
      await fs.writeFile(offsetsPath, positions); assert.equal(opened, closed);
    }
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(collect(load(aborted.signal)), { name: 'AbortError' });
    abortDuringRead = new AbortController();
    await assert.rejects(collect(load(abortDuringRead.signal)), { name: 'AbortError' }); abortDuringRead = null;
    assert.equal(opened, closed);
    assert.deepEqual(await collect(load()), expected, 'cancellation cannot leave reusable path-only proof');
  }
} finally {
  fs.open = originalOpen; fsSync.openSync = originalSyncOpen; fsSync.readSync = originalSyncRead; fsSync.closeSync = originalSyncClose;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Generic and dedicated file streams retain canonical per-shard counts through primary/backup reads and cancellation.');
