import { bitmapHas, bitmapToArray, getBitmapSize } from '../bitmap.js';
import { createVocabIndex } from '../vocab-index.js';
import { SCORING_ANALYZER_VERSION } from '../../shared/tokenize-identifiers.js';
import { hasAdmittedPostingOrder, hasCompletePostingVocabulary } from '../../shared/posting-order.js';

const explicitBoolean = node => !!node && (node.grouped || node.type === 'or'
  || node.type === 'and' && node.implicit !== true || explicitBoolean(node.left)
  || explicitBoolean(node.right) || explicitBoolean(node.child));
const intersect = (left, right) => {
  if (left == null) return right;
  if (right == null) return left;
  const small = left.size <= right.size ? left : right, large = small === left ? right : left;
  return new Set([...small].filter(id => large.has(id)));
};

/** Request-owned conservative posting domains followed by the exact existing predicate. */
export const createEligibilityPlan = ({ idx, meta = idx.chunkMeta || [], mode, queryAst, allowedIdx = null, matchesQueryAst,
  throwIfAborted = null }) => {
  const allowSemanticTerms = !explicitBoolean(queryAst);
  const cache = new Map();
  const statistics = { evaluations: 0, metadataVisited: 0, metadataHydrated: 0, postingRows: 0,
    plans: [] };
  let orderedAllowed = null;
  const prepareAllowed = () => orderedAllowed ||= bitmapToArray(allowedIdx)
    .filter(id => Number.isSafeInteger(id) && id >= 0 && id < meta.length).sort((a, b) => a - b);
  const universe = function* () {
    if (allowedIdx) {
      const ids = allowedIdx instanceof Set ? allowedIdx : bitmapToArray(allowedIdx);
      for (const id of ids) if (Number.isSafeInteger(id) && id >= 0 && id < meta.length) yield id;
    } else for (let id = 0; id < meta.length; id++) yield id;
  };
  const compile = (node, tokenIndex, relaxTerms) => {
    if (!node) return { ids: null, exact: true };
    if (node.type === 'term') {
      if (relaxTerms) return { ids: null, exact: true };
      if (!node.tokens?.length) return { ids: new Set(), exact: true };
      if (idx.state?.features?.scoringAnalyzer !== SCORING_ANALYZER_VERSION
        || !Array.isArray(tokenIndex?.vocab) || !Array.isArray(tokenIndex?.postings)) return { ids: null, exact: false };
      const vocab = tokenIndex.vocabIndex || (tokenIndex.vocabIndex = createVocabIndex(tokenIndex.vocab));
      const ids = new Set();
      for (const token of new Set(node.tokens)) {
        const key = vocab.get(token);
        if (key === undefined) {
          if (!hasCompletePostingVocabulary(tokenIndex)) return { ids: null, exact: false };
          continue;
        }
        const posting = tokenIndex.postings[key];
        if (!hasAdmittedPostingOrder(posting)) return { ids: null, exact: false };
        if (allowedIdx && getBitmapSize(allowedIdx) * Math.ceil(Math.log2(posting.length + 1)) < posting.length / 2) {
          for (const id of prepareAllowed()) {
            let low = 0, high = posting.length;
            while (low < high) {
              statistics.postingRows++;
              const middle = (low + high) >>> 1;
              if (posting[middle][0] < id) low = middle + 1;
              else high = middle;
            }
            if (low < posting.length && posting[low][0] === id) ids.add(id);
          }
        } else {
          for (const [id] of posting) {
            statistics.postingRows++;
            if (statistics.postingRows % 256 === 0) throwIfAborted?.();
            if (!allowedIdx || bitmapHas(allowedIdx, id)) ids.add(id);
          }
        }
      }
      return { ids, exact: true };
    }
    if (node.type === 'phrase') return { ids: null, exact: false };
    if (node.type === 'not') {
      const child = compile(node.child, tokenIndex, false);
      if (!child.exact) return { ids: null, exact: false };
      if (child.ids == null) return { ids: new Set(), exact: true };
      return { ids: new Set([...universe()].filter(id => !child.ids.has(id))), exact: true };
    }
    if (node.type === 'and' || node.type === 'or') {
      const left = compile(node.left, tokenIndex, relaxTerms), right = compile(node.right, tokenIndex, relaxTerms);
      return { ids: node.type === 'and' ? intersect(left.ids, right.ids)
        : left.ids == null || right.ids == null ? null : new Set([...left.ids, ...right.ids]),
      exact: left.exact && right.exact };
    }
    return { ids: null, exact: false };
  };
  const evaluate = ({ semantic = false, tokenIndex = idx.tokenIndex } = {}) => {
    const predicate = semantic && allowSemanticTerms;
    let byPredicate = cache.get(tokenIndex);
    if (!byPredicate) { byPredicate = new Map(); cache.set(tokenIndex, byPredicate); }
    if (byPredicate.has(predicate)) return byPredicate.get(predicate);
    statistics.evaluations++;
    const compiled = compile(queryAst, tokenIndex, predicate);
    const domain = compiled.ids == null ? universe() : compiled.ids;
    const selected = new Set();
    let batch = [];
    const verifyBatch = () => {
      if (!batch.length) return;
      throwIfAborted?.();
      const missing = batch.filter(id => !meta[id]);
      if (missing.length && typeof idx.loadChunkMetaByIds === 'function') {
        idx.loadChunkMetaByIds(mode, missing, meta);
        statistics.metadataHydrated += missing.length;
      }
      for (const id of batch) {
        const chunk = meta[id]; statistics.metadataVisited++;
        if (chunk && (!matchesQueryAst || matchesQueryAst(idx, id, chunk, semantic))) selected.add(id);
      }
      batch = [];
    };
    for (const id of domain) {
      if (allowedIdx && !bitmapHas(allowedIdx, id)) continue;
      batch.push(id);
      if (batch.length === 256) verifyBatch();
    }
    verifyBatch();
    statistics.plans.push({ semantic, domain: compiled.ids == null ? 'admitted-universe' : 'posting-superset',
      exactPostingDomain: compiled.exact, selected: selected.size, allowed: allowedIdx ? getBitmapSize(allowedIdx) : null });
    byPredicate.set(predicate, selected);
    return selected;
  };
  return { evaluate, statistics };
};
