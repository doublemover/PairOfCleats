import { detectFrontmatter } from '../../../segments.js';
import { extractComments } from '../../../comments.js';
import { tokenizeComments } from './tokenizer.js';

export const buildCommentMeta = ({
  text,
  ext,
  mode,
  languageId,
  lineIndex,
  normalizedCommentsConfig,
  tokenDictWords,
  dictConfig
}) => {
  const commentsEnabled = (mode === 'code' || mode === 'extracted-prose')
    && normalizedCommentsConfig.extract !== 'off';
  const commentSegmentsEnabled = mode === 'extracted-prose'
    || (mode === 'code' && normalizedCommentsConfig.includeInCode === true);
  const commentData = commentsEnabled
    ? extractComments({
      text,
      ext,
      languageId: languageId || null,
      lineIndex,
      config: normalizedCommentsConfig
    })
    : { comments: [], configSegments: [] };
  const {
    commentEntries,
    commentRanges,
    commentSegments
  } = tokenizeComments({
    comments: commentData.comments,
    ext,
    tokenDictWords,
    dictConfig,
    normalizedCommentsConfig,
    languageId,
    commentSegmentsEnabled
  });
  const extraSegments = [];
  if (commentSegmentsEnabled && commentSegments.length) {
    extraSegments.push(...commentSegments);
  }
  if (
    commentSegmentsEnabled
    && Array.isArray(commentData.configSegments)
    && commentData.configSegments.length
  ) {
    extraSegments.push(...commentData.configSegments);
  }
  if (mode === 'extracted-prose' && (ext === '.md' || ext === '.mdx')) {
    const frontmatter = detectFrontmatter(text);
    if (frontmatter) {
      extraSegments.push({
        type: 'prose',
        languageId: 'markdown',
        start: frontmatter.start,
        end: frontmatter.end,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: { frontmatter: true }
      });
    }
  }

  return {
    commentEntries,
    commentRanges,
    extraSegments,
    commentsEnabled,
    commentSegmentsEnabled
  };
};
