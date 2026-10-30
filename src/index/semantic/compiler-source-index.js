import path from 'node:path';
import { createHash } from 'node:crypto';

const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const mismatch = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
const segmentKey = (container, uid, start, end, hash) => JSON.stringify([container, uid, start, end, hash]);

/** Build-owned indexes. Hashes select candidates; retained text/range/parent and
 * explicit source identity still decide the match. No first-match collision rule.
 */
export const createCompilerSourceIndex = ({ root, inventory, factsBySource, texts }) => {
  const bySource = new Map(), bySegment = new Map(), docHashes = new WeakMap(), segmentKeys = new WeakMap();
  const stats = { lookups: 0, candidates: 0, documentTextHashes: 0 };
  for (const item of inventory.values()) {
    if (bySource.has(item.source.sourceUnitId)) throw mismatch('Ambiguous compiler source identity.');
    bySource.set(item.source.sourceUnitId, item);
    if (!item.sourceMap) continue;
    const parent = factsBySource.get(item.source.mapping.parentSourceUnitId);
    if (!parent) throw mismatch('Compiler embedded parent missing.');
    const map = item.sourceMap;
    const key = segmentKey(keyPath(path.join(root, parent[0])), map.segmentUid, map.parentStart, map.parentEnd, item.source.textHash);
    segmentKeys.set(item, key);
    if (!bySegment.has(key)) bySegment.set(key, []);
    bySegment.get(key).push(item);
  }
  const textHash = doc => {
    const previous = docHashes.get(doc);
    if (previous?.text === doc.text) return previous.hash;
    const hash = createHash('sha256').update(doc.text, 'utf8').digest('hex');
    stats.documentTextHashes++;
    docHashes.set(doc, { text: doc.text, hash }); return hash;
  };
  const sourceForDoc = doc => {
    stats.lookups++;
    const container = keyPath(path.resolve(root, doc.containerPath || doc.virtualPath));
    if (!doc.segmentUid) {
      const item = doc.semanticSourceUnitId ? bySource.get(doc.semanticSourceUnitId) : inventory.get(container);
      if (!item || item.source.mapping || container !== keyPath(path.join(root, item.source.path))) return undefined;
      stats.candidates++;
      return typeof doc.text !== 'string' || texts.get(item.source.path) === doc.text ? item : undefined;
    }
    if (typeof doc.text !== 'string') return undefined;
    const key = segmentKey(container, doc.segmentUid, doc.segmentRange?.start, doc.segmentRange?.end, textHash(doc));
    const direct = doc.semanticSourceUnitId ? bySource.get(doc.semanticSourceUnitId) : null;
    const candidates = doc.semanticSourceUnitId ? direct && segmentKeys.get(direct) === key ? [direct] : [] : bySegment.get(key) || [];
    let found;
    for (const item of candidates) {
      stats.candidates++;
      if (item.sourceMap.localEnd !== doc.text.length || texts.get(item.source.path) !== doc.text
        || doc.semanticSourceUnitId && doc.semanticSourceUnitId !== item.source.sourceUnitId) continue;
      if (found) throw mismatch('Ambiguous compiler embedded source.');
      found = item;
    }
    return found;
  };
  return Object.freeze({ sourceForDoc, snapshot: () => Object.freeze({ ...stats, sources: bySource.size, segmentBuckets: bySegment.size }) });
};
