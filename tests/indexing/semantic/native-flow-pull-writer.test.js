import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createNativeFlowTree } from '../../helpers/native-flow-construction.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { semanticPolicyIdentities } from '../../../src/index/semantic/policy.js';
import { semanticConstructionAdmissionFor, semanticByteAdmissionFor } from '../../../src/index/semantic/planning.js';
import { NATIVE_FLOW_SHARED_CONSTRUCTION_BYTES } from '../../../src/index/semantic/native-flow-construction.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

const controlUrl = new URL('../../../src/index/semantic/native-control-flow.js', import.meta.url).href;
const writeUrl = new URL('../../../src/index/semantic/analysis-write.js', import.meta.url).href;
const partitionUrl = new URL('../../../src/index/build/artifacts/writers/semantic/partition.js', import.meta.url).href;
const rowsUrl = new URL('../../../src/index/semantic/native-control-rows.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === controlUrl + '?pull-test' && specifier === './analysis-write.js') return { url: writeUrl + '?pull-test', shortCircuit: true };
    if (context.parentURL === controlUrl + '?pull-test' && specifier === './native-control-rows.js') return { url: 'native-flow:row-observer', shortCircuit: true };
    if (context.parentURL === writeUrl + '?pull-test' && specifier.endsWith('/semantic/partition.js')) return { url: 'native-flow:sink-observer', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'native-flow:row-observer') return { format: 'module', shortCircuit: true, source: `
      import * as owner from ${JSON.stringify(rowsUrl)};
      export function* nativeControlRows(options){globalThis.nativeFlowSinkProbe.construction=options.construction;yield*owner.nativeControlRows(options);}` };
    if (url === 'native-flow:sink-observer') return { format: 'module', shortCircuit: true, source: `
      import * as owner from ${JSON.stringify(partitionUrl)};
      export * from ${JSON.stringify(partitionUrl)};
      export const createSemanticPartitionSink=async options=>{
        const sink=await owner.createSemanticPartitionSink(options),probe=globalThis.nativeFlowSinkProbe;
        return {...sink,appendBatch:async batch=>{probe.batches++;if(probe.batches===1&&probe.started){probe.started.resolve();await probe.release.promise;}
          if(probe.appendFailure)throw probe.appendFailure;return sink.appendBatch(batch);},
          finalizeSource:async()=>{if(probe.finalizeFailure)throw probe.finalizeFailure;return sink.finalizeSource();}};};` };
    return next(url, context);
  }
});
const visit = (error, predicate) => {
  const queue = [error], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (predicate(value)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const fixture = await createRecoveryFixture('f(1);');
const originalRemove = fs.rm;
try {
  const { collectNativeControlFlow } = await import(controlUrl + '?pull-test');
  const tree = createNativeFlowTree({ statements: 16, partitionId: fixture.partitionId });
  const syntax = await fixture.write(tree.nodes.map(node => semanticNode(node.id, fixture.source.textLength)));
  const initialDisk = fixture.account.used, initialDirectories = await fixture.partDirectories();
  const policy = normalizeSemanticConfig({ enabled: true, enrichment: { localFlow: 'eager' },
    storage: { batchRows: 3, batchBytes: 8192, maxQueuedBytes: 16384 } });
  const options = { syntax: { tree: {} }, collector: tree.collector, partition: syntax, source: fixture.source,
    bytes: fixture.bytes, root: fixture.stagingRoot, policy: { ...policy, identity: semanticPolicyIdentities(policy) }, diskAccount: fixture.account };
  const admission = semanticConstructionAdmissionFor(fixture.account, NATIVE_FLOW_SHARED_CONSTRUCTION_BYTES);
  const queued = semanticByteAdmissionFor(fixture.account, policy.storage.maxQueuedBytes);
  const probe = globalThis.nativeFlowSinkProbe = { batches: 0, started: Promise.withResolvers(), release: Promise.withResolvers() };
  const pending = collectNativeControlFlow(options);
  await Promise.race([probe.started.promise, pending.then(() => { throw new Error('Flow completed before its append barrier.'); })]);
  const constructedAtPause = probe.construction.stats.constructedRows, workAtPause = probe.construction.stats.work;
  assert.equal(constructedAtPause, 4, 'existing writer retains a three-row batch and one explicit lookahead');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(probe.construction.stats.constructedRows, constructedAtPause);
  assert.equal(probe.construction.stats.work, workAtPause, 'stalled actual append prevents all further construction');
  assert.equal(admission.used, 16384); assert.equal(probe.construction.stats.livePreparedRows, 1);
  probe.release.resolve(); const completed = await pending;
  assert.ok(completed.partition); assert.equal(completed.coverage.state, 'partial');
  assert.equal(completed.construction.liveLogicalBytes, 0); assert.equal(admission.used, 0); assert.equal(queued.used, 0);
  await validateSemanticPartitions({ store: fixture.store([syntax, completed.partition]), partitions: [syntax, completed.partition] });

  const beforePartialDisk = fixture.account.used, beforePartialDirs = await fixture.partDirectories();
  const heldConstruction = await admission.acquire(NATIVE_FLOW_SHARED_CONSTRUCTION_BYTES);
  const queuedController = new AbortController();
  const waiting = collectNativeControlFlow({ ...options, signal: queuedController.signal });
  assert.equal(admission.pending, 1); queuedController.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(admission.pending, 0); heldConstruction(); assert.equal(admission.used, 0);
  assert.deepEqual(await fixture.partDirectories(), beforePartialDirs, 'cancelled construction admission creates no sink');
  globalThis.nativeFlowSinkProbe = { batches: 0 };
  const tiny = normalizeSemanticConfig({ enabled: true, enrichment: { localFlow: 'eager' },
    storage: { batchRows: 3, batchBytes: 8192, maxQueuedBytes: 512 } });
  tiny.identity = semanticPolicyIdentities(tiny);
  const partial = await collectNativeControlFlow({ ...options, policy: tiny });
  assert.equal(partial.partition, null); assert.equal(partial.coverage.state, 'partial');
  assert.match(partial.coverage.reason, /^native_flow_construction_(entry_bytes|live_bytes)_limit$/u);
  assert.equal(partial.coverage.observedCount, null); assert.equal(partial.coverage.completedCount, 0);
  assert.equal(partial.coverage.frontierRef, null); assert.equal(partial.construction.liveLogicalBytes, 0);
  assert.equal(fixture.account.used, beforePartialDisk); assert.deepEqual(await fixture.partDirectories(), beforePartialDirs);
  assert.equal(admission.used, 0);

  for (const field of ['appendFailure', 'finalizeFailure']) {
    const original = Object.freeze(new Error(field));
    globalThis.nativeFlowSinkProbe = { batches: 0, [field]: original };
    await assert.rejects(collectNativeControlFlow(options), error => visit(error, value => value === original));
    assert.equal(admission.used, 0); assert.equal(queued.used, 0);
    assert.equal(fixture.account.used, beforePartialDisk); assert.deepEqual(await fixture.partDirectories(), beforePartialDirs);
  }
  const controller = new AbortController();
  const cancelling = globalThis.nativeFlowSinkProbe = { batches: 0, started: Promise.withResolvers(), release: Promise.withResolvers() };
  const cancelled = collectNativeControlFlow({ ...options, signal: controller.signal });
  await Promise.race([cancelling.started.promise, cancelled.then(() => { throw new Error('Flow completed before its cancellation barrier.'); })]);
  controller.abort(); cancelling.release.resolve();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(cancelling.construction.stats.liveLogicalBytes, 0); assert.equal(admission.used, 0); assert.equal(queued.used, 0);
  assert.deepEqual(await fixture.partDirectories(), beforePartialDirs);

  const cleanupFailure = Object.freeze(new Error('construction cleanup failed'));
  fs.rm = async (location, ...args) => {
    if (String(location).includes('semantic-part-')) throw cleanupFailure;
    return originalRemove(location, ...args);
  };
  globalThis.nativeFlowSinkProbe = { batches: 0 };
  await assert.rejects(collectNativeControlFlow({ ...options, policy: tiny }), error =>
    visit(error, value => value === cleanupFailure) && visit(error, value => value?.code === 'ERR_NATIVE_FLOW_CONSTRUCTION_BUDGET'),
  'failed cleanup cannot be hidden as an ordinary incomplete-flow result');
  assert.equal(admission.used, 0);
  assert.ok(fixture.account.used >= initialDisk); assert.ok((await fixture.partDirectories()).length >= initialDirectories.length);
} finally { fs.rm = originalRemove; delete globalThis.nativeFlowSinkProbe; hooks.deregister(); await fixture.cleanup(); }
console.log('Actual native flow writer backpressures construction and drains staging/leases on partial budget, cancellation and sink failures.');
