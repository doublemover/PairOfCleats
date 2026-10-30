import { canonicalSemanticJson } from './identity.js';
const node = () => ({ children: new Map(), terminals: [] });
const key = segment => segment === null ? 'wildcard' : 'exact:' + canonicalSemanticJson(segment);
const privateSegment = segment => Boolean(segment && typeof segment === 'object');

/** Source/root-owned prefix index. Null is a widened public key, while branded
 * private segments participate only in exact canonical matches. Query results
 * retain original entry order, including duplicate paths. */
export const createPropertyPathOverlapIndex = (entries, { resolvePath = row => row.path, spend = () => true } = {}) => {
  const root = node(); let complete = true;
  for (let ordinal = 0; ordinal < entries.length; ordinal++) {
    const path = resolvePath(entries[ordinal]);
    if (!Array.isArray(path)) throw new TypeError('Field overlap index requires canonical path arrays.');
    const segments = path.map(segment => ({ key: key(segment), private: privateSegment(segment), wildcard: segment === null }));
    let current = root;
    for (const segment of segments) {
      if (!spend()) { complete = false; break; }
      if (!current.children.has(segment.key)) current.children.set(segment.key, { segment, node: node() });
      current = current.children.get(segment.key).node;
    }
    if (!complete || !spend()) { complete = false; break; }
    current.terminals.push(ordinal);
  }
  return {
    complete,
    query(path, { spend: querySpend = spend } = {}) {
      const segments = path.map(segment => ({ key: key(segment), private: privateSegment(segment), wildcard: segment === null }));
      const pending = [{ current: root, depth: 0 }], matches = []; let truncated = !complete;
      while (pending.length) {
        if (!querySpend()) { truncated = true; break; }
        const { current, depth } = pending.pop();
        for (const ordinal of current.terminals) {
          if (!querySpend()) { truncated = true; break; }
          matches.push(ordinal);
        }
        if (truncated) break;
        if (depth >= segments.length) {
          for (const child of current.children.values()) pending.push({ current: child.node, depth });
          continue;
        }
        const segment = segments[depth];
        if (segment.wildcard) {
          for (const child of current.children.values()) if (!child.segment.private) pending.push({ current: child.node, depth: depth + 1 });
        } else {
          const exact = current.children.get(segment.key); if (exact) pending.push({ current: exact.node, depth: depth + 1 });
          if (!segment.private) { const wildcard = current.children.get('wildcard'); if (wildcard) pending.push({ current: wildcard.node, depth: depth + 1 }); }
        }
      }
      matches.sort((left, right) => left - right);
      return { matches: matches.map(ordinal => entries[ordinal]), truncated };
    }
  };
};
