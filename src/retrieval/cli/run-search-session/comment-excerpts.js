/**
 * Convert optional numeric payload fields (for example comment spans) into a
 * finite number or `null` when the value is not usable.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
const normalizeFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Build the dedupe/join key used to align extracted comment spans with code hit
 * comment references.
 *
 * @param {string} file
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
const buildCommentLookupKey = (file, start, end) => JSON.stringify([file, start, end]);

// Metadata arrays belong to immutable admitted generations. Weak ownership does
// not retain old indexes after a generation replacement.
const generationLookups = new WeakMap();

export const needsCommentExcerpts = (hits) => Array.isArray(hits) && hits.some(hit => (
  hit?.file && !hit.docmeta?.commentExcerpts && !hit.docmeta?.commentExcerpt
  && Array.isArray(hit.docmeta?.commentRefs) && hit.docmeta.commentRefs.length > 0
));

/**
 * Build extracted-comment lookup data keyed by file/start/end.
 *
 * @param {{joinComments:boolean,extractedChunkMeta?:any[]|null}} input
 * @returns {Map<string, any[]>|null}
 */
export const buildCommentLookup = ({ joinComments, extractedChunkMeta }) => {
  if (!joinComments || !Array.isArray(extractedChunkMeta) || !extractedChunkMeta.length) return null;
  if (generationLookups.has(extractedChunkMeta)) return generationLookups.get(extractedChunkMeta);
  const lookup = new Map();
  for (const chunk of extractedChunkMeta) {
    if (!chunk?.file) continue;
    const comments = chunk.docmeta?.comments;
    if (!Array.isArray(comments) || !comments.length) continue;
    for (const comment of comments) {
      if (!comment?.text) continue;
      const start = normalizeFiniteNumber(comment.start);
      const end = normalizeFiniteNumber(comment.end);
      if (start === null || end === null) continue;
      const key = buildCommentLookupKey(chunk.file, start, end);
      const matches = lookup.get(key);
      if (matches) {
        matches.push({ ...comment });
      } else {
        lookup.set(key, [{ ...comment }]);
      }
    }
  }
  const result = lookup.size ? lookup : null;
  generationLookups.set(extractedChunkMeta, result);
  return result;
};

/**
 * Enrich code hits with unique extracted comment excerpts.
 *
 * @param {{hits:any[]|null|undefined,commentLookup:Map<string, any[]>|null,maxExcerpts?:number}} input
 * @returns {void}
 */
export const attachCommentExcerpts = ({ hits, commentLookup, maxExcerpts = 3 }) => {
  if (!commentLookup || !Array.isArray(hits) || !hits.length) return;
  const excerptLimit = Number.isFinite(maxExcerpts)
    ? Math.max(1, Math.floor(maxExcerpts))
    : 3;
  for (const hit of hits) {
    if (!hit?.file) continue;
    const docmeta = hit.docmeta && typeof hit.docmeta === 'object' ? hit.docmeta : {};
    if (docmeta.commentExcerpts || docmeta.commentExcerpt) continue;
    const refs = docmeta.commentRefs;
    if (!Array.isArray(refs) || !refs.length) continue;
    const excerpts = [];
    const seen = new Set();
    for (const ref of refs) {
      const start = normalizeFiniteNumber(ref?.start);
      const end = normalizeFiniteNumber(ref?.end);
      if (start === null || end === null) continue;
      const matches = commentLookup.get(buildCommentLookupKey(hit.file, start, end));
      if (!matches?.length) continue;
      for (const match of matches) {
        if (!match?.text) continue;
        const dedupeKey = `${start}:${end}:${match.text}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        excerpts.push({
          type: ref?.type || match.type || null,
          style: ref?.style || match.style || null,
          languageId: ref?.languageId || match.languageId || null,
          start,
          end,
          startLine: ref?.startLine ?? match.startLine ?? null,
          endLine: ref?.endLine ?? match.endLine ?? null,
          text: match.text,
          truncated: match.truncated || false,
          indexed: match.indexed !== false
        });
        if (excerpts.length >= excerptLimit) break;
      }
      if (excerpts.length >= excerptLimit) break;
    }
    if (!excerpts.length) continue;
    hit.docmeta = {
      ...docmeta,
      commentExcerpts: excerpts,
      commentExcerpt: excerpts[0]?.text || null
    };
  }
};
