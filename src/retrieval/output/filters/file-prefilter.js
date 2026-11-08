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
    } else {
      // File matchers are OR-ed. An unprovable regex branch requires the full
      // candidate superset, even when another branch has usable grams.
      return null;
    }
    if (!needle || !Number.isSafeInteger(fileChargramN) || needle.length < fileChargramN) return null;
    const grams = [];
    for (let offset = 0; offset <= needle.length - fileChargramN; offset++) {
      grams.push(needle.slice(offset, offset + fileChargramN));
    }
    const buckets = [...new Set(grams)].map(gram => filterIndex.fileChargrams.get(gram));
    if (buckets.some(bucket => !bucket || !bucket.size)) continue;
    buckets.sort((a, b) => a.size - b.size);
    let candidateFiles = null;
    for (const bucket of buckets) {
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
