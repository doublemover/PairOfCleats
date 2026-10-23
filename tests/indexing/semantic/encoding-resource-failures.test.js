import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { encodeSemanticEvidence, persistSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';
import { captureSourceLinkedInput } from '../../../src/index/tooling/source-linked-input.js';
import { finalizeSourceLinkedReport } from '../../../src/index/tooling/source-linked-report.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { checkFiniteMayCapsule, readFiniteMayCheckedSummary } from '../../../src/index/semantic/capsules/finite-may-check.js';

// UNVALIDATED: actual bounded encoders and one original descriptor close fault.
// No provider, certificate producer, native process or task is executed.
const rejected = async run => {
  let failed = false, failure;
  try { await run(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true, 'pending original work cannot become budget/unknown output'); return failure;
};
const visit = (failure, inspect) => {
  const pending = [failure], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); inspect(value);
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
};
const contains = (failure, expected) => {
  let found = false; visit(failure, value => { if (value === expected) found = true; }); return found;
};
const budgetFailure = () => Object.assign(new Error('fixture encoding budget'), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
const fail = message => Object.assign(new Error(message), { code: 'ERR_FIXTURE_BUDGET' });
const proxyFor = (failure, { report = false, system = false } = {}) => {
  const base = system ? { profile: 'finite-may-set-v1', transferVersion: 1 } : { payload: null };
  let enumerations = 0;
  return new Proxy(base, { ownKeys() {
    // Final report admission checks nonempty unsigned framing before encoding.
    if (report && enumerations++ === 0) return Reflect.ownKeys(base);
    throw failure;
  } });
};
const f = await createRecoveryFixture('original encoding resource');
const originalOpen = fs.open, disposal = new Map(), inventory = [];
try {
  const evidenceRoot = path.join(f.root, 'failed-evidence');
  const cases = [
    { name: 'evidence', run: failure => encodeSemanticEvidence(proxyFor(failure), { maxBytes: 4096 }) },
    { name: 'evidence-writer', run: failure => persistSemanticEvidence({ value: proxyFor(failure),
      stagingRoot: evidenceRoot, diskAccount: f.account, inventory, maxBytes: 4096 }) },
    { name: 'input', run: failure => captureSourceLinkedInput(proxyFor(failure), { maxBytes: 4096, fail, message: 'input budget' }) },
    { name: 'report', run: failure => finalizeSourceLinkedReport(proxyFor(failure, { report: true }),
      { maxBytes: 4096, fail, message: 'report budget' }) },
    { name: 'source-writer', run: failure => writeSourceLinkedEvidence({ report: proxyFor(failure),
      sources: new Map(), state: {}, policy: {}, maxBytes: 4096 }) },
    { name: 'checker', run: failure => checkFiniteMayCapsule({ system: proxyFor(failure, { system: true }), capsule: null, maxBytes: 4096 }) },
    { name: 'summary', run: failure => readFiniteMayCheckedSummary({ system: proxyFor(failure, { system: true }),
      capsule: null, node: 'entry', maxBytes: 4096 }) }
  ];
  let deny = true, state;
  const original = Object.freeze(budgetFailure());
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (path.resolve(String(file)) !== path.resolve(f.original)) return handle;
    const nativeRead = handle.read, nativeClose = handle.close;
    state = { handle, reads: 0, closes: 0 }; disposal.set(handle, () => nativeClose.call(handle));
    handle.read = function (...readArgs) { assert.equal(this, handle); state.reads++; return nativeRead.call(handle, ...readArgs); };
    handle.close = function () {
      assert.equal(this, handle); state.closes++;
      if (deny) throw original;
      return nativeClose.call(handle).then(value => { disposal.delete(handle); return value; });
    };
    return handle;
  };
  const pending = await rejected(() => readVerifiedContainedFile(f.root, f.original, { maxBytes: 4096 }));
  const session = getContainedFileSession(pending); assert.ok(session);
  assert.equal(pending.cacheOwnershipReleased(), false);
  for (const entry of cases) {
    const failure = await rejected(() => entry.run(pending));
    assert.equal(contains(failure, pending), true, entry.name);
    assert.equal(failure.cacheOwnershipReleased(), false, entry.name);
    const sessions = new Set(); visit(failure, value => { const owned = getContainedFileSession(value); if (owned) sessions.add(owned); });
    assert.ok(sessions.has(session), entry.name + ' retains the actual original session');
  }
  assert.deepEqual(inventory, []);
  await assert.rejects(fs.access(evidenceRoot), { code: 'ENOENT' });
  assert.equal(state.closes, 1);
  const reads = state.reads; deny = false;
  const receipt = await session.releaseAfterClose();
  assert.equal(receipt.pending, false); assert.equal(receipt.settled, true);
  assert.equal(state.reads, reads); assert.equal(state.closes, 2); assert.equal(state.handle.fd, -1);
  fs.open = originalOpen;

  for (const entry of cases) for (const kind of ['code', undefined, null, false, 0, '', 'pending-inspection']) {
    let settled = true, inspectionSettled = false;
    const inspection = kind === 'pending-inspection' ? Object.freeze(Object.assign(new Error('encoding diagnostic inspection owns work'), {
      cacheOwnershipReleased: () => inspectionSettled
    })) : kind;
    const primary = Object.defineProperties(new Error('encoding caller failed'), {
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
      code: { get() {
        primary.cacheOwnershipReleased = () => true; settled = false;
        if (kind !== 'code') throw inspection; return 'ERR_SEMANTIC_JSON_BUDGET';
      } }
    });
    const failure = await rejected(() => entry.run(primary));
    assert.equal(contains(failure, primary), true, entry.name);
    if (kind !== 'code') assert.equal(contains(failure, inspection), true, entry.name);
    assert.equal(failure.cacheOwnershipReleased(), false, entry.name);
    settled = true; inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true, entry.name);
  }
  for (const report of [false, true]) for (const inspection of [undefined, null, false, 0, '']) {
    let settled = true;
    const primary = Object.assign(budgetFailure(), { cacheOwnershipReleased: () => settled });
    const options = { maxBytes: 4096, message: 'mapped budget', fail() { settled = false; throw inspection; } };
    const failure = await rejected(() => report
      ? finalizeSourceLinkedReport(proxyFor(primary, { report: true }), options)
      : captureSourceLinkedInput(proxyFor(primary), options));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, inspection), true);
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const report of [false, true]) {
    let settled = true;
    const primary = Object.assign(budgetFailure(), { cacheOwnershipReleased: () => settled });
    const options = { maxBytes: 4096, message: 'mapped budget', fail() { settled = false; return fail('ordinary mapped error'); } };
    const failure = await rejected(() => report
      ? finalizeSourceLinkedReport(proxyFor(primary, { report: true }), options)
      : captureSourceLinkedInput(proxyFor(primary), options));
    assert.equal(contains(failure, primary), true); assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  assert.equal(encodeSemanticEvidence({ payload: 'x' }), '{"payload":"x"}');
  assert.throws(() => encodeSemanticEvidence({ payload: 'x'.repeat(1024) }, { maxBytes: 32 }), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
  assert.throws(() => captureSourceLinkedInput({ payload: 'x'.repeat(1024) }, { maxBytes: 32, fail, message: 'input budget' }), { code: 'ERR_FIXTURE_BUDGET' });
  assert.throws(() => finalizeSourceLinkedReport({ payload: 'x'.repeat(1024) }, { maxBytes: 128, fail, message: 'report budget' }), { code: 'ERR_FIXTURE_BUDGET' });
  await assert.rejects(writeSourceLinkedEvidence({ report: { payload: 'x'.repeat(1024) },
    sources: new Map(), state: {}, policy: {}, maxBytes: 32 }), { code: 'ERR_SOURCE_LINKED_EVIDENCE' });
  const unknown = checkFiniteMayCapsule({ system: { profile: 'finite-may-set-v1', transferVersion: 1 }, capsule: null, maxBytes: 1 });
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.checkedObligations, 0);
  assert.deepEqual(unknown.frontier, [{ reason: 'encoded-byte-allowance' }]);
  assert.deepEqual(inventory, []);
  console.log('Semantic budget projection retains pending original resources and independent diagnostic failures');
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) await dispose();
  await f.cleanup();
}
