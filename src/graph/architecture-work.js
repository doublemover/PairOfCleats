import { MinHeap } from '../shared/min-heap.js';
import { compareStrings } from '../shared/sort.js';

const admittedRows = new WeakMap();
/** Graph rows belong to an immutable admitted generation. Admission checks the
 * original row once; warm sorted rows are borrowed without copying their tail.
 * Raw unsorted rows retain deterministic duplicate-preserving order, using only
 * the demanded prefix plus one witness when an edge cap is present.
 */
export const architectureNeighbors = (row, remaining, work) => {
  if (remaining <= 0 || !row.length) return [];
  let admission = admittedRows.get(row);
  if (!admission) {
    let sorted = true, previous = null;
    for (const entry of row) {
      work.adjacencyAdmissionEntries++;
      if (typeof entry !== 'string' || !entry || previous !== null && compareStrings(previous, entry) > 0) sorted = false;
      previous = entry;
    }
    admission = { sorted }; admittedRows.set(row, admission);
  } else work.adjacencyAdmissionHits++;
  if (admission.sorted) return row;
  if (!Number.isFinite(remaining) || remaining >= row.length) {
    const values = [];
    for (const entry of row) { work.adjacencySelectionEntries++; const value = String(entry); if (value) values.push(value); }
    values.sort(compareStrings); work.adjacencyMaterializedEntries += values.length; return values;
  }
  const size = remaining + 1, heap = new MinHeap((a, b) => compareStrings(b, a));
  for (const entry of row) {
    work.adjacencySelectionEntries++;
    const value = String(entry); if (!value) continue;
    if (heap.size < size) heap.push(value);
    else if (compareStrings(value, heap.items[0]) < 0) { heap.pop(); heap.push(value); }
  }
  heap.items.sort(compareStrings); work.adjacencyMaterializedEntries += heap.size;
  return heap.items;
};

/** Request-owned matches cannot cross policy/root/path-normalization identities.
 * Fixed aggregate bounds include keys and cached explanations; eviction only
 * repeats a pure predicate and can never change detection or layer precedence.
 */
export const createArchitectureMatchOwner = work => {
  const entries = new Map(), identities = new WeakMap();
  let nextId = 0, retainedBytes = 0;
  const remember = (owner, path, compute, kind = 'policy') => {
    let id = identities.get(owner);
    if (!id) { id = ++nextId; identities.set(owner, id); }
    const key = id + ':' + path;
    if (entries.has(key)) {
      const hit = entries.get(key); entries.delete(key); entries.set(key, hit);
      if (kind === 'path') work.pathNormalizationHits++; else work.policyMatchHits++;
      return hit.value;
    }
    const value = compute(), bytes = 160 + key.length * 2 + (typeof value === 'string' ? value.length * 2 : 0);
    if (bytes > 1048576) return value;
    while (entries.size && (entries.size >= 4096 || retainedBytes + bytes > 1048576)) {
      const oldest = entries.keys().next().value;
      retainedBytes -= entries.get(oldest).bytes; entries.delete(oldest); work.policyMatchEvictions++;
    }
    entries.set(key, { value, bytes }); retainedBytes += bytes;
    work.policyMatchBytesHighWater = Math.max(work.policyMatchBytesHighWater, retainedBytes);
    return value;
  };
  return {
    path: (owner, identity, compute) => remember(owner, 'path:' + identity, () => {
      work.pathNormalizationCalls++; return compute();
    }, 'path'),
    matches: (selector, path) => remember(selector, path, () => selector.matches(path, work)),
    layer: (rule, path) => remember(rule, path, () => {
      for (let index = 0; index < rule.layers.length; index++) {
        if (remember(rule.layers[index].matcher, path, () => rule.layers[index].matcher.matches(path, work))) return index;
      }
      return null;
    })
  };
};

export const createArchitectureWork = () => ({
  policyCompilations: 0, policyCompilationHits: 0, graphPreparations: 0, graphPreparationHits: 0,
  adjacencyAdmissionEntries: 0, adjacencyAdmissionHits: 0, adjacencySelectionEntries: 0,
  adjacencyMaterializedEntries: 0, selectorCalls: 0, predicateCalls: 0,
  policyMatchHits: 0, policyMatchEvictions: 0, policyMatchBytesHighWater: 0, evidenceProjections: 0,
  pathNormalizationCalls: 0, pathNormalizationHits: 0
});
