import { canonicalSemanticJson } from '../index/semantic/identity.js';
const key = canonicalSemanticJson;
/** Balance invocation crossings so one caller cannot leave through another call site. */
export const advanceTraceContext = (stack, edge, direction, maxDepth = 16) => {
  if (!edge.callSite || !['argumentToParameter', 'returnToResult'].includes(edge.kind)) return { stack };
  const site = key({ site: edge.callSite, contextKey: edge.contextKey });
  const entering = direction === 'downstream' ? edge.kind === 'argumentToParameter' : edge.kind === 'returnToResult';
  if (entering) {
    if (stack.length >= maxDepth) return { frontier: 'call_context_budget' };
    return { stack: [...stack, site] };
  }
  if (!stack.length) return { stack };
  if (stack.at(-1) !== site) return { skip: true };
  return { stack: stack.slice(0, -1) };
};
