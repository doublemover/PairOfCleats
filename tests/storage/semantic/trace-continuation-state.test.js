import assert from 'node:assert/strict';
import { createTraceTraversalState, createTraceContinuationBudget } from '../../../src/semantic/trace-continuation-state.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const item = n => ({ ref: { partitionId: 'sy1:' + 'a'.repeat(64), localId: n }, depth: n % 64, traverse: true, stack: [] });
if (selected === 'persistent-order') {
  const owner = createTraceTraversalState({ maxBytes: 16 * 1024 * 1024 });
  const originalClone = globalThis.structuredClone; let copies = 0;
  globalThis.structuredClone = value => { copies++; return originalClone(value); };
  try {
    for (let n = 0; n < 1000; n++) assert.equal(owner.enqueue(item(n), `visit:${String(n).padStart(5, '0')}`), 'admitted');
    const checkpoint = owner.snapshot();
    const validate = node => {
      if (!node) return { height: 0, count: 0 };
      const left = validate(node.left), right = validate(node.right);
      assert.ok(Math.abs(left.height - right.height) <= 1);
      assert.equal(node.count, left.count + right.count + 1); assert.equal(node.height, Math.max(left.height, right.height) + 1);
      return { height: node.height, count: node.count };
    };
    validate(checkpoint.seen); assert.ok(checkpoint.seen.height < 20);
    for (let page = 0; page < 100; page++) {
      const fork = createTraceTraversalState({ checkpoint, maxBytes: 16 * 1024 * 1024 });
      assert.equal(fork.snapshot().seen, checkpoint.seen, 'resume/publication reuse the original immutable visited root');
      assert.equal(fork.stats().visitedNodeAllocations, 0);
    }
    assert.equal(copies, 1000, 'only newly admitted items are cloned; old history is never cloned on resume/publication');
    for (let n = 0; n < 1000; n++) { assert.equal(owner.peek().ref.localId, n); owner.shift(); }
    assert.equal(owner.size, 0); assert.equal(owner.snapshot().front, null); assert.equal(owner.snapshot().back, null);
    assert.equal(owner.seenCount, 1000, 'processed refs leave the frontier while visited meaning remains');
    assert.equal(owner.stats().copiedHistoryEntries, 0);
  } finally { globalThis.structuredClone = originalClone; }
} else if (selected === 'forks') {
  const owner = createTraceTraversalState(), first = item(1);
  owner.enqueue(first, 'one'); first.ref.localId = 99; first.stack.push('external mutation');
  const checkpoint = owner.snapshot(), a = createTraceTraversalState({ checkpoint }), b = createTraceTraversalState({ checkpoint });
  a.enqueue(item(2), 'two'); b.enqueue(item(3), 'three');
  assert.equal(a.peek().ref.localId, 1); assert.deepEqual(a.peek().stack, []); a.shift();
  assert.equal(a.peek().ref.localId, 2); assert.equal(b.peek().ref.localId, 1); b.shift(); assert.equal(b.peek().ref.localId, 3);
  assert.equal(createTraceTraversalState({ checkpoint }).peek().ref.localId, 1);
  assert.equal(a.enqueue(item(2), 'two'), 'existing');
  assert.equal(a.enqueue({ ...item(2), traverse: false }, 'two-evidence'), 'admitted', 'context/traversal identity remains caller-qualified');
  assert.throws(() => createTraceTraversalState({ checkpoint: { ...checkpoint } }), /no immutable state owner/u);
} else if (selected === 'byte-admission') {
  const owner = createTraceTraversalState({ maxBytes: 2048 });
  assert.equal(owner.enqueue(item(0), 'seed'), 'admitted');
  const before = owner.stats(), frozen = owner.snapshot();
  assert.equal(owner.enqueue(item(1), 'x'.repeat(10000)), 'budget');
  assert.equal(owner.enqueue({ ...item(1), stack: ['x'.repeat(10000)] }, 'short-key'), 'budget', 'payload accounting does not trust identity length alone');
  assert.equal(owner.stats().visitedNodeAllocations, before.visitedNodeAllocations);
  assert.equal(owner.stats().admittedEntries, 1); assert.ok(owner.logicalBytes <= 2048);
  assert.equal(owner.snapshot().seen, frozen.seen); assert.equal(owner.snapshot().back, frozen.back);
} else if (selected === 'seed-refusal') {
  const owner = createTraceTraversalState({ maxBytes: 2048 });
  owner.reset(item(1), 'first');
  const previous = owner.snapshot();
  assert.throws(() => owner.reset(item(2), 'x'.repeat(10000)), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  const restored = owner.snapshot();
  assert.equal(restored.seen, previous.seen); assert.equal(restored.front, previous.front); assert.equal(restored.back, previous.back);
  assert.equal(owner.peek().ref.localId, 1, 'refused replacement cannot discard the admitted original frontier');
  assert.throws(() => owner.reset({ ...item(2), depth: -1 }, 'invalid'), TypeError);
  assert.equal(owner.peek().ref.localId, 1, 'invalid producer input retains its original cause and prior state');
  const smallest = createTraceTraversalState({ maxBytes: 1024 });
  assert.throws(() => smallest.reset(item(0), 'seed'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  assert.equal(smallest.size, 0); assert.equal(smallest.seenCount, 0);
} else if (selected === 'retention') {
  const budget = createTraceContinuationBudget({ maxBytes: 8192 }), retired = [], expires = Date.now() + 60000;
  const first = budget.retain(4096, expires, () => { retired.push('first'); });
  budget.retain(4096, expires, () => { retired.push('second'); });
  budget.retain(4096, expires, () => { retired.push('third'); });
  assert.deepEqual(retired, ['first']); first.release(); assert.deepEqual(retired, ['first']);
  assert.equal(budget.stats().retainedBytes, 8192); assert.equal(budget.stats().retainedCursors, 2);
  budget.sweep(expires + 1); assert.deepEqual(retired, ['first', 'second', 'third']); assert.equal(budget.stats().retainedBytes, 0);
  assert.throws(() => budget.retain(8193, expires, () => {}), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
} else if (['actual-pages', 'actual-replay', 'aggregate-services', 'failed-publication', 'state-frontier', 'seed-refusal-service'].includes(selected)) {
  const fixture = await createRecoveryFixture('value');
  try {
    const ref = localId => ({ partitionId: fixture.partitionId, localId });
    const broad = selected === 'state-frontier';
    const edges = Array.from({ length: 39 }, (_, n) => ({ family: 'edge', row: { id: n, kind: 'flowsTo',
      from: ref(broad ? 0 : n), to: ref(n + 1), evidence: null, callSite: null,
      operandOrdinal: null, contextKey: null, condition: null, certainty: 'modeled' } }));
    const partition = await fixture.write([...Array.from({ length: 40 }, (_, id) => semanticNode(id, 5)), ...edges]);
    const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions: [partition], store: fixture.store([partition]), diskAccount: fixture.account });
    const store = fixture.store([partition], { queryIndex });
    const request = { repoRoot: fixture.root, generation: fixture.generation, seed: ref(0), direction: 'downstream', kinds: ['flowsTo'],
      limits: { records: 1, edges: 128, depth: 64, bytes: 65536 } };
    if (selected === 'aggregate-services') {
      const budget = createTraceContinuationBudget({ maxBytes: 12288 });
      const services = [createSemanticTraceService({ retentionBudget: budget }), createSemanticTraceService({ retentionBudget: budget })];
      let first;
      for (let n = 0; n < 16; n++) {
        const page = await services[n % 2]({ store, request });
        if (!first) first = page.cursor;
        assert.ok(budget.stats().retainedBytes <= 12288);
      }
      assert.ok(budget.stats().evictions > 0);
      await assert.rejects(services[0]({ store, request: { ...request, cursor: first } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
      services.forEach(service => service.dispose()); assert.equal(budget.stats().retainedBytes, 0);
    } else {
      let rejectFinal = false;
      const failure = new Error('original final response projection failed');
      const service = createSemanticTraceService({ ...(broad ? { maxStateBytes: 8192 }
        : selected === 'seed-refusal-service' ? { maxStateBytes: 1024 } : {}),
      maxContinuations: selected === 'failed-publication' ? 1 : 64,
      finalizeResult: result => { if (rejectFinal) throw failure; return result; } });
      if (selected === 'seed-refusal-service') {
        await assert.rejects(service({ store, request }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
        assert.equal(service.continuationStats().serviceCursors, 0);
      } else {
        const first = await service({ store, request }); assert.ok(first.cursor);
        if (selected === 'actual-replay') {
          const pages = await Promise.all([service({ store, request: { ...request, cursor: first.cursor } }), service({ store, request: { ...request, cursor: first.cursor } })]);
          assert.deepEqual(pages[0].records, pages[1].records); assert.deepEqual(pages[0].edges, pages[1].edges);
          assert.deepEqual((await service({ store, request: { ...request, cursor: first.cursor } })).records, pages[0].records);
        } else if (selected === 'failed-publication') {
          rejectFinal = true; await assert.rejects(service({ store, request }), error => error === failure);
          rejectFinal = false;
          assert.equal(service.continuationStats().serviceCursors, 1);
          assert.ok((await service({ store, request: { ...request, cursor: first.cursor } })).records.length);
        } else {
          const ids = first.records.map(row => row.ref.localId);
          let cursor = first.cursor, budgetFrontier = first.frontier.some(row => row.reason === 'visited_budget'), pages = 1;
          while (cursor) {
            const page = await service({ store, request: { ...request, cursor } });
            ids.push(...page.records.map(row => row.ref.localId)); cursor = page.cursor;
            budgetFrontier ||= page.frontier.some(row => row.reason === 'visited_budget');
            assert.ok(++pages <= 45); assert.equal(service.continuationStats().lastPageWork.copiedHistoryEntries, 0);
            assert.ok(service.continuationStats().lastPageWork.logicalBytes <= (broad ? 8192 : 8 * 1024 * 1024));
          }
          if (broad) { assert.equal(budgetFrontier, true); assert.ok(ids.length < 40); }
          else assert.deepEqual(ids, Array.from({ length: 40 }, (_, n) => n), 'independent authored chain defines exact ordered traversal');
        }
      }
      service.dispose(); assert.equal(service.continuationStats().serviceRetainedBytes, 0);
    }
  } finally { await fixture.cleanup(); }
} else assert.fail(`Unknown trace continuation control: ${selected}`);
console.log(`semantic trace continuation ${selected} control`);
