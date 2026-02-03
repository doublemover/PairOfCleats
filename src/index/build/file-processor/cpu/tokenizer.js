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
      commentRanges.push(comment);
      const commentTokens = buildTokenSequence({
        text: comment.text,
        mode: 'prose',
        ext,
        dictWords: tokenDictWords,
        dictConfig,
        includeSeq: false
      }).tokens;
      if (commentTokens.length < normalizedCommentsConfig.minTokens) continue;
      const entry = { ...comment, tokens: commentTokens };
      commentEntries.push(entry);
      if (
        commentSegmentsEnabled
        && (comment.type !== 'license' || normalizedCommentsConfig.includeLicense)
      ) {
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
