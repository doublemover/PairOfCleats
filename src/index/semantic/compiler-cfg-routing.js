import { throwIfAborted } from '../../shared/abort.js';

/** Memoize ordered suffix projections only on acyclic regions. Cyclic or dense
 * regions use the reference traversal under the same shared work budget. Arrays
 * are shared down no-op chains, never a full block-by-block transitive closure. */
export const createCfgRoutingLookup = ({ successors, select, barrier = () => false,
  spend = () => true, signal = null, maxCacheMemberships = 65536 }) => {
  const cache = new Map(); let memberships = 0;
  const load = root => {
    if (cache.has(root)) return cache.get(root);
    const active = new Set([root]), stack = [{ node: root, index: 0, children: null, failed: false }];
    while (stack.length) {
      throwIfAborted(signal);
      const frame = stack[stack.length - 1];
      if (!frame.children) {
        if (!spend()) { for (const pending of stack) cache.set(pending.node, null); return null; }
        frame.children = barrier(frame.node) ? [] : [...successors(frame.node)].reverse();
      }
      if (frame.index < frame.children.length) {
        const child = frame.children[frame.index];
        if (active.has(child)) { frame.failed = true; frame.index++; continue; }
        if (cache.has(child)) { if (cache.get(child) === null) frame.failed = true; frame.index++; continue; }
        active.add(child); stack.push({ node: child, index: 0, children: null, failed: false }); continue;
      }
      let result = null;
      if (!frame.failed) {
        const selected = select(frame.node);
        const childArrays = frame.children.map(child => cache.get(child));
        if (!selected && (!childArrays.length || childArrays.every(values => values === childArrays[0]))) result = childArrays[0] || [];
        else {
          const seen = new Set(), values = [];
          if (selected) { seen.add(frame.node); values.push(frame.node); }
          for (const child of childArrays) for (const value of child) {
            if (!spend()) { frame.failed = true; break; }
            if (!seen.has(value)) { seen.add(value); values.push(value); }
          }
          if (!frame.failed && memberships + values.length <= maxCacheMemberships) { result = values; memberships += values.length; }
        }
      }
      cache.set(frame.node, result); active.delete(frame.node); stack.pop();
    }
    return cache.get(root);
  };
  return {
    query(starts) {
      const ordered = [...starts].reverse(), arrays = ordered.map(load);
      if (arrays.every(values => values !== null)) {
        const seen = new Set(), result = [];
        for (const values of arrays) for (const value of values) {
          if (!spend()) return result;
          if (!seen.has(value)) { seen.add(value); result.push(value); }
        }
        return result;
      }
      const seen = new Set(), pending = [...starts], result = [];
      while (pending.length) {
        throwIfAborted(signal);
        if (!spend()) break;
        const current = pending.pop(); if (seen.has(current)) continue; seen.add(current);
        if (select(current)) result.push(current);
        if (!barrier(current)) for (const next of successors(current)) pending.push(next);
      }
      return result;
    },
    stats: () => ({ entries: cache.size, memberships, maxCacheMemberships })
  };
};
