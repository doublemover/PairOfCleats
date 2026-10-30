import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticQueryIndexIntake, writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { deferred } from '../../helpers/semantic-recovery.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['row-allowance', 'append-drain', 'pending-close'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir('query-index-intake-' + selected);
const account = createSemanticDiskAccount(16 * 1024 * 1024), generation = { baseBuildId: 'intake-fixture', semanticRevision: 0 };
const common = { root, generation, partitions: [], diskAccount: account, compareRows: (a,b) => a.id - b.id,
  keyForRow: row => row.id, validateIndex: row => row, batchBytes: 1048576, batchRows: 1, maxOpenRuns: 2 };
let pendingOwner, workError, failed = false;
try {
  if (selected === 'row-allowance') {
    const entry = { id: 0, value: 'é'.repeat(300000) };
    assert.ok(Buffer.byteLength(canonicalSemanticJson(entry)) > 512 * 1024);
    const intake = await createSemanticQueryIndexIntake(common); await intake.append(entry);
    const actual = await intake.finalize();
    const expected = await writeSemanticQueryIndex({ ...common, entries: [entry] });
    assert.deepEqual(actual.pieces.map(({ hash, offsetsHash, bytes }) => ({ hash, offsetsHash, bytes })),
      expected.pieces.map(({ hash, offsetsHash, bytes }) => ({ hash, offsetsHash, bytes })));
    assert.equal(actual.rowCount, 1); assert.equal(actual.pieces[0].count, 1);
    const oversized = await createSemanticQueryIndexIntake(common), before = account.used;
    let failed;
    try { await oversized.append({ id: 0, value: 'x'.repeat(1048576) }); } catch (error) { failed = error; }
    assert.equal(failed?.code, 'ERR_JSON_TOO_LARGE');
    await assert.rejects(oversized.finalize(), error => error === failed, 'the original append failure is retained, not retried');
    await oversized.retire(failed); assert.equal(account.used, before);
    await intake.retire(new Error('verified test retirement')); await intake.retire(new Error('idempotent retirement'));
    assert.equal(account.used, expected.pieces[0].bytes + 8);
  } else if (selected === 'append-drain') {
    const entered = deferred(), release = deferred(); let writes = 0;
    const intake = await createSemanticQueryIndexIntake({ ...common, scheduleIo: async run => {
      writes++; entered.resolve(); await release.promise; return run();
    } });
    const operation = intake.append({ id: 0, value: 'original' });
    try {
      await entered.promise;
      await assert.rejects(intake.append({ id: 1, value: 'must not replace' }), /intake is not available/);
      await assert.rejects(intake.finalize(), /intake is not available/);
      await assert.rejects(intake.retire(new Error('early retirement')), /Cannot retire an active/);
      assert.ok(account.used > 0); assert.ok((await fs.readdir(root)).length > 0);
    } finally { release.resolve(); }
    await operation; const index = await intake.finalize();
    assert.equal(index.rowCount, 1); assert.ok(writes > 0);
    await intake.retire(new Error('completed owner retirement')); assert.equal(account.used, 0);
  } else {
    const originalOpen = fs.open, originalRemove = fs.rm;
    const closeFailure = Object.freeze(new Error('original intake offset close failed'));
    let permitClose = false, closes = 0, removals = 0, capturedHandle;
    fs.open = async function (file, flags, ...args) {
      const handle = await originalOpen.call(this, file, flags, ...args);
      if (String(file).endsWith('.offsets') && flags === 'wx') {
        capturedHandle = handle; const close = handle.close;
        handle.close = function () { closes++; if (!permitClose) throw closeFailure; return close.call(handle); };
      }
      return handle;
    };
    fs.rm = async function (file, options) { removals++; return originalRemove.call(this, file, options); };
    const intake = await createSemanticQueryIndexIntake({ ...common, batchRows: 512 });
    let failure;
    try {
      await intake.append({ id: 0, value: 'actual native descriptor bytes' });
      try { await intake.finalize(); } catch (error) { failure = error; }
      assert.ok(errorGraphIncludes(failure, closeFailure));
      errorGraphSome(failure, value => { pendingOwner ||= getContainedFileSession(value); return false; });
      assert.ok(pendingOwner); assert.equal(observeStorageResource(failure).isSettled(), false);
      await assert.rejects(intake.retire(new Error('unrelated teardown value')), error => errorGraphIncludes(error, closeFailure));
      assert.equal(removals, 0); assert.equal(closes, 1); assert.ok(account.used > 0);
      permitClose = true; await pendingOwner.releaseAfterClose();
      assert.equal(capturedHandle.fd, -1); assert.equal(closes, 2);
      await intake.retire(failure); assert.equal(removals, 1); assert.equal(account.used, 0);
    } finally {
      permitClose = true; if (pendingOwner) await pendingOwner.releaseAfterClose();
      fs.open = originalOpen; fs.rm = originalRemove;
    }
  }
} catch (error) { failed = true; workError = error; throw error; }
finally {
  if (failed) observeStorageResource(workError).requireSettled();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Query index push intake ' + selected + ' preserves original byte admission and captured resource ownership.');
