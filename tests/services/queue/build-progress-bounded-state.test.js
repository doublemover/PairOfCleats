import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { observeServiceBuildStateSnapshot, readServiceBuildStateSnapshot, SERVICE_BUILD_STATE_MAX_BYTES }
  from '../../../tools/service/indexer-service/build-state-observation.js';

const root = await makeTempDir('service-progress-state-'), file = path.join(root, 'build_state.json');
const originalOpen = fs.open;
try {
  assert.equal((await observeServiceBuildStateSnapshot(root)).status, 'missing');
  await fs.writeFile(file, '{"buildId":"one"}');
  const valid = await observeServiceBuildStateSnapshot(root);
  assert.equal(valid.status, 'ok'); assert.equal(valid.bytes, 17); assert.equal(valid.jsonDecodes, 1);
  assert.deepEqual(await readServiceBuildStateSnapshot(root), { state: { buildId: 'one' }, path: file });
  for (const text of ['broken', '[]', 'null', 'false']) {
    await fs.writeFile(file, text); const observation = await observeServiceBuildStateSnapshot(root);
    assert.equal(observation.status, 'corrupt'); assert.equal(observation.bytes, Buffer.byteLength(text)); assert.equal(observation.jsonDecodes, 1);
    assert.equal(await readServiceBuildStateSnapshot(root), null);
  }
  await fs.writeFile(file, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
  const encoding = await observeServiceBuildStateSnapshot(root);
  assert.equal(encoding.status, 'corrupt'); assert.equal(encoding.jsonDecodes, 0); assert.equal(encoding.bytes, 7);
  await fs.writeFile(file, Buffer.alloc(SERVICE_BUILD_STATE_MAX_BYTES + 1, 32));
  let payloadReads = 0;
  fs.open = async (location, ...args) => {
    const handle = await originalOpen(location, ...args), read = handle.read;
    if (path.resolve(String(location)) === file) handle.read = function(...values) { payloadReads++; return read.call(handle, ...values); };
    return handle;
  };
  const oversized = await observeServiceBuildStateSnapshot(root);
  assert.equal(oversized.status, 'oversized'); assert.equal(oversized.jsonDecodes, 0); assert.equal(oversized.bytes, null);
  assert.equal(payloadReads, 0, 'real descriptor extent admission rejects before allocating/reading the oversized payload');
  const ordinary = Object.freeze(Object.assign(new Error('transient state read'), { code: 'EIO' }));
  fs.open = async () => { throw ordinary; };
  const transient = await observeServiceBuildStateSnapshot(root);
  assert.equal(transient.status, 'transient'); assert.equal(transient.code, 'EIO'); assert.equal(transient.bytes, null);
  let released = false;
  const pending = Object.assign(new Error('original state work still pending'), { cacheOwnershipPending: true,
    cacheOwnershipReleased() { return released; } });
  fs.open = async () => { throw pending; };
  let failure;
  try { await observeServiceBuildStateSnapshot(root); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(failure.cacheOwnershipReleased(), false);
  pending.cacheOwnershipReleased = () => true;
  assert.equal(failure.cacheOwnershipReleased(), false, 'classification retains the original observer');
  released = true; assert.equal(failure.cacheOwnershipReleased(), true);
  fs.open = originalOpen;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(observeServiceBuildStateSnapshot(root, { signal: controller.signal }), { name: 'AbortError' });
} finally { fs.open = originalOpen; await rmDirRecursive(root); }
console.log('Build progress reads own bounded UTF8/JSON bytes and distinguish missing, oversized, corrupt, transient and pending-original work.');
