import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFixtureHealthReadContext, readFixtureHealthSnapshot } from '../../helpers/fixture-health-snapshot.js';
import { withVerifiedArtifactReadScope } from '../../../src/shared/artifact-io/verified-read-scope.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { MINHASH_HASH_IDENTITY } from '../../../src/index/minhash.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';

ensureTestingEnv(process.env);
const cases = JSON.parse(await fs.readFile(new URL('./health-verification-close.test.js.cases.json', import.meta.url))).cases;
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/fixtures/health-verification-close/')[1];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('health-close-' + selected);
const target = path.join(dir, 'unconsumed.json');
await fs.writeFile(target, JSON.stringify({ content: 'health authority' }));
if (selected === 'snapshot-unsettled-close') {
  await fs.mkdir(path.join(dir, 'pieces'));
  const values = {
    'chunk_meta.json': [{ id: 0, start: 0, end: 1, file: 'a.js', chunkUid: 'fixture-health-uid' }],
    'file_meta.json': [{ id: 0, file: 'a.js' }],
    'minhash_signatures.packed.meta.json': { hashIdentity: MINHASH_HASH_IDENTITY, format: 'u32', endian: 'le', dims: 1, count: 1 }
  };
  for (const [file, value] of Object.entries(values)) await fs.writeFile(path.join(dir, file), JSON.stringify(value));
  await fs.writeFile(path.join(dir, 'minhash_signatures.packed.bin'), Buffer.alloc(4));
  await fs.writeFile(path.join(dir, 'pieces/manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey: 'health-close', pieces: [
      { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
      { name: 'file_meta', path: 'file_meta.json', format: 'json' },
      { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
      { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' },
      { name: 'chunk_meta_extra', path: 'unconsumed.json', format: 'json' }
    ] }));
}
if (selected === 'snapshot-unsettled-close') {
  const initial = await readFixtureHealthSnapshot({ modeDirs: { code: dir }, requiredModes: ['code'] });
  assert.equal(initial.compatibility.compatible, true, JSON.stringify(initial));
}
const originalOpen = fs.open, handles = new Set(), metrics = {};
const context = createFixtureHealthReadContext(dir, metrics);
let nativeClose, closes = 0, reads = 0, recover = false, unblock;
const readFailure = selected === 'frozen-read-and-close' ? Object.freeze(new Error('original frozen health read failure'))
  : selected === 'false-read-and-close' ? false : undefined;
const closeFailure = Object.freeze(new Error('independent health close failure'));
const contains = (error, value, seen = new Set()) => {
  if (error === value) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return Object.hasOwn(error, 'cause') && contains(error.cause, value, seen)
    || Array.isArray(error.errors) && error.errors.some(row => contains(row, value, seen));
};
let entered;
const closing = new Promise(resolve => { entered = resolve; });
const released = new Promise(resolve => { unblock = resolve; });
try {
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (path.resolve(file) !== target) return handle;
    const read = handle.read.bind(handle); nativeClose = handle.close.bind(handle); handles.add(nativeClose);
    handle.read = (...input) => { reads++; if (selected.includes('read-and-close')) throw readFailure; return read(...input); };
    handle.close = async () => {
      closes++;
      if (!recover) {
        if (selected === 'held-close') { entered(); await released; }
        else if (selected === 'false-close' || selected === 'snapshot-unsettled-close') return false;
        else throw closeFailure;
      }
      await nativeClose(); handles.delete(nativeClose);
    };
    return handle;
  };
  const pending = selected === 'snapshot-unsettled-close'
    ? readFixtureHealthSnapshot({ modeDirs: { code: dir }, requiredModes: ['code'] })
    : withVerifiedArtifactReadScope(context, () => context.ensure(target));
  if (selected === 'held-close') {
    await closing;
    try {
      assert.equal(context.certificates.size, 0, 'content authority waits for the original descriptor to close');
      assert.equal(metrics.physicalReads || 0, 0);
    } finally { unblock(); }
    const certificate = await pending; assert.match(certificate.hash, /^[a-f0-9]{64}$/);
    assert.equal(metrics.physicalReads, 1); assert.equal(closes, 1);
  } else {
    let failure;
    await assert.rejects(pending, error => { failure = error; return true; });
    assert.equal(context.certificates.size, 0, 'failed disposal never publishes a usable certificate');
    assert.equal(metrics.physicalReads || 0, 0);
    if (selected.includes('read-and-close')) { assert.ok(contains(failure, readFailure)); assert.ok(contains(failure, closeFailure)); }
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(session.isSettled(), false);
    assert.equal(closes, 1, 'no automatic close retry'); const before = reads;
    recover = true; await session.releaseAfterClose();
    assert.equal(session.isSettled(), true); assert.equal(closes, 2); assert.equal(reads, before);
    assert.equal(context.certificates.size, 0, 'close-only recovery cannot publish a failed health invocation');
    if (selected === 'snapshot-unsettled-close') {
      const recovered = await readFixtureHealthSnapshot({ modeDirs: { code: dir }, requiredModes: ['code'] });
      assert.equal(recovered.compatibility.compatible, true, JSON.stringify(recovered));
      assert.match(recovered.authorityByMode.code, /^[a-f0-9]{64}$/, 'only an independent fresh evaluation can establish health after disposal');
    }
  }
} finally { unblock(); fs.open = originalOpen; for (const close of handles) await close(); await fs.rm(dir, { recursive: true, force: true }); }
console.log('health content-authority close control passed: ' + selected);
