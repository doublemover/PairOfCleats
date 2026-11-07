import { CONFIG_LANGS, normalizeFenceLanguage, normalizeSegmentsConfig } from './config.js';
import { detectFrontmatter } from './frontmatter.js';
import { finalizeSegments } from './finalize.js';
import { collectMarkdownSegments } from './markdown-content.js';
export const segmentMarkdown = ({ text, ext, relPath, segmentsConfig }) => {
  const config = normalizeSegmentsConfig(segmentsConfig);
  const segments = [];
  const frontmatter = detectFrontmatter(text);
  if (frontmatter) {
    // Parser input is the original contiguous interior, including its real EOLs.
    // Prose presentation still owns the broad delimiter-inclusive container.
    if (frontmatter.contentEnd > frontmatter.contentStart) {
      segments.push({
        type: 'config',
        languageId: frontmatter.languageId,
        start: frontmatter.contentStart,
        end: frontmatter.contentEnd,
        parentSegmentId: null,
        embeddingContext: 'config',
        meta: { frontmatter: true, containerStart: frontmatter.start, containerEnd: frontmatter.end,
          extractionPolicy: 'markdown-frontmatter-content-v1' }
      });
    }
    if (config.frontmatterProse) {
      segments.push({
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
  const { spans, blocks } = collectMarkdownSegments(text, config);
  const fencedBlocks = blocks;
  for (const block of fencedBlocks) {
    if (frontmatter && block.start < frontmatter.end) continue;
    const languageId = normalizeFenceLanguage(block.info);
    const embeddingContext = CONFIG_LANGS.has(languageId) ? 'config' : 'code';
    segments.push({
      type: 'embedded',
      languageId,
      start: block.start,
      end: block.end,
      parentSegmentId: null,
      embeddingContext,
      contentView: block.contentView,
      ...(block.contentUnavailable ? { contentUnavailable: block.contentUnavailable } : {}),
      meta: { fenceInfo: block.info || null, containerStart: block.containerStart,
        containerEnd: block.containerEnd, extractionPolicy: 'markdown-fenced-content-v1' }
    });
  }
  for (const span of spans) {
    if (frontmatter && span.start < frontmatter.end) continue;
    segments.push({
      type: 'embedded',
      languageId: 'markdown',
      start: span.start,
      end: span.end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { inlineCode: true }
    });
  }
  let proseStart = frontmatter?.end || 0;
  for (const block of fencedBlocks) {
    if (block.containerStart > proseStart) {
      segments.push({
        type: 'prose',
        languageId: 'markdown',
        start: proseStart,
        end: block.containerStart,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: { host: true }
      });
    }
    proseStart = Math.max(proseStart, block.containerEnd);
  }
  if (proseStart < text.length) {
    segments.push({
      type: 'prose',
      languageId: ext === '.mdx' ? null : 'markdown',
      start: proseStart,
      end: text.length,
      parentSegmentId: null,
      embeddingContext: 'prose',
      meta: proseStart === 0 && !segments.length ? null : { host: true }
    });
  }
  return finalizeSegments(segments, relPath);
};
