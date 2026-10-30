import { JSON_REFERENCE_KEYS, JSON_REFERENCE_NODE_LIMIT, JSON_REFERENCE_VALUE_DEPTH } from '../../../shared/json-reference-policy.js';
import { addBudgetedCollectorImport } from './utils.js';

const referenceKeys = new Set(JSON_REFERENCE_KEYS);
export const JSON_TRAVERSAL_LIMITS = Object.freeze({ nodes: JSON_REFERENCE_NODE_LIMIT, frames: JSON_REFERENCE_NODE_LIMIT });
function* children(value) {
  if (Array.isArray(value)) { for (let index = 0; index < value.length; index++) yield { value: value[index], reference: false }; }
  else for (const key in value) if (Object.hasOwn(value, key)) yield { value: value[key], reference: referenceKeys.has(key.toLowerCase()) };
}

/** One preorder walk; nested reference keys restart the same existing value-depth
 * policy. Frames own cursors, never whole-width child arrays or consumed queues.
 */
export const traverseJsonReferences = (value, imports, scanBudget, { nodes, frames } = JSON_TRAVERSAL_LIMITS,
  cancelled = () => false) => {
  const stack = [], stats = { visitedNodes: 0, peakFrames: 0, observedReferences: 0, invalidReferences: 0, duplicateReferences: 0, reason: null };
  const admit = (value, remaining) => {
    if (stats.visitedNodes >= nodes) { stats.reason = 'node-limit'; return false; }
    if (value && typeof value === 'object' && stack.length >= frames) { stats.reason = 'depth-limit'; return false; }
    stats.visitedNodes++;
    if (typeof value === 'string') {
      if (remaining !== null && remaining >= 0) {
        stats.observedReferences++;
        if (scanBudget.consumeMatch()) {
          const before = imports.size, accepted = addBudgetedCollectorImport(imports, value, scanBudget, { literal: true });
          if (accepted && imports.size === before) stats.duplicateReferences++;
          else if (!accepted && !scanBudget.exhausted) stats.invalidReferences++;
        }
      }
    } else if (value && typeof value === 'object') {
      stack.push({ iterator: children(value), remaining }); stats.peakFrames = Math.max(stats.peakFrames, stack.length);
    }
    return true;
  };
  if (!cancelled() && !scanBudget.exhausted) admit(value, null);
  while (stack.length && !scanBudget.exhausted && !cancelled()) {
    if (!scanBudget.consumeTime()) break;
    const frame = stack.at(-1), next = frame.iterator.next();
    if (next.done) { stack.pop(); continue; }
    const remaining = next.value.reference ? JSON_REFERENCE_VALUE_DEPTH
      : frame.remaining === null || frame.remaining <= 0 ? null : frame.remaining - 1;
    if (!admit(next.value.value, remaining)) break;
  }
  if (cancelled()) stats.reason = 'cancelled';
  const complete = stack.length === 0 && !stats.reason && !scanBudget.exhausted;
  stack.length = 0;
  return { ...stats, complete };
};
