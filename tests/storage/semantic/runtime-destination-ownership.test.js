import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence, verifyRuntimeFamily } from '../../../src/index/semantic/runtime/import.js';
import { openRuntimeQueryFamily } from '../../../src/index/semantic/runtime/query-store.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';
import { withRuntimeDestinationWriter } from '../../../src/index/semantic/runtime/ownership.js';

const fixture = await createRuntimeImportFixture();
try {
  const options = fixture.options(), controller = new AbortController();
  const originalRename = fs.rename, originalOpen = fs.open;
  let promoted, resume, contenderStarted;
  const promotion = new Promise(resolve => { promoted = resolve; });
  const barrier = new Promise(resolve => { resume = resolve; });
  const attempted = new Promise(resolve => { contenderStarted = resolve; });
  let held = false, secondStarted = false, secondFinished = false;
  fs.rename = async (from, to) => {
    const result = await originalRename(from, to);
    if (!held && path.dirname(to) === path.join(options.destination, 'generations') && /^[a-f0-9]{64}$/.test(path.basename(to))) {
      held = true; promoted(path.basename(to)); await barrier;
    }
    return result;
  };
  fs.open = async (...args) => {
    if (secondStarted && String(args[0]).endsWith('.writer.lock')) contenderStarted();
    return originalOpen(...args);
  };
  let pinned;
  try {
    const first = importRuntimeEvidence({ ...options, signal: controller.signal }).catch(error => error);
    const generationId = await promotion;
    pinned = await openRuntimeQueryFamily({ destination: options.destination, generationId });
    secondStarted = true;
    const second = importRuntimeEvidence(options).then(value => { secondFinished = true; return value; });
    await attempted;
    assert.equal(secondFinished, false, 'another importer cannot admit while the destination owner is paused');
    controller.abort(); resume();
    assert.equal((await first).code, 'ABORT_ERR');
    const published = await second;
    assert.equal(published.pointer.generationId, generationId);
    await verifyRuntimeFamily({ destination: options.destination });
    const entry = pinned.db.prepare('SELECT * FROM evidence ORDER BY ordinal LIMIT 1').get();
    assert.ok(await pinned.hydrate(entry, 65536), 'pinned reader survives cancelled original publisher');
  } finally { resume?.(); await pinned?.close(); fs.rename = originalRename; fs.open = originalOpen; }
  await fixture.addRaw({ name: 'retained-large.bin', format: 'future-saved-binary', bytes: Buffer.alloc(768 * 1024, 1) });
  const account = createSemanticDiskAccount(16 * 1024 * 1024);
  await importRuntimeEvidence({ ...fixture.options(), diskAccount: account });
  const retained = (await reopenSemanticDiskAccount({ roots: [options.destination], limit: Number.MAX_SAFE_INTEGER })).retainedBytes;
  assert.equal(account.used, retained, 'fresh supplied account includes every retained destination byte');
  const pointer = await fs.readFile(path.join(options.destination, 'current.json'));
  await assert.rejects(importRuntimeEvidence({ ...fixture.options(), importOptions: { maxDiskWorkingSetBytes: 524288 } }),
    { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.deepEqual(await fs.readFile(path.join(options.destination, 'current.json')), pointer);
  const large = fixture.capture.rawArtifacts.at(-1);
  await fs.link(path.join(options.destination, 'raw', large.hash + '.bin'), path.join(options.destination, 'raw', 'shared-hardlink.bin'));
  await importRuntimeEvidence({ ...fixture.options(), diskAccount: account });
  assert.equal(account.used, retained, 'hardlinked physical bytes and idempotent families are counted once');
  await importRuntimeEvidence({ ...fixture.options(), importOptions: { maxDiskWorkingSetBytes: 32 * 1024 * 1024 } });
  const shared = createSemanticDiskAccount(2 * 1024 * 1024), queuedAbort = new AbortController();
  const firstDestination = path.join(fixture.root, 'account-first'), nextDestination = path.join(fixture.root, 'account-next');
  let enter, release, queuedLock, nextRan = false;
  const entered = new Promise(resolve => { enter = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const observedLock = new Promise(resolve => { queuedLock = resolve; });
  const firstOwner = withRuntimeDestinationWriter({ destination: firstDestination,
    maxDiskWorkingSetBytes: 1024 * 1024, diskAccount: shared }, async () => { enter(); await hold; });
  await entered;
  const open = fs.open;
  fs.open = async (...args) => {
    const handle = await open(...args);
    if (String(args[0]) === path.join(nextDestination, '.writer.lock')) queuedLock();
    return handle;
  };
  try {
    const abortedOwner = withRuntimeDestinationWriter({ destination: nextDestination, maxDiskWorkingSetBytes: 1024 * 1024,
      diskAccount: shared, signal: queuedAbort.signal }, () => { nextRan = true; });
    await observedLock; queuedAbort.abort();
    await assert.rejects(abortedOwner, { name: 'AbortError' });
    assert.equal(nextRan, false, 'cancelled shared-account waiter cannot mutate its destination');
    await assert.rejects(fs.access(path.join(nextDestination, '.writer.lock')), { code: 'ENOENT' });
  } finally { fs.open = open; release(); await firstOwner; }
  await withRuntimeDestinationWriter({ destination: nextDestination, maxDiskWorkingSetBytes: 1024 * 1024,
    diskAccount: shared }, () => { nextRan = true; });
  assert.equal(nextRan, true, 'queue cancellation cannot strand the next destination owner');
  assert.equal(shared.used, (await reopenSemanticDiskAccount({ roots: [firstDestination, nextDestination], limit: Number.MAX_SAFE_INTEGER })).retainedBytes);
  console.log('Destination ownership retains promoted families, serializes admission, and reconciles restart/hardlink accounting');
} finally { await fixture.cleanup(); }
