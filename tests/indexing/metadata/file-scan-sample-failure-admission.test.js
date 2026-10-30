import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFileScanner, readFileSample } from '../../../src/index/build/file-scan.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('file-scan-sample-failure-admission');
const file = path.join(dir, 'source.txt'), bytes = Buffer.from('ordinary source text\n'.repeat(2048));
const originalOpen = fs.open, retained = new Map();
const scanner = createFileScanner({ sampleBytes: 16384, tier1ProbeBytes: 8192, binary: { sampleMinBytes: 1 } });
const observations = [];
const containsOriginal = (failure, original) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === original) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
try {
  for (const phase of [1, 2]) for (const fault of ['changed', 'abort', 'pending-close']) {
    await fs.writeFile(file, bytes); const stat = await fs.stat(file), controller = new AbortController();
    const primary = Object.freeze(new Error('original source sample close remains unconfirmed'));
    let opens = 0, allowClose = false, selectedHandle, reads = 0, closes = 0;
    const requests = [];
    fs.open = async (filename, ...args) => {
      const handle = await originalOpen(filename, ...args);
      if (path.resolve(String(filename)) !== file || ++opens !== phase) return handle;
      selectedHandle = handle; const read = handle.read.bind(handle), close = handle.close.bind(handle);
      retained.set(handle, close);
      handle.read = async (...readArgs) => {
        reads++; const result = await read(...readArgs);
        if (reads === 1 && fault === 'changed') await fs.appendFile(file, 'x');
        if (reads === 1 && fault === 'abort') controller.abort();
        return result;
      };
      handle.close = async () => {
        closes++; if (fault === 'pending-close' && !allowClose) throw primary;
        await close(); retained.delete(handle);
      };
      return handle;
    };
    let failure;
    await assert.rejects(scanner.scanFile({ absPath: file, stat, ext: '.txt', readSample: (filename, count) => {
      requests.push(count); return readFileSample(filename, count, dir, { signal: controller.signal });
    } }), error => {
      failure = error;
      return fault === 'changed' ? error.code === 'ERR_FILE_CHANGED'
        : fault === 'abort' ? error.name === 'AbortError' || error.code === 'ABORT_ERR'
          : error.cacheOwnershipReleased() === false;
    });
    assert.deepEqual(requests, phase === 1 ? [8192] : [8192, 16384], 'original tier windows and actual extended branch remain intact');
    assert.equal(opens, phase);
    if (fault === 'pending-close') {
      assert.equal(containsOriginal(failure, primary), true, 'the exact frozen original close failure survives consumer composition');
      const before = reads; allowClose = true;
      await getContainedFileSession(failure).releaseAfterClose();
      assert.equal(reads, before, 'recovery closes the original owner without replaying source I/O');
      assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(closes, 2);
    } else assert.equal(closes, 1);
    assert.equal(selectedHandle.fd, -1); fs.open = originalOpen;
    observations.push({ phase, fault, requests, reads, closes });
  }
  await fs.writeFile(file, bytes); const requests = [];
  const healthy = await scanner.scanFile({ absPath: file, stat: await fs.stat(file), ext: '.txt',
    readSample: (filename, count) => { requests.push(count); return readFileSample(filename, count, dir); } });
  assert.deepEqual(requests, [8192, 16384]); assert.deepEqual(healthy.sampleBuffer, bytes.subarray(0, 16384));
  assert.equal(healthy.checkedBinary, true); assert.equal(healthy.skip, null);
  const optional = await scanner.scanFile({ absPath: file, stat: await fs.stat(file), ext: '.txt',
    readSample: async () => { throw Object.assign(new Error('ordinary unavailable optional content probe'), { code: 'EACCES' }); } });
  assert.equal(optional.sampleBuffer, null); assert.equal(optional.checkedBinary, false);
  console.log(JSON.stringify({ observations, healthyRequests: requests, ordinaryOptionalProbeRetained: true }));
} finally {
  fs.open = originalOpen; for (const close of retained.values()) await close();
  await fs.rm(dir, { recursive: true, force: true });
}
