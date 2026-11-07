import * as actual from '../../../src/index/risk-interprocedural/witness.js';
import { createRiskStateQueue as actualQueue } from '../../../src/index/risk-interprocedural/state-queue.js';

const arm = new URL(import.meta.url).searchParams.get('arm');
if (!['candidate', 'reference'].includes(arm)) throw new TypeError('Explicit fixture representation required.');
const probe = () => {
  const owner = globalThis.__pocRiskWitnessObservation?.get(arm);
  if (!owner) throw new Error('An active risk observation scope is required.');
  return owner;
};
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Independent array-copy control. It uses the real reconciled engine's path
 * admission, so an old one-path bug cannot masquerade as an optimization. */
export const createRiskWitness = input => {
  if (arm === 'candidate') return probe().created(actual.createRiskWitness(input));
  const { parent = null, chunkUid, callSiteIds = [], watch = null } = input;
  return probe().created({ depth: parent ? parent.depth + 1 : 0, chunkUid,
    chunks: parent ? [...parent.chunks, chunkUid] : [chunkUid],
    calls: parent ? [...parent.calls, callSiteIds.slice()] : [],
    watches: parent ? [...parent.watches, watch] : [] },
  parent ? parent.chunks.length + parent.calls.length + parent.watches.length : 0);
};
export const compareRiskWitnesses = (a, b) => arm === 'candidate' ? actual.compareRiskWitnesses(a, b)
  : compareText(JSON.stringify([a.chunks, a.calls]), JSON.stringify([b.chunks, b.calls]));
export const matchesRiskWitnessExtension = (candidate, parent, callSiteKey) => arm === 'candidate'
  ? actual.matchesRiskWitnessExtension(candidate, parent, callSiteKey)
  : JSON.stringify(candidate.chunks.slice(0, -1)) === JSON.stringify(parent.chunks)
    && JSON.stringify(candidate.calls.slice(0, -1)) === JSON.stringify(parent.calls)
    && JSON.stringify(candidate.calls.at(-1)) === callSiteKey;
export const materializeRiskWitness = witness => probe().materialized(arm === 'candidate'
  ? actual.materializeRiskWitness(witness) : { chunkUids: witness.chunks.slice(),
    callSiteIdsByStep: witness.calls.map(row => row.slice()), watchByStep: witness.watches.map(row => ({ ...row })) });

const referenceQueue = () => {
  const heap = [], consumed = [];
  const key = state => JSON.stringify([state.rootSource.chunkUid, state.rootSource.source.ruleId,
    state.witness.chunks, state.witness.calls, state.taintKey ?? null]);
  const compare = (a, b) => a.depth - b.depth || a.sanitizerBarriersHit - b.sanitizerBarriersHit || compareText(key(a), key(b));
  return {
    push(state) {
      heap.push(state);
      let i = heap.length - 1;
      while (i) {
        const parent = Math.floor((i - 1) / 2);
        if (compare(heap[parent], heap[i]) <= 0) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]]; i = parent;
      }
    },
    pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) {
          let next = i;
          for (const child of [2 * i + 1, 2 * i + 2]) if (child < heap.length && compare(heap[child], heap[next]) < 0) next = child;
          if (next === i) break;
          [heap[i], heap[next]] = [heap[next], heap[i]]; i = next;
        }
      }
      if (first) consumed.push(first);
      return first;
    },
    get length() { return heap.length; }, pending: () => heap.slice(),
    ownedStates: () => [...consumed, ...heap], get ownedSlots() { return heap.length + consumed.length; }
  };
};

export const createRiskStateQueue = () => {
  const underlying = arm === 'candidate' ? actualQueue() : referenceQueue();
  const view = { get length() { return underlying.length; }, pending: () => underlying.pending(),
    ownedStates: () => arm === 'candidate' ? underlying.pending() : underlying.ownedStates(),
    get ownedSlots() { return arm === 'candidate' ? underlying.length : underlying.ownedSlots; } };
  probe().queue(view);
  return { ...view, get length() { return underlying.length; },
    push(state) { underlying.push(state); probe().pushed(); },
    pop() { const state = underlying.pop(); probe().popped(); return state; }
  };
};
