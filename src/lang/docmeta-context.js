/**
 * Find the best metadata-rich context chunk for a target chunk.
 *
 * Candidates can match by exact name or by source-range overlap. Exact-name
 * matches outrank overlap-only matches, then closest start/end offsets win.
 *
 * @param {{start?:number,end?:number,name?:string}|null} chunk
 * @param {Array<object>} candidates
 * @returns {object|null}
 */
export function findBestDocMetaContextChunk(chunk, candidates) {
  if (!chunk || !Array.isArray(candidates)) return null;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const sameName = chunk.name && candidate.name && chunk.name === candidate.name;
    const overlaps = Number.isFinite(chunk.start)
      && Number.isFinite(chunk.end)
      && Number.isFinite(candidate.start)
      && Number.isFinite(candidate.end)
      && candidate.start < chunk.end
      && chunk.start < candidate.end;
    if (!sameName && !overlaps) continue;
    const startDiff = Number.isFinite(chunk.start) && Number.isFinite(candidate.start)
      ? Math.abs(chunk.start - candidate.start)
      : 0;
    const endDiff = Number.isFinite(chunk.end) && Number.isFinite(candidate.end)
      ? Math.abs(chunk.end - candidate.end)
      : 0;
    const score = (sameName ? 0 : 10_000) + startDiff + endDiff;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Read a context chunk list by key and find the best target match.
 * @param {{start?:number,end?:number,name?:string}|null} chunk
 * @param {object|null} context
 * @param {string} key
 * @returns {object|null}
 */
export function findBestDocMetaContextChunkByKey(chunk, context, key) {
  if (!context || !key) return null;
  return findBestDocMetaContextChunk(chunk, context[key]);
}
