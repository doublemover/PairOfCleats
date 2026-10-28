import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { checksumFileObservation, sha256File, sha256FileObservation, setXxhashBackend } from '../../../src/shared/hash.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: original real FileHandle and hash owner, exact native identities,
// bounded reads, actual asynchronous digest completion and explicit recovery.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['plain', 'contained', 'high-identity', 'numeric-collision', 'coarse-time', 'digest-change',
  'digest-cancel', 'exact-stat-failure', 'exact-stat-untyped', 'sha256-noexact', 'sha256-exact', 'frozen'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'exact-hash-observation-')), file = path.join(root, 'payload');
const bytes = Buffer.from('original descriptor payload\n'.repeat(5000)); await fs.writeFile(file, bytes);
const open = fs.open, createHash = crypto.createHash;
let closes = 0, exactStats = 0, numberStats = 0, largestRead = 0, digestCalls = 0, settled = false, failure;
const huge = 2n ** 60n + 1n;
const pending = Object.freeze(Object.assign(new Error('original exact-stat work remains outstanding'), {
  cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
}));
fs.open = async (filename, ...args) => {
  const handle = await open(filename, ...args); if (filename !== file) return handle;
  const stat = handle.stat, close = handle.close, read = handle.read;
  handle.stat = async function (options) {
    assert.equal(this, handle);
    if (options?.bigint) {
      exactStats++;
      if (selected === 'exact-stat-failure') throw pending;
      if (selected === 'exact-stat-untyped') return stat.call(handle);
      const value = await stat.call(handle, options);
      return new Proxy(value, { get(target, key) {
        if (key === 'ino' && ['high-identity', 'numeric-collision'].includes(selected)) {
          return huge + (selected === 'numeric-collision' && exactStats > 1 ? 1n : 0n);
        }
        if (key === 'mtimeNs' && selected === 'coarse-time' && exactStats > 1) return target.mtimeNs + 1n;
        return Reflect.get(target, key);
      } });
    }
    numberStats++;
    const value = await stat.call(handle, options);
    if (['high-identity', 'numeric-collision'].includes(selected)) return new Proxy(value, {
      get(target, key) { return key === 'ino' ? Number(huge) : Reflect.get(target, key); }
    });
    return value;
  };
  handle.read = async function (buffer, offset, length, position) { largestRead = Math.max(largestRead, length); return read.call(handle, buffer, offset, length, position); };
  handle.close = async function () { closes++; return close.call(handle); };
  return handle;
};
let release, entered;
const ready = new Promise(resolve => { entered = resolve; });
if (selected.startsWith('digest-')) crypto.createHash = (algorithm, ...args) => {
  const hash = createHash(algorithm, ...args), digest = hash.digest;
  hash.digest = async function (...values) { digestCalls++; entered(); await new Promise(resolve => { release = resolve; }); return digest.call(hash, ...values); };
  return hash;
};
try {
  setXxhashBackend('wasm');
  if (selected.startsWith('digest-')) {
    const abort = new AbortController(), hashing = sha256File(file, { signal: abort.signal });
    await ready;
    if (selected === 'digest-change') await fs.writeFile(file, Buffer.alloc(bytes.length, 120));
    else abort.abort();
    assert.equal(closes, 0, 'accepted digest work still owns its original descriptor');
    release();
    await assert.rejects(hashing, error => selected === 'digest-change'
      ? errorGraphSome(error, value => value?.code === 'ERR_FILE_CHANGED') : error.name === 'AbortError');
    assert.equal(digestCalls, 1); assert.equal(closes, 1);
  } else if (selected === 'sha256-noexact') {
    const value = await sha256File(file);
    assert.equal(value, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(exactStats, 0); assert.equal(numberStats, 2); assert.equal(closes, 1);
  } else if (selected === 'sha256-exact') {
    const value = await sha256FileObservation(file, { containedRoot: root });
    const stat = await fs.stat(file, { bigint: true });
    assert.equal(value.algo, 'sha256'); assert.equal(value.value, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(value.bytes, bytes.length); assert.equal(exactStats, 2); assert.equal(closes, 1);
    assert.deepEqual(value.fileIdentity, { dev: String(stat.dev), ino: String(stat.ino) });
    assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.fileIdentity));
  } else if (['numeric-collision', 'coarse-time', 'exact-stat-untyped'].includes(selected)) {
    if (selected === 'numeric-collision') assert.equal(Number(huge), Number(huge + 1n), 'fixture must actually collide in Number space');
    await assert.rejects(checksumFileObservation(file), error => errorGraphSome(error, value => value?.code === 'ERR_FILE_CHANGED'));
    assert.equal(closes, 1);
  } else if (selected === 'exact-stat-failure') {
    await assert.rejects(checksumFileObservation(file), error => { failure = error; return errorGraphIncludes(error, pending); });
    assert.equal(closes, 0); assert.equal(failure.cacheOwnershipReleased(), false);
    const original = getContainedFileSession(failure); assert.ok(original);
    settled = true; await original.releaseAfterClose(); assert.equal(closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
  } else {
    const observed = await checksumFileObservation(file, selected === 'contained' ? { containedRoot: root } : {});
    assert.equal(closes, 1); assert.equal(observed.bytes, bytes.length); assert.equal(exactStats, 2);
    assert.ok(largestRead <= 65536); assert.match(observed.value, /^[a-f0-9]{16}$/u);
    const actual = await fs.stat(file, { bigint: true });
    assert.deepEqual(observed.fileIdentity, { dev: actual.dev.toString(), ino: selected === 'high-identity' ? huge.toString() : actual.ino.toString() });
    if (selected === 'high-identity') assert.notEqual(observed.fileIdentity.ino, String(observed.identity.ino));
    if (selected === 'frozen') {
      assert.ok(Object.isFrozen(observed)); assert.ok(Object.isFrozen(observed.fileIdentity));
      assert.throws(() => { observed.fileIdentity.ino = 'changed'; }, TypeError);
    }
  }
} finally {
  settled = true; release?.(); fs.open = open; crypto.createHash = createHash;
  if (failure) await getContainedFileSession(failure)?.releaseAfterClose();
  setXxhashBackend('auto'); await fs.rm(root, { recursive: true, force: true });
}
console.log(`Exact file checksum observation: ${selected}`);
