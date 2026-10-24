import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-first-search-resource-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const repoRoot = path.join(root, 'project');
const configPath = path.join(repoRoot, '.pairofcleats.json');
const open = fs.openSync, read = fs.readSync, close = fs.closeSync;
const disposal = new Set();
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
try {
  await fsp.mkdir(repoRoot);
  await fsp.writeFile(configPath, '{}');
  for (const source of ['pending-result', 'getter-reveals-pending', 'cancelled-execution']) {
    let ready = source === 'getter-reveals-pending', calls = 0, failure;
    const controller = new AbortController();
    const original = { cacheOwnershipReleased() { assert.equal(this, original); return ready; }, status: 0, signal: null };
    if (source === 'getter-reveals-pending') {
      Object.defineProperty(original, 'ok', { get() { ready = false; original.cacheOwnershipReleased = () => true; return true; } });
    } else original.ok = true;
    const approved = await createFirstSearchPlan({ repoRoot });
    await assert.rejects(applyFirstSearchPlan(approved, { signal: controller.signal, execute: async () => {
      calls += 1;
      if (source === 'cancelled-execution') { controller.abort(); throw original; }
      return original;
    } }), error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(calls, 1, 'a diagnostic result never admits the next setup step before original settlement');
    assert.deepEqual(failure.setupOutcome.completed, ['config']);
    assert.equal(failure.setupOutcome.pending[0], 'index');
    assert.equal(failure.setupOutcome.state, 'settlement-pending');
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await fsp.stat(`${configPath}.setup-lock`)).isFile(), true, 'setup retains its exact config lock while the execution owner is unresolved');
    const session = failure.setupPlanSession;
    const receipt = { resourceId: session.resourceId, settled: true, pending: false };
    assert.throws(() => session.releaseAfterSettlement({ ...receipt, resourceId: 'another-setup-owner' }), /unconfirmed/);
    assert.throws(() => session.releaseAfterSettlement(receipt), error => error.cacheOwnershipPending === true,
      'a caller receipt cannot settle the actual original execution');
    ready = true;
    assert.equal(await session.releaseAfterSettlement(receipt), true);
    await assert.rejects(fsp.stat(`${configPath}.setup-lock`), { code: 'ENOENT' });
  }
  for (const result of [{ ok: true, status: null }, { ok: true }, { ok: true, status: 7 }, { ok: true, status: 0, signal: 'SIGTERM' }]) {
    let calls = 0;
    const blocked = await applyFirstSearchPlan(await createFirstSearchPlan({ repoRoot }), {
      execute: async () => { calls += 1; return result; }
    });
    assert.equal(blocked.state, 'blocked');
    assert.equal(calls, 1, 'success requires the observed zero, unsignalled exit');
    assert.deepEqual(blocked.completed, ['config']);
    assert.equal(blocked.pending[0], 'index');
  }

  // The actual original numeric JSON reader remains reachable if cancellation
  // arrives during replanning. It must not become a normal cancelled receipt.
  const approved = await createFirstSearchPlan({ repoRoot });
  const controller = new AbortController();
  let ready = false, selectedFd = null, closes = 0, failure;
  const original = Object.freeze(Object.assign(new Error('original config read owns native work during cancellation'), {
    cacheOwnershipReleased() { assert.equal(this, original); return ready; }
  }));
  fs.openSync = (file, ...args) => {
    const fd = open(file, ...args);
    if (samePath(file, configPath)) { selectedFd = fd; disposal.add(fd); }
    return fd;
  };
  fs.readSync = (fd, ...args) => {
    if (fd === selectedFd) { controller.abort(); throw original; }
    return read(fd, ...args);
  };
  fs.closeSync = fd => { if (fd === selectedFd) closes += 1; const result = close(fd); disposal.delete(fd); return result; };
  await assert.rejects(applyFirstSearchPlan(approved, { signal: controller.signal,
    execute: () => assert.fail('replanning still owns its original config descriptor') }),
  error => { failure = error; return error.cacheOwnershipPending === true; });
  assert.equal(controller.signal.aborted, true);
  assert.equal(closes, 0);
  assert.equal(failure.setupOutcome, undefined, 'no setup lock was acquired during unsettled replanning');
  const session = getContainedFileSession(failure);
  assert.ok(session);
  ready = true;
  session.releaseAfterCloseSync();
  assert.equal(closes, 1);
  assert.equal(failure.cacheOwnershipReleased(), true);
} finally {
  fs.openSync = open; fs.readSync = read; fs.closeSync = close;
  for (const fd of disposal) { try { close(fd); } catch {} }
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('First-search apply preserves original execution and cancelled replanning resource ownership.');
