import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashFileObservation, checksumString, setXxhashBackend } from '../../../src/shared/hash.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { errorGraphSome } from '../../helpers/error-graph.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const nativeMetadata = selected?.startsWith('native-'), scenario = selected?.replace(/^native-/, '');
assert.ok(['exact-work', 'unsafe-extent', 'timestamp-race'].includes(scenario));
const { dir } = await prepareIsolatedTestCacheDir(`hash-stat-work-${selected}`);
const file = path.join(dir, 'payload'), bytes = Buffer.from('bounded descriptor observation\n'.repeat(5000));
await fs.writeFile(file, bytes);
const originalOpen = fs.open;
const originalNativeStat = fsSync.fstatSync, ownedDescriptors = new Set();
let calls = 0, exactCalls = 0, nativeCalls = 0, closes = 0, largestRead = 0, readBytes = 0;
const faultMetadata = (value, sequence) => scenario === 'exact-work' ? value : new Proxy(value, { get(target, key) {
  if (key === 'size' && scenario === 'unsafe-extent') return BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  if (key === 'mtimeNs' && scenario === 'timestamp-race' && sequence > 1) return target.mtimeNs + 1n;
  return Reflect.get(target, key);
} });
fsSync.fstatSync = (fd, ...args) => {
  const value = originalNativeStat(fd, ...args);
  if (!nativeMetadata || !ownedDescriptors.has(fd)) return value;
  nativeCalls++;
  // Acquisition is first; the next two observations are the actual exact
  // pre/post hash metadata, always from the same original descriptor.
  return nativeCalls === 2 || nativeCalls === 3 ? faultMetadata(value, nativeCalls - 1) : value;
};
fs.open = async function (filename, ...args) {
  const handle = await originalOpen.call(this, filename, ...args);
  if (filename !== file) return handle;
  ownedDescriptors.add(handle.fd);
  const stat = handle.stat, read = handle.read, close = handle.close;
  handle.stat = async function (...args) {
    calls++;
    const value = await stat.apply(this, args);
    if (!args[0]?.bigint) return value;
    exactCalls++;
    return faultMetadata(value, exactCalls);
  };
  handle.read = async function (buffer, offset, length, position) {
    largestRead = Math.max(largestRead, length);
    const result = await read.call(this, buffer, offset, length, position);
    readBytes += result.bytesRead; return result;
  };
  handle.close = async function () { closes++; return close.call(this); };
  return handle;
};
try {
  setXxhashBackend('wasm');
  const options = { algorithms: ['sha256', 'sha1', 'xxh64'], containedRoot: dir, nativeMetadata };
  if (scenario === 'exact-work') {
    const result = await hashFileObservation(file, options), actual = await fs.stat(file, { bigint: true });
    assert.deepEqual(result.value, {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
      xxh64: (await checksumString(bytes.toString('utf8'))).value
    });
    assert.equal(result.bytes, bytes.length); assert.equal(readBytes, bytes.length);
    assert.ok(largestRead <= 65536);
    assert.deepEqual(result.fileIdentity, { dev: String(actual.dev), ino: String(actual.ino) });
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.value) && Object.isFrozen(result.fileIdentity));
    assert.ok(calls <= 2, `one exact pre/post observation must not also collect redundant numeric stats (${calls})`);
    if (nativeMetadata) { assert.equal(calls, 0); assert.equal(nativeCalls, 4, 'fresh admission, pre/post hash, and final identity observations'); }
  } else {
    await assert.rejects(hashFileObservation(file, options), error =>
      errorGraphSome(error, value => value?.code === 'ERR_FILE_CHANGED'));
    if (scenario === 'unsafe-extent') assert.equal(readBytes, 0, 'unrepresentable file extents must fail before payload I/O');
  }
  assert.equal(closes, 1, 'both success and rejection settle the original descriptor');
} finally {
  fs.open = originalOpen; fsSync.fstatSync = originalNativeStat; setXxhashBackend('auto');
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Bounded exact descriptor metadata and byte authority: ${selected}`);
