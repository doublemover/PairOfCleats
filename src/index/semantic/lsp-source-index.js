import path from 'node:path';
import { semanticHash } from './identity.js';

/** Immutable session inventory; all authority/text checks remain with the caller. */
export const createLspSourceIndex = ({ inventory, parentSources = new Map(), repoRoot, platform = process.platform }) => {
  const keyPath = file => {
    const absolute = path.resolve(file);
    return platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  const byPath = new Map(), embedded = new Map(), declarationIndexes = new WeakMap();
  const ambiguous = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const stats = { inventoryDigests: 1, sourceLookups: 0, declarationNodesVisited: 0 };
  const segmentKey = (container, uid, range) => JSON.stringify([keyPath(container), uid, range?.start, range?.end]);
  for (const item of inventory.values()) {
    if (!item.source.mapping) {
      const key = keyPath(path.join(repoRoot, item.source.path));
      if (byPath.has(key) && byPath.get(key) !== item) throw ambiguous('Multiple retained LSP source identities occupy the same canonical path.');
      byPath.set(key, item);
    } else {
      const parent = inventory.get(item.source.mapping.parentSourceUnitId)?.source
        || parentSources.get(item.source.mapping.parentSourceUnitId);
      if (!parent) continue;
      const key = segmentKey(path.join(repoRoot, parent.path), item.sourceMap?.segmentUid,
        { start: item.sourceMap?.parentStart, end: item.sourceMap?.parentEnd });
      if (!embedded.has(key)) embedded.set(key, []);
      embedded.get(key).push(item);
    }
  }
  const digest = semanticHash('semantic.lsp-sources.v1', [...inventory.values()]
    .map(item => ({ sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash }))
    .sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId)));
  const containingDeclarations = (item, span) => {
    if (!item || !span) return [];
    let tree = declarationIndexes.get(item);
    if (!tree) {
      const declarations = item.declarations.map((value, ordinal) => ({ value, ordinal }))
        .sort((a, b) => a.value.span[0] - b.value.span[0] || a.ordinal - b.ordinal);
      const build = (start, end) => {
        if (start >= end) return null;
        const mid = (start + end) >>> 1, entry = declarations[mid];
        const left = build(start, mid), right = build(mid + 1, end);
        return { ...entry, left, right, maxEnd: Math.max(entry.value.span[1], left?.maxEnd ?? -1, right?.maxEnd ?? -1) };
      };
      tree = { root: build(0, declarations.length) }; declarationIndexes.set(item, tree);
    }
    const found = [], pending = tree.root ? [tree.root] : [];
    while (pending.length && found.length < 2) {
      const node = pending.pop(); stats.declarationNodesVisited++;
      if (node.maxEnd < span[1]) continue;
      const declaration = node.value;
      if (declaration.span[0] <= span[0] && declaration.span[1] >= span[1]) found.push(node);
      if (node.left?.maxEnd >= span[1]) pending.push(node.left);
      if (node.right && declaration.span[0] <= span[0] && node.right.maxEnd >= span[1]) pending.push(node.right);
    }
    return found.sort((a, b) => a.ordinal - b.ordinal).map(node => node.value);
  };
  return {
    digest, stats, containingDeclarations,
    itemForPath(file) { stats.sourceLookups++; return byPath.get(keyPath(file)); },
    itemForDocument(doc) {
      stats.sourceLookups++;
      const container = path.resolve(repoRoot, doc.containerPath || doc.virtualPath);
      if (doc.semanticSourceUnitId && !doc.segmentUid) {
        const item = inventory.get(doc.semanticSourceUnitId);
        return item && !item.source.mapping && keyPath(container) === keyPath(path.join(repoRoot, item.source.path))
          && (typeof doc.text !== 'string' || doc.text === item.text) ? item : undefined;
      }
      if (!doc.segmentUid) return byPath.get(keyPath(container));
      const candidates = (embedded.get(segmentKey(container, doc.segmentUid, doc.segmentRange)) || [])
        .filter(item => item.text === doc.text && (!doc.semanticSourceUnitId || item.source.sourceUnitId === doc.semanticSourceUnitId));
      if (candidates.length > 1) throw ambiguous('LSP embedded document has multiple retained source identities.');
      return candidates[0];
    }
  };
};
