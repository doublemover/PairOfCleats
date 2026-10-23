import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { createSemanticExplainService } from '../../../src/semantic/explain.js';
import { createSemanticExplainRunner } from '../../../src/integrations/tooling/semantic-explain.js';
import { projectExplainEnrichment } from '../../../src/semantic/explain-enrichment.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { classifySemanticDetailError } from '../../../src/integrations/tooling/semantic-errors.js';

// UNVALIDATED: actual retained rows/frontier projection and original FileHandle
// faults. Suggestions remain proposals; this fixture executes no task/provider.
const rejected = async run => {
  let failed = false, failure;
  try { await run(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const visit = (failure, inspect) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); inspect(value);
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
};
const contains = (failure, expected) => {
  let found = false; visit(failure, value => { if (value === expected) found = true; }); return found;
};
const waitForAbort = signal => signal.aborted ? Promise.resolve()
  : new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
const f = await createRecoveryFixture('explain submitted source');
const originalOpen = fs.open, disposal = new Map();
try {
  const taskIdentity = { kind: 'bind', inputHashes: [f.source.byteHash], policyHash: 'a'.repeat(64), targetSetHash: 'b'.repeat(64) };
  const task = { schemaVersion: 1, taskId: createSemanticTaskId(taskIdentity), ...taskIdentity,
    baseBuildId: f.generation.baseBuildId, sourceUnits: [f.source.sourceUnitId], targetsRef: 'targets.json',
    dependencies: [], priority: 1, reason: 'fixture binding unavailable', coverageToProduce: ['bindings'] };
  const syntax = await f.write([semanticNode(0, f.source.textLength), { family: 'frontier', row: task }]);
  const raw = f.store([syntax]), ref = { partitionId: syntax.partitionId, localId: 0 };
  const scope = () => ({ repoRoot: f.root, generation: { ...f.generation } });
  const requestFor = () => ({ ...scope(), seed: { ...ref }, direction: 'downstream', kinds: ['flowsTo'],
    limits: { workMs: 250, bytes: 65536 } });
  const manifest = { generation: { ...f.generation }, partitions: [syntax], completedTasks: [] };
  const mutate = request => {
    request.generation.baseBuildId = 'changed'; request.seed.localId = 9;
    request.direction = 'upstream'; request.kinds[0] = 'callTarget'; request.limits.bytes = 1;
  };
  const baseStore = { ...raw, async getNeighbors(owner, direction, kinds) {
    assert.deepEqual(owner, ref); assert.equal(direction, 'downstream'); assert.deepEqual(kinds, ['flowsTo']);
    return { edges: [], offset: 0, done: true };
  } };
  const request = requestFor();
  const result = await createSemanticExplainService()({ manifest, request, store: { ...baseStore,
    withReadScope(run) { mutate(request); return raw.withReadScope(run); }
  } });
  assert.deepEqual(result.generation, f.generation);
  assert.deepEqual(result.records.map(row => row.ref), [ref]);
  assert.equal(result.enrichment.status, 'available');
  assert.equal(result.enrichment.suggestions.length, 1);
  const suggestion = result.enrichment.suggestions[0];
  assert.deepEqual(suggestion.generation, f.generation);
  assert.deepEqual(suggestion.planRequest.generation, f.generation);
  assert.deepEqual(suggestion.enqueueRequest.generation, f.generation);
  assert.equal(suggestion.planRequest.action, 'plan');
  assert.equal(suggestion.enqueueRequest.action, 'enqueue');
  assert.equal(suggestion.planRequest.repoRoot, f.root);
  assert.notEqual(suggestion.generation, request.generation);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);

  const publicRequest = requestFor(); let closed = 0;
  const runner = createSemanticExplainRunner({ async openStore(options) {
    assert.deepEqual(options.generation, f.generation); assert.ok(Object.isFrozen(options.generation));
    mutate(publicRequest); return { store: baseStore, manifest, close: () => { closed++; } };
  } });
  const publicResult = await runner(publicRequest, { userConfig: {} });
  assert.equal(closed, 1);
  assert.deepEqual(publicResult.generation, f.generation);
  assert.deepEqual(publicResult.enrichment.suggestions[0].enqueueRequest.generation, f.generation);
  const optional = { ...requestFor(), cursor: undefined, backend: undefined };
  assert.deepEqual((await createSemanticExplainService()({ store: baseStore, manifest, request: optional })).generation, f.generation);
  for (const invalid of [{ ...requestFor(), unknown: true }, { ...requestFor(), direction: 'sideways' }]) {
    await assert.rejects(createSemanticExplainService()({ store: baseStore, manifest, request: invalid }), error =>
      error.code === 'ERR_SEMANTIC_QUERY_CONTRACT' && classifySemanticDetailError(error).status === 400);
  }

  const records = await raw.getRecords([ref]);
  const projectInput = { store: raw, manifest, request: requestFor(),
    result: { records, frontier: [{ reason: 'analysis_incomplete' }] }, maxMs: 50 };
  const target = path.resolve(f.stagingRoot, syntax.members.semantic_sources[0].path);
  for (const abortCaller of [false, true]) {
    let deny = true, scopedSignal, state;
    const caller = new AbortController();
    const original = Object.freeze(Object.assign(new Error('original explanation reader close rejected'), { name: 'AbortError' }));
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (path.resolve(String(file)) !== target) return handle;
      const nativeClose = handle.close, nativeRead = handle.read;
      state = { handle, reads: 0, closes: 0 };
      disposal.set(handle, () => nativeClose.call(handle));
      handle.read = function (...readArgs) { assert.equal(this, handle); state.reads++; return nativeRead.call(handle, ...readArgs); };
      handle.close = async function () {
        assert.equal(this, handle); state.closes++;
        if (deny) {
          await waitForAbort(scopedSignal);
          if (abortCaller) caller.abort();
          throw original;
        }
        const value = await nativeClose.call(handle); disposal.delete(handle); return value;
      };
      return handle;
    };
    const store = { ...raw, iterateRows(partitionId, member, options) {
      scopedSignal = options.signal; return raw.iterateRows(partitionId, member, options);
    } };
    const keepAlive = setTimeout(() => {}, 1000);
    let failure;
    try { failure = await rejected(() => projectExplainEnrichment({ ...projectInput, store, signal: caller.signal })); }
    finally { clearTimeout(keepAlive); fs.open = originalOpen; }
    assert.equal(contains(failure, original), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(state.closes, 1);
    const sessions = new Set();
    visit(failure, value => {
      const single = getContainedFileSession(value); if (single) sessions.add(single);
      if (value === null || !['object', 'function'].includes(typeof value)) return;
      const group = Object.getOwnPropertyDescriptor(value, 'containedFileSessions')?.value;
      if (Array.isArray(group)) for (const session of group) { assert.equal(isContainedFileSession(session), true); sessions.add(session); }
    });
    assert.ok(sessions.size > 0);
    const reads = state.reads; deny = false;
    for (const session of sessions) {
      const receipt = await session.releaseAfterClose(); assert.equal(receipt.pending, false); assert.equal(receipt.settled, true);
    }
    assert.equal(state.reads, reads, 'original close recovery never repeats metadata reads or task projection');
    assert.equal(state.closes, 2); assert.equal(state.handle.fd, -1);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }

  for (const kind of ['name', undefined, null, false, 0, '', 'pending-inspection']) {
    let settled = true, inspectionSettled = false;
    const inspection = kind === 'pending-inspection' ? Object.freeze(Object.assign(new Error('name inspection owns work'), {
      cacheOwnershipReleased: () => inspectionSettled
    })) : kind;
    const primary = Object.defineProperties(new Error('explanation iterator rejected'), {
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
      name: { get() {
        primary.cacheOwnershipReleased = () => true; settled = false;
        if (kind !== 'name') throw inspection; return 'AbortError';
      } }
    });
    const keepAlive = setTimeout(() => {}, 1000);
    let failure;
    try { failure = await rejected(() => projectExplainEnrichment({ ...projectInput, maxMs: 5,
      store: { ...raw, async *iterateRows(partitionId, member, options) { await waitForAbort(options.signal); throw primary; } }
    })); } finally { clearTimeout(keepAlive); }
    assert.equal(contains(failure, primary), true);
    if (kind !== 'name') assert.equal(contains(failure, inspection), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  const keepAlive = setTimeout(() => {}, 1000);
  let ordinary;
  try { ordinary = await projectExplainEnrichment({ ...projectInput, maxMs: 5,
    store: { ...raw, async *iterateRows(partitionId, member, options) { await waitForAbort(options.signal); throw options.signal.reason; } }
  }); } finally { clearTimeout(keepAlive); }
  assert.equal(ordinary.enrichment.status, 'partial');
  assert.deepEqual(ordinary.enrichment.suggestions, []);
  assert.ok(ordinary.enrichment.reasons.some(reason => reason.includes('work allowance')));
  console.log('Explain retains submitted task identity and pending original readers before optional deadline projection');
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) await dispose();
  await f.cleanup();
}
