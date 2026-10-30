import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildToolInstallReceipt, verifyToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual bounded receipt byte consumer; inert fs faults only.
// No executable, installer, network, child, native binding or user cache work.
const root = await makeTempDir('poc-tool-receipt-verification-');
const realpath = fs.realpathSync;
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
try {
  const command = path.join(root, 'inert-consumer');
  fs.writeFileSync(command, 'actual bounded consumer bytes, never executed');
  const receipt = buildToolInstallReceipt({ tool: { id: 'receipt-verification-fixture' }, toolingRoot: root,
    result: { path: command, probe: { ok: false } } });
  const originalBytes = fs.readFileSync(command);
  const intact = verifyToolInstallReceipt(receipt);
  assert.equal(intact.state, 'bytes-intact'); assert.equal(intact.toolId, receipt.toolId); assert.equal(intact.receiptId, receipt.receiptId);
  for (const value of [undefined, null, false, 0, '']) {
    fs.realpathSync = (file, ...args) => { if (file === command) throw value; return realpath(file, ...args); };
    const report = verifyToolInstallReceipt(receipt);
    assert.equal(report.state, 'repair-required'); assert.equal(report.problems[0].code, 'consumer-unreadable');
    assert.equal(report.toolId, receipt.toolId); assert.equal(report.receiptId, receipt.receiptId);
  }
  for (const marker of [undefined, false, true]) {
    let originalSettled = false, calls = 0;
    const primary = Object.assign(new Error('original byte observation native owner'), {
      code: 'EIO', ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
      cacheOwnershipReleased() { assert.equal(this, primary); return originalSettled; }
    });
    fs.realpathSync = (file, ...args) => { if (file === command) { calls += 1; throw primary; } return realpath(file, ...args); };
    const failure = caught(() => verifyToolInstallReceipt(receipt));
    assert.equal(failure.cause, primary); assert.equal(failure.cacheOwnershipReleased(), false);
    primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(calls, 1);
    originalSettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
    assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError);
    const settledReport = verifyToolInstallReceipt(receipt);
    assert.equal(settledReport.state, 'repair-required'); assert.equal(settledReport.problems[0].code, 'EIO');
  }
  for (const value of [undefined, null, false, 0, '']) {
    const primary = Object.freeze(Object.defineProperty(new Error('byte error diagnostic getter'), 'code', { get() { throw value; } }));
    fs.realpathSync = (file, ...args) => { if (file === command) throw primary; return realpath(file, ...args); };
    const failure = caught(() => verifyToolInstallReceipt(receipt));
    assert.equal(failure.cause, primary); assert.equal(failure.errors[1].cause, value);
    assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
  }
  {
    let settled = false;
    const inspection = Object.assign(new Error('classification inspector native resource'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
    });
    const primary = Object.freeze(Object.defineProperty(new Error('original unreadable byte code'), 'code', { get() { throw inspection; } }));
    fs.realpathSync = (file, ...args) => { if (file === command) throw primary; return realpath(file, ...args); };
    const failure = caught(() => verifyToolInstallReceipt(receipt));
    assert.equal(failure.cause, primary); assert.equal(failure.errors[1], inspection);
    inspection.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    const primary = Object.freeze(Object.assign(new Error('unknown original byte work'), { cacheOwnershipPending: true }));
    fs.realpathSync = (file, ...args) => { if (file === command) throw primary; return realpath(file, ...args); };
    const failure = caught(() => verifyToolInstallReceipt(receipt));
    assert.equal(failure.cacheOwnershipReleased(), false);
  }
  fs.realpathSync = realpath;
  for (const value of [undefined, null, false, 0, '']) {
    const malformed = Object.defineProperty({ ...receipt }, 'toolId', { enumerable: true, get() { throw value; } });
    const report = verifyToolInstallReceipt(malformed);
    assert.equal(report.state, 'repair-required'); assert.equal(report.problems[0].code, 'consumer-unreadable');
    assert.equal(report.toolId, null); assert.equal(report.receiptId, null);
    assert.equal(report.verification.bytes, 'unverified', 'failed validation cannot project unregistered verification claims');
  }
  assert.equal(verifyToolInstallReceipt(null).state, 'repair-required');
  assert.deepEqual(fs.readFileSync(command), originalBytes);
  assert.equal(verifyToolInstallReceipt(receipt).state, 'bytes-intact');
} finally { fs.realpathSync = realpath; await rmDirRecursive(root); }
console.log('Receipt verification preserves original byte owners and bounded diagnostics.');
