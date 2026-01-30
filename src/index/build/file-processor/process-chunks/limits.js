import { buildTokenSequence } from '../../tokenization.js';
import { truncateByBytes } from '../read.js';

export const collectChunkComments = ({
  assigned,
  assignedRanges,
  chunkMode,
  normalizedCommentsConfig,
  tokenDictWords,
  dictConfig,
  effectiveExt,
  chunkStart
}) => {
  const commentFieldTokens = [];
  let docmetaPatch = null;
  if (!assigned.length) {
    return { commentFieldTokens, docmetaPatch, assignedRanges };
  }
  const sorted = assigned.slice().sort((a, b) => (
    Math.abs(a.start - chunkStart) - Math.abs(b.start - chunkStart)
  ));
  const maxPerChunk = normalizedCommentsConfig.maxPerChunk;
  const maxBytes = normalizedCommentsConfig.maxBytesPerChunk;
  let totalBytes = 0;
  const metaComments = [];
  const commentRefs = [];
  for (const comment of sorted) {
    if (maxPerChunk && commentRefs.length >= maxPerChunk) break;
    const ref = {
      type: comment.type,
      style: comment.style,
      languageId: comment.languageId || null,
      start: comment.start,
      end: comment.end,
      startLine: comment.startLine,
      endLine: comment.endLine
    };
    commentRefs.push(ref);
    if (chunkMode === 'code') continue;

    const remaining = maxBytes ? Math.max(0, maxBytes - totalBytes) : 0;
    if (maxBytes && remaining <= 0) break;
    const clipped = maxBytes ? truncateByBytes(comment.text, remaining) : {
      text: comment.text,
      truncated: false,
      bytes: Buffer.byteLength(comment.text, 'utf8')
    };
    if (!clipped.text) continue;
    totalBytes += clipped.bytes;
    const includeInTokens = comment.type === 'inline'
      || comment.type === 'block'
      || (comment.type === 'license' && normalizedCommentsConfig.includeLicense);
    if (includeInTokens) {
      const tokens = buildTokenSequence({
        text: clipped.text,
        mode: 'prose',
        ext: effectiveExt,
        dictWords: tokenDictWords,
        dictConfig
      }).tokens;
      if (tokens.length) {
        for (const token of tokens) commentFieldTokens.push(token);
      }
    }
    metaComments.push({
      ...ref,
      text: clipped.text,
      truncated: clipped.truncated || false,
      indexed: includeInTokens,
      anchorChunkId: null
    });
  }
  if (chunkMode === 'code') {
    if (commentRefs.length) {
      docmetaPatch = { commentRefs };
    }
  } else if (metaComments.length) {
    docmetaPatch = { comments: metaComments };
  }
  return { commentFieldTokens, docmetaPatch, assignedRanges };
};
