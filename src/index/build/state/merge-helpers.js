import { appendDocIdToPostingsMap, iteratePostingDocIds } from './postings-helpers.js';

export const mergeLengthsWithOffset = (dest, src, offset) => {
  if (!Array.isArray(src)) return;
  for (let i = 0; i < src.length; i += 1) {
    dest[offset + i] = src[i];
  }
};

export const mergeFrequencyPostingsMapWithOffset = (targetMap, sourceMap, offset) => {
  if (!sourceMap || typeof sourceMap.entries !== 'function') return;
  for (const [token, postings] of sourceMap.entries()) {
    let dest = targetMap.get(token);
    if (!dest) {
      dest = [];
      targetMap.set(token, dest);
    }
    for (const entry of postings || []) {
      const docId = Array.isArray(entry) ? entry[0] : null;
      const tf = Array.isArray(entry) ? entry[1] : null;
      if (!Number.isFinite(docId)) continue;
      dest.push([docId + offset, tf]);
    }
  }
};

export const mergeCompactPostingsMapWithOffset = (targetMap, sourceMap, offset) => {
  if (!sourceMap || typeof sourceMap.entries !== 'function') return;
  for (const [token, posting] of sourceMap.entries()) {
    for (const docId of iteratePostingDocIds(posting)) {
      if (!Number.isFinite(docId)) continue;
      appendDocIdToPostingsMap(targetMap, token, docId + offset);
    }
  }
};
