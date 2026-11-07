import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withRuntimeDestinationWriter } from '../../../src/index/semantic/runtime/ownership.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { retainedRuntimeBytes } from '../../helpers/runtime-publication-work.js';
import { errorGraphSome } from '../../helpers/error-graph.js';
import { isFileLockPublicationSession } from '../../../src/shared/locks/file-lock-publication.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/runtime-writer-resource-ownership/')[1];
assert.ok(['rejected-original', 'fulfilled-original', 'cleanup-original', 'metadata-original',
  'initialization-original', 'falsey-errors', 'shared-account'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir('runtime-writer-resource-ownership');
const root = path.join(dir, 'destination'), lockPath = path.join(root, '.writer.lock');
const shared = createSemanticDiskAccount(65536), options = { destination: root,
  diskAccount: shared, maxDiskWorkingSetBytes: shared.limit };
const originalStat = fs.lstat, originalRemove = fs.rm;
const rejected = async operation => {
  let rejected = false, failure;
  try { await operation(); } catch (error) { rejected = true; failure = error; }
  assert.equal(rejected, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop();
    if (Object.is(value, expected)) return true;
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    for (const key of ['cause', 'operationError']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) queue.push(descriptor.value);
    }
    const errors = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
};
let ready = false, calls = 0, heldBytes, session, armed = false;
const native = Object.assign(new Error('original outstanding runtime work'), {
  cacheOwnershipReleased() { assert.equal(this, native); return ready; }
});
const primary = Object.freeze(new Error('original runtime operation failure'));
const payload = path.join(root, 'payload.bin');
const operation = async ({ account }) => {
  calls += 1;
  account.reserve(4096);
  await fs.writeFile(payload, Buffer.from('kept'));
  heldBytes = account.used;
  armed = true;
  if (mode === 'rejected-original' || mode === 'shared-account') {
    Object.freeze(native); throw native;
  }
  if (mode === 'fulfilled-original') return native;
  if (mode === 'cleanup-original') throw primary;
};
try {
  if (mode === 'falsey-errors') {
    for (const value of [undefined, null, false, 0, '', primary]) {
      const failure = await rejected(() => withRuntimeDestinationWriter(options, async ({ account }) => {
        account.reserve(4096); await fs.writeFile(payload, Buffer.from('kept')); throw value;
      }));
      assert.equal(failure, value, 'an ordinary rejection retains exact falsey/frozen identity');
      await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
      assert.equal(shared.used, await retainedRuntimeBytes(root));
    }
  } else {
    if (mode === 'cleanup-original' || mode === 'initialization-original') {
      fs.lstat = async (filename, ...args) => {
        if ((mode === 'cleanup-original' && armed && filename === payload)
          || (mode === 'initialization-original' && filename === lockPath && !args.length)) throw native;
        return originalStat(filename, ...args);
      };
    }
    if (mode === 'metadata-original') fs.rm = async (filename, ...args) => {
      if (filename === lockPath) throw native;
      return originalRemove(filename, ...args);
    };
    const failure = await rejected(() => withRuntimeDestinationWriter(options, operation));
    fs.lstat = originalStat; fs.rm = originalRemove;
    assert.equal(contains(failure, mode === 'cleanup-original' ? primary : native), true,
      'the original independent error/result remains in the outward failure');
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.ok((await fs.lstat(lockPath)).isFile(), 'outstanding original work fences metadata removal');
    assert.equal(shared.used, mode === 'initialization-original' ? 0 : heldBytes,
      'inventory and failed metadata removal cannot refund uncompleted reservations');
    // Independent cleanup failures retain their original capability on the
    // exact nested cause; the outer operation error is not that metadata owner.
    errorGraphSome(failure, value => {
      const candidate = value && Object.getOwnPropertyDescriptor(Object(value), 'fileLockPublicationSession')?.value;
      if (!isFileLockPublicationSession(candidate)) return false;
      session = candidate; return true;
    });
    assert.equal(typeof session?.releaseAfterClose, 'function');
    await rejected(() => session.releaseAfterClose());
    assert.ok((await fs.lstat(lockPath)).isFile(), 'metadata recovery does not close or replay native work');
    if (mode === 'shared-account') {
      const before = shared.used;
      await withRuntimeDestinationWriter({ ...options, destination: path.join(dir, 'independent') }, async () => {});
      assert.ok(shared.used >= before, 'another destination cannot consume the outstanding reservation');
    }
    // Replacing public diagnostic methods cannot replace the captured original.
    if (!Object.isFrozen(native)) native.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true;
    assert.equal(failure.cacheOwnershipReleased(), false, 'native settlement alone is not metadata removal');
    assert.equal((await session.releaseAfterClose()).settled, true);
    assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    assert.equal(calls, mode === 'initialization-original' ? 0 : 1, 'recovery never replays the operation');
    const other = mode === 'shared-account' ? await retainedRuntimeBytes(path.join(dir, 'independent')) : 0;
    await withRuntimeDestinationWriter(options, async () => {});
    assert.equal(shared.used, other + await retainedRuntimeBytes(root),
      'the next admitted writer reconciles the retained ledger after explicit original-owner recovery');
  }
} finally {
  fs.lstat = originalStat; fs.rm = originalRemove; ready = true;
  if (session) await session.releaseAfterClose();
  assert.ok(path.relative(process.cwd(), dir).startsWith(`.tmp${path.sep}`));
  await fs.rm(dir, { recursive: true, force: true });
}
