import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { fingerprintSemanticOperation } from '../../../src/semantic/operation-fingerprint.js';
import { attachSemanticSourceReferences } from '../../../src/semantic/source-references.js';
import { collectJsonReferenceEvidence, createJsonReferenceEvidenceReport } from '../../../src/index/tooling/config-reference-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';

// UNVALIDATED: actual readers, original FileHandle failures and existing advisory consumers.
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (caught) { failed = true; failure = caught; }
  assert.equal(failed, true, 'unsettled original work cannot become an advisory result'); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const originalOpen = fs.open, disposal = new Map();
const install = (target, fault) => {
  const states = [];
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (path.resolve(String(file)) !== path.resolve(target)) return handle;
    const nativeRead = handle.read, nativeClose = handle.close;
    const state = { handle, reads: 0, closes: 0 }; states.push(state);
    disposal.set(handle, () => nativeClose.call(handle));
    handle.read = function (...readArgs) { assert.equal(this, handle); state.reads += 1; return nativeRead.call(handle, ...readArgs); };
    handle.close = function () {
      assert.equal(this, handle); state.closes += 1;
      const native = async () => { const result = await nativeClose.call(handle); disposal.delete(handle); return result; };
      return fault(state, native);
    };
    return handle;
  };
  return states;
};
const recover = async (failure, state, allow) => {
  const session = getContainedFileSession(failure); assert.ok(session);
  const reads = state.reads; assert.equal(state.closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
  allow(); const receipt = await session.releaseAfterClose();
  assert.equal(receipt.pending, false); assert.equal(receipt.settled, true);
  assert.equal(state.closes, 2); assert.equal(state.reads, reads); assert.equal(state.handle.fd, -1);
  assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
};
const waitForAbort = signal => signal.aborted ? Promise.resolve()
  : new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
const f = await createSourceLinkedEvidenceFixture([
  { filename: 'config.json', text: '{"entry":{"$ref":"#/$defs/value"},"$defs":{"value":{"type":"string"}}}', language: 'json' }
]);
const literal = await createRecoveryFixture('"x"');
try {
  const report = createJsonReferenceEvidenceReport({ evidence: collectJsonReferenceEvidence({ documents: f.sources }),
    generation: f.generation, configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const partition = written.output.partitions[0], ref = { partitionId: partition.partitionId, localId: 0 };
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const [record] = await store.getRecords([ref], ['data']);
  const artifact = path.join(f.stagingRoot, record.data.artifactRef);
  const request = { repoRoot: f.root, generation: f.generation, refs: [ref], include: ['providerEvidence'] };
  for (const code of ['ERR_FILE_TOO_LARGE', 'ERR_SEMANTIC_EVIDENCE_BUDGET', 'ENOENT']) {
    let deny = true;
    const original = Object.freeze(Object.assign(new Error('original provider sidecar close rejected'), { code }));
    const states = install(artifact, (_state, native) => { if (deny) throw original; return native(); });
    const failure = await rejected(() => createSemanticDetailService()({ store, request }));
    assert.equal(contains(failure, original), true);
    assert.equal(states.length, 1); await recover(failure, states[0], () => { deny = false; });
  }
  {
    const controller = new AbortController(); let deny = true;
    const states = install(artifact, (_state, native) => {
      if (deny) { controller.abort(); throw new Error('original close remains pending during caller abort'); } return native();
    });
    const failure = await rejected(() => createSemanticDetailService()({ store, request, signal: controller.signal }));
    assert.notEqual(failure, controller.signal.reason, 'caller cancellation cannot replace pending descriptor failure');
    await recover(failure, states[0], () => { deny = false; });
  }
  {
    const limited = createSemanticDetailService();
    const budgetStore = { ...store, async verifySource() {
      throw Object.assign(new Error('ordinary settled page allowance'), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
    } };
    const first = await limited({ store: budgetStore, request }); assert.ok(first.cursor);
    const second = await limited({ store: budgetStore, request: { ...request, cursor: first.cursor } });
    assert.equal(second.providerEvidence[0].state, 'budget'); assert.equal(second.cursor, null);
  }
  for (const inspectionKind of ['code', undefined, null, false, 0, '', 'pending-inspection']) {
    let settled = true, inspectionSettled = false;
    const inspection = inspectionKind === 'pending-inspection'
      ? Object.freeze(Object.assign(new Error('provider diagnostic getter owns work'), {
        cacheOwnershipReleased() { return inspectionSettled; }
      })) : inspectionKind;
    const primary = Object.defineProperties(new Error('provider source verification rejected'), {
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
      code: { get() {
        primary.cacheOwnershipReleased = () => true; settled = false;
        if (inspectionKind !== 'code') throw inspection; return 'ERR_FILE_TOO_LARGE';
      } }
    });
    const failure = await rejected(() => createSemanticDetailService()({
      store: { ...store, async verifySource() { throw primary; } }, request
    }));
    assert.equal(contains(failure, primary), true);
    if (inspectionKind !== 'code') assert.equal(contains(failure, inspection), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }

  const literalPartition = await literal.write([{ family: 'node', row: { id: 0, kind: 'literal', span: [0, 3], scope: null,
    data: { literalKind: 'StringLiteral', textRef: { span: [0, 3] }, scalar: { type: 'string', representation: '"x"' } } } }]);
  const literalRef = { partitionId: literalPartition.partitionId, localId: 0 }, literalStore = literal.store([literalPartition]);
  const sourceFile = path.join(literal.stagingRoot, 'semantic-sources', literal.source.byteHash + '.utf8');
  const readSource = async () => {
    const { buffer } = await readVerifiedContainedFile(literal.stagingRoot, sourceFile,
      { maxBytes: 4096, expectedHash: literal.source.byteHash });
    return [{ ref: literalRef, sourceUnitId: literal.source.sourceUnitId, sourceHash: literal.source.byteHash,
      coordinateUnit: 'utf16', span: [0, 3], text: buffer.toString('utf8') }];
  };
  const fingerprintStore = { ...literalStore, getSourceSpans: readSource,
    async getRelatedPage() { return { rows: [], offset: 0, done: true }; } };
  for (const code of ['ERR_SEMANTIC_OUTPUT_LIMIT', 'ENOENT']) {
    let deny = true;
    const fault = Object.freeze(Object.assign(new Error('original literal source close rejected'), { code }));
    const states = install(sourceFile, (_state, native) => { if (deny) throw fault; return native(); });
    const failure = await rejected(() => fingerprintSemanticOperation({ store: fingerprintStore, ref: literalRef }));
    assert.equal(contains(failure, fault), true);
    await recover(failure, states[0], () => { deny = false; });
  }
  assert.equal((await fingerprintSemanticOperation({ store: fingerprintStore, ref: literalRef })).complete, true);
  const ordinary = await fingerprintSemanticOperation({ store: { ...fingerprintStore, async getSourceSpans() {
    throw Object.assign(new Error('ordinary settled excerpt limit'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  } }, ref: literalRef });
  assert.equal(ordinary.complete, false); assert.ok(ordinary.reasons.includes('literal_source_projection_budget'));

  {
    let deny = true, scopedSignal;
    const original = Object.freeze(Object.assign(new Error('source reference original close rejected'), { name: 'AbortError' }));
    const states = install(sourceFile, async (_state, native) => {
      if (deny) { await waitForAbort(scopedSignal); throw original; } return native();
    });
    const result = { records: [{ ref: literalRef, span: [0, 3] }], warnings: [] };
    const referenceStore = { async getSourceReference(record, options) {
      scopedSignal = options.signal; await readSource();
      return { ref: record.ref, sourceUnitId: literal.source.sourceUnitId, sourceHash: literal.source.byteHash,
        coordinateUnit: 'utf16', path: literal.source.path };
    } };
    // AbortSignal.timeout is unref'ed; this fixture-owned timer keeps the actual
    // pending-close callback alive until its existing scoped deadline fires.
    const keepAlive = setTimeout(() => {}, 1000);
    let failure;
    try { failure = await rejected(() => attachSemanticSourceReferences({ store: referenceStore, result,
      began: performance.now(), limits: { workMs: 50, bytes: 65536 } })); }
    finally { clearTimeout(keepAlive); }
    assert.equal(scopedSignal.aborted, true); assert.deepEqual(result.sourceRefs, []);
    assert.equal(contains(failure, original), true);
    assert.deepEqual(result.warnings, [], 'pending native closure cannot be represented as an ordinary optional timeout warning');
    await recover(failure, states[0], () => { deny = false; });
  }
  {
    const result = { records: [{ ref: literalRef, span: [0, 3] }], warnings: [] };
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await attachSemanticSourceReferences({ store: { async getSourceReference(_record, { signal }) {
        await waitForAbort(signal); throw signal.reason;
      } }, result, began: performance.now(), limits: { workMs: 50, bytes: 65536 } });
    } finally { clearTimeout(keepAlive); }
    assert.deepEqual(result.sourceRefs, []); assert.equal(result.warnings.length, 1,
      'an ordinary settled optional deadline still reports incomplete source navigation');
  }
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await literal.cleanup(); await f.cleanup();
}
console.log('Semantic advisory results retain pending original evidence/source resources.');
