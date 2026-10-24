import { throwIfAborted } from '../../shared/abort.js';

/** Conservative scheduling edges for the existing solver's write channels.
 * This graph never adds a value-flow edge or authorizes persisted reuse.
 */
const inputRefs = function* (call) {
  yield call.receiver;
  yield* call.arguments || [];
  yield* call.unknownInputs || [];
};
const destinationRefs = function* (call) {
  if (!call.suppressResult) yield call.result;
  yield* call.effectRoutes?.exceptionTargets || [];
  for (const read of call.effectRoutes?.reads || []) yield read.ref;
};
const rootRefs = function* (summary) {
  yield* summary.returns || [];
  yield* summary.exceptions || [];
  for (const effect of summary.effects || []) yield effect.ref;
  for (const call of summary.calls) yield* inputRefs(call);
};
export const indexSummaryInformationDependencies = ({ functions, calls, reverse, graph, key,
  spend, signal }) => {
  const writers = new Map();
  let visits = 0, edges = 0;
  const consume = () => { throwIfAborted(signal); visits++; return spend(); };
  for (const call of calls) {
    if (!consume()) return { complete: false, visits, edges };
    if (!call.ownerId || !functions.has(call.ownerId)) continue;
    for (const destination of destinationRefs(call)) {
      if (!consume()) return { complete: false, visits, edges };
      if (!destination) continue;
      const id = key(destination);
      if (!writers.has(id)) writers.set(id, new Set());
      writers.get(id).add(call);
    }
  }
  for (const [ownerId, summary] of functions) {
    const pending = [];
    for (const root of rootRefs(summary)) {
      if (!consume()) return { complete: false, visits, edges };
      if (root) pending.push(key(root));
    }
    const seen = new Set(), activated = new Set();
    while (pending.length) {
      if (!consume()) return { complete: false, visits, edges };
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      for (const previous of reverse.get(current) || []) {
        if (!consume()) return { complete: false, visits, edges };
        pending.push(previous);
      }
      for (const call of writers.get(current) || []) {
        if (!consume()) return { complete: false, visits, edges };
        if (activated.has(call)) continue;
        activated.add(call);
        const dependencies = graph.get(ownerId);
        if (!dependencies.has(call.ownerId)) { dependencies.add(call.ownerId); edges++; }
        // Any parameter/receiver can contribute to these existing may channels.
        // Walking this conservative closure discovers dependencies before the
        // first contribution appears, including an initially empty lookup.
        for (const input of inputRefs(call)) {
          if (!consume()) return { complete: false, visits, edges };
          if (input) pending.push(key(input));
        }
      }
    }
  }
  return { complete: true, visits, edges };
};
