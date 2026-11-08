import { registerHooks } from 'node:module';

const registryKey = '__pocRiskWitnessObservation';
const engineUrl = new URL('../../src/index/risk-interprocedural/engine.js', import.meta.url);
const representationUrl = new URL('../fixtures/risk/witness-representation.js', import.meta.url);

/** Probe original Map membership and the actual queue/witness factories. Only
 * numbers leave the scope; no probe arena keeps completed witness nodes alive. */
export const createRiskWitnessObservation = (arm, { deep = true } = {}) => {
  if (!['candidate', 'reference'].includes(arm)) throw new TypeError('Explicit risk representation arm required.');
  const registered = new WeakSet();
  const parentAdmissions = new WeakMap();
  const metrics = { nodesCreated: 0, copiedPrefixSlots: 0, materializations: 0, emittedArraySlots: 0,
    reusedParentLinks: 0,
    statesEnqueued: 0, statesConsumed: 0, peakFrontier: 0, peakOwnedQueueSlots: 0,
    peakIndexEntries: 0, clearedIndexEntries: 0, indexClears: 0,
    peakRetainedWitnessNodes: 0, peakRetainedPathSlots: 0, sampledPeakHeapBytes: 0 };
  let index = null, queue = null, ticks = 0;
  const sample = (force = false) => {
    if (!force && ++ticks % 64 !== 0) return;
    metrics.sampledPeakHeapBytes = Math.max(metrics.sampledPeakHeapBytes, process.memoryUsage().heapUsed);
    if (!deep) return;
    const nodes = new Set();
    const visit = witness => {
      for (let node = witness; node && !nodes.has(node); node = node.parent) nodes.add(node);
    };
    if (index) for (const values of index.values()) for (const witness of values) visit(witness);
    if (queue) for (const state of queue.ownedStates()) visit(state.witness);
    let slots = 0;
    for (const node of nodes) slots += (node.chunks?.length || 0) + (node.calls?.length || 0) + (node.watches?.length || 0);
    metrics.peakRetainedWitnessNodes = Math.max(metrics.peakRetainedWitnessNodes, nodes.size);
    metrics.peakRetainedPathSlots = Math.max(metrics.peakRetainedPathSlots, slots);
  };
  const probe = {
    metrics,
    created(node, copiedPrefixSlots = 0) {
      registered.add(node); metrics.nodesCreated++; metrics.copiedPrefixSlots += copiedPrefixSlots;
      if (node.parent) {
        const previous = parentAdmissions.get(node.parent) || 0;
        if (previous) metrics.reusedParentLinks++;
        parentAdmissions.set(node.parent, previous + 1);
      }
      return node;
    },
    materialized(value) { metrics.materializations++; metrics.emittedArraySlots += value.chunkUids.length + value.callSiteIdsByStep.length + value.watchByStep.length; return value; },
    queue(value) { queue = value; },
    pushed() {
      metrics.statesEnqueued++; metrics.peakFrontier = Math.max(metrics.peakFrontier, queue.length);
      metrics.peakOwnedQueueSlots = Math.max(metrics.peakOwnedQueueSlots, queue.ownedSlots); sample();
    },
    popped() {
      metrics.statesConsumed++; metrics.peakOwnedQueueSlots = Math.max(metrics.peakOwnedQueueSlots, queue.ownedSlots); sample();
    }
  };
  const armUrl = new URL(engineUrl); armUrl.searchParams.set('risk-witness-arm', arm);
  const targetUrl = new URL(representationUrl); targetUrl.searchParams.set('arm', arm);
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === armUrl.href && ['./witness.js', './state-queue.js'].includes(specifier)) {
      return { url: targetUrl.href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  const run = operation => {
    const originalSet = Map.prototype.set, originalClear = Map.prototype.clear;
    const registry = globalThis[registryKey] ||= new Map();
    if (registry.has(arm)) throw new Error('Risk observation scopes cannot overlap for the same arm.');
    registry.set(arm, probe);
    Map.prototype.set = function (key, value) {
      const result = originalSet.call(this, key, value);
      if (Array.isArray(value) && value.length && registered.has(value[0])) {
        if (index && index !== this) throw new Error('Unexpected second witness index.');
        index = this; metrics.peakIndexEntries = Math.max(metrics.peakIndexEntries, this.size); sample();
      }
      return result;
    };
    Map.prototype.clear = function () {
      if (this === index) { sample(true); metrics.indexClears++; metrics.clearedIndexEntries += this.size; }
      return originalClear.call(this);
    };
    try { const value = operation(); sample(true); return value; }
    finally {
      Map.prototype.set = originalSet; Map.prototype.clear = originalClear;
      registry.delete(arm); index = null; queue = null;
    }
  };
  return { metrics, load: async () => (await import(armUrl.href)).computeInterproceduralRisk, run,
    dispose: () => hooks.deregister() };
};

/** The only normalized fields are the producer's invocation timestamp and wall
 * timings. Preserve all content, status, order, caps and referenced call IDs. */
export const riskSemanticProjection = result => {
  const { generatedAt, timingMs, ...stats } = result.stats;
  if (!Number.isFinite(Date.parse(generatedAt)) || !timingMs) throw new Error('Expected real invocation metadata.');
  return { ...result, stats, callSiteIdsReferenced: [...result.callSiteIdsReferenced] };
};
