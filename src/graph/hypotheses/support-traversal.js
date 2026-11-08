import { performance } from 'node:perf_hooks';
import { semanticHash } from '../../index/semantic/identity.js';
import { createOccurrenceRelation, sumOccurrenceRelations, openOccurrenceCursor } from '../../semantic/relations/factor.js';
import { throwIfAborted } from '../../shared/abort.js';
import { readFiniteCausalModelInput } from './finite-model.js';

/** Reference parity path through the existing occurrence/factor owner. Only
 * original assignment ordinals carry mass: physical sum choices are not extra
 * observations or existential-auxiliary assignments. Construction is charged
 * on every page; this is not a claimed optimization over direct enumeration.
 */
export const finiteCausalSupportOrder = (model, strategy, signal) => {
  const began = performance.now(), input = readFiniteCausalModelInput(model), count = input.exogenousSupport.assignments.length;
  if (!['enumeration', 'factorized'].includes(strategy)) throw new TypeError('Invalid finite support traversal strategy.');
  throwIfAborted(signal);
  if (strategy === 'enumeration') return { indices: Array.from({ length: count }, (_, index) => index),
    work: { strategy, constructionMs: performance.now() - began, traversalMs: 0, occurrenceWork: 0, originalAssignments: count } };
  const leaves = [];
  for (let first = 0; first < count; first += 16) {
    const rows = [];
    for (let index = first; index < Math.min(first + 16, count); index++) {
      const id = semanticHash('finite-causal.exogenous-assignment.v1', { modelId: model.modelId, index });
      rows.push({ occurrenceId: id, supportId: id, tuple: [index], multiplicity: '1', sourceRef: null });
    }
    leaves.push(createOccurrenceRelation({ world: input.worldRef, relationId: model.modelId + ':' + first, atomRoleId: 'exogenous-assignment',
      schema: [{ name: 'supportIndex', type: 'integer', nullable: false }], rows, complete: input.exogenousSupport.state === 'complete', maxRetainedBytes: 131072 }));
  }
  if (!leaves.length) return { indices: [], work: { strategy, constructionMs: performance.now() - began, traversalMs: 0, occurrenceWork: 0, originalAssignments: 0 } };
  const relation = leaves.length === 1 ? leaves[0] : sumOccurrenceRelations(leaves), cursor = openOccurrenceCursor({ relation });
  const builtAt = performance.now();
  let page;
  try { page = cursor.next({ limit: 256, maxBytes: 1024 * 1024, workBudget: 100000, signal }); }
  finally { cursor.close(); }
  throwIfAborted(signal);
  const indices = page.items.map(row => row.tuple.supportIndex);
  if (!page.retainedEnumerationComplete || indices.length !== count || indices.some((value, index) => value !== index)) {
    throw Object.assign(new Error('Factor traversal did not preserve the exact original support domain/order.'), { code: 'ERR_FINITE_CAUSAL_INTEGRITY' });
  }
  return { indices, work: { strategy, constructionMs: builtAt - began, traversalMs: performance.now() - builtAt,
    occurrenceWork: page.consumedWork, originalAssignments: count } };
};
