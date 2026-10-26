import { buildTokenSequence } from '../../tokenization.js';

export const tokenizeComments = ({
  comments,
  ext,
  tokenDictWords,
  dictConfig,
  normalizedCommentsConfig,
  languageId,
  commentSegmentsEnabled
}) => {
  const commentEntries = [];
  const commentRanges = [];
  const commentSegments = [];
  if (Array.isArray(comments)) {
    for (const comment of comments) {
      const commentTokens = buildTokenSequence({
        text: comment.text,
        mode: 'prose',
        ext,
        dictWords: tokenDictWords,
        dictConfig,
        includeSeq: false
      }).tokens;
      const enoughTokens = commentTokens.length >= normalizedCommentsConfig.minTokens;
      const includeLicense = comment.type !== 'license' || normalizedCommentsConfig.includeLicense;
      const proseAdmission = { included: Boolean(enoughTokens && commentSegmentsEnabled && includeLicense),
        reason: !includeLicense ? 'license-excluded' : !enoughTokens ? 'below-min-tokens'
          : !commentSegmentsEnabled ? 'comment-segments-disabled' : 'included' };
      const qualifiedComment = { ...comment, proseAdmission };
      commentRanges.push(qualifiedComment);
      if (!enoughTokens) continue;
      const entry = { ...qualifiedComment, tokens: commentTokens };
      commentEntries.push(entry);
      if (proseAdmission.included) {
        commentSegments.push({
          type: 'comment',
          languageId: languageId || null,
          start: comment.start,
          end: comment.end,
          parentSegmentId: null,
          embeddingContext: 'prose',
          meta: {
            commentType: comment.type,
            commentStyle: comment.style
          }
        });
      }
    }
  }
  return { commentEntries, commentRanges, commentSegments };
};
