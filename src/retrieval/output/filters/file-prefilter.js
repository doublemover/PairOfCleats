import { tri } from '../../../shared/tokenize.js';
import { extractRegexLiteral } from './candidates.js';

export const collectFilePrefilterMatches = ({
  fileMatchers,
  fileChargramN,
  filterIndex,
  normalizeFilePrefilter,
  intersectTwoSets,
  buildCandidate
}) => {
  if (!fileMatchers.length || !filterIndex || !filterIndex.fileChargrams || !filterIndex.fileChunksById) {
    return null;
  }
  const fileIds = new Set();
  for (const matcher of fileMatchers) {
    let needle = null;
    if (matcher.type === 'substring') {
      needle = normalizeFilePrefilter(matcher.value);
    } else if (matcher.type === 'regex') {
      const literal = extractRegexLiteral(matcher.value.source || '');
      needle = literal ? normalizeFilePrefilter(literal) : null;
    }
    if (!needle || needle.length < fileChargramN) continue;
    const grams = tri(needle, fileChargramN);
    if (!grams.length) continue;
    let candidateFiles = null;
    for (const gram of grams) {
      const bucket = filterIndex.fileChargrams.get(gram);
      if (!bucket) {
        candidateFiles = new Set();
        break;
      }
      candidateFiles = candidateFiles ? intersectTwoSets(candidateFiles, bucket) : new Set(bucket);
      if (!candidateFiles.size) break;
    }
    if (!candidateFiles || !candidateFiles.size) continue;
    for (const fileId of candidateFiles) {
      fileIds.add(fileId);
    }
  }
  if (!fileIds.size) return null;
  const chunkSets = [];
  const chunkBitmaps = [];
  const fileChunkBitmaps = filterIndex?.bitmap?.fileChunksById || null;
  for (const fileId of fileIds) {
    const chunks = filterIndex.fileChunksById[fileId];
    if (!chunks) continue;
    const bitmap = Array.isArray(fileChunkBitmaps) ? fileChunkBitmaps[fileId] : null;
    if (bitmap) {
      chunkBitmaps.push(bitmap);
    } else {
      chunkSets.push(chunks);
    }
  }
  if (!chunkSets.length && !chunkBitmaps.length) return null;
  if (typeof buildCandidate === 'function') {
    return buildCandidate(chunkSets, chunkBitmaps);
  }
  const chunkIds = new Set();
  for (const set of chunkSets) {
    for (const id of set) chunkIds.add(id);
  }
  for (const bitmap of chunkBitmaps) {
    for (const id of bitmap) chunkIds.add(id);
  }
  return chunkIds;
};
