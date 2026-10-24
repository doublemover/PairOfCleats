import { throwIfAborted } from '../../shared/abort.js';

/** Track source return origins through suspended finally completions. A local
 * catch/loop consumes only its own abrupt completion; leaving a finalizer drops
 * the suspended entries it actually escapes. No runtime value is evaluated. */
export const collectCompilerCompletions = ({ graph, maxBytes, maxWork, signal }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxWork) || maxWork < 0) {
    throw new TypeError('Compiler completion byte/work allowances are required.');
  }
  const returns = new Set(), visited = new Set(), pending = [];
  let bytes = 0, work = 0, complete = true, normalExit = false;
  const admit = (block, origin, suspended) => {
    if (!complete) return;
    if (++work > maxWork) { complete = false; return; }
    const depth = block.finalizerDepth;
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > suspended.length) { complete = false; return; }
    // Bound key and frame creation before copying or encoding the stack. Keys
    // are the CFG owner's bounded decimal sequence, not caller source strings.
    const estimate = 256 + (depth + 2) * 24;
    if (estimate > maxBytes - bytes) { complete = false; return; }
    if (depth < suspended.length) suspended = suspended.slice(0, depth);
    const key = block.key + ':' + (origin?.key || '-') + ':' + suspended.map(value => value?.key || '-').join(',');
    if (visited.has(key)) return;
    visited.add(key); bytes += estimate;
    pending.push({ block, origin, suspended });
  };
  admit(graph.entry, null, []);
  while (pending.length && complete) {
    throwIfAborted(signal);
    const frame = pending.pop(), { block } = frame;
    let { origin, suspended } = frame;
    if (block === graph.returnExit) { if (origin) returns.add(origin); else complete = false; continue; }
    if (block === graph.exit) { if (!origin) normalExit = true; else complete = false; continue; }
    if (block === graph.exception) continue;
    const kind = block.event?.kind;
    if (kind === 'return') origin = block;
    else if (['throw', 'catch', 'abrupt'].includes(kind)) origin = null;
    else if (kind === 'suspendCompletion') { suspended = [...suspended, origin]; origin = null; }
    else if (kind === 'resumeCompletion') {
      if (!suspended.length) { complete = false; break; }
      origin = suspended.at(-1); suspended = suspended.slice(0, -1);
    }
    for (const edge of block.successors) admit(edge.to, edge.kind === 'exceptional' ? null : origin, suspended);
  }
  return { returns, normalExit, complete, stats: { work, admittedBytes: bytes, states: visited.size } };
};
