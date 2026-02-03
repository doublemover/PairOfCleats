import { parse, postprocess, preprocess } from 'micromark';
import { normalizeLimit } from '../../shared/limits.js';
import { CONFIG_LANGS, hasMeaningfulText, normalizeFenceLanguage, normalizeSegmentsConfig } from './config.js';
import { detectFrontmatter } from './frontmatter.js';
import { finalizeSegments } from './finalize.js';

const collectMarkdownSegments = (text, config) => {
  const spans = [];
  const blocks = [];
  const wantInline = config?.inlineCodeSpans === true;
  const minChars = wantInline ? normalizeLimit(config.inlineCodeMinChars, 8) : 0;
  const maxSpans = wantInline ? normalizeLimit(config.inlineCodeMaxSpans, 200) : 0;
  const maxBytes = wantInline ? normalizeLimit(config.inlineCodeMaxBytes, 64 * 1024) : 0;
  let totalBytes = 0;
  let events = [];
  try {
    events = postprocess(parse().document().write(preprocess()(text, 'utf8', true)));
  } catch {
    return { spans, blocks };
  }
  let current = null;
  for (const [action, token] of events) {
    if (action === 'enter' && token.type === 'codeFenced') {
      current = { info: null, valueStart: null, valueEnd: null };
      continue;
    }
    if (current) {
      if (action === 'enter' && token.type === 'codeFencedFenceInfo') {
        current.info = text.slice(token.start.offset, token.end.offset);
      }
      if (token.type === 'codeFlowValue') {
        if (action === 'enter' && !Number.isFinite(current.valueStart)) {
          current.valueStart = token.start.offset;
        }
        if (action === 'exit') current.valueEnd = token.end.offset;
      }
      if (action === 'exit' && token.type === 'codeFenced') {
        if (Number.isFinite(current.valueStart) && Number.isFinite(current.valueEnd)) {
          blocks.push({
            start: current.valueStart,
            end: current.valueEnd,
            info: current.info || null
          });
        }
        current = null;
      }
    }
    if (!wantInline) continue;
    if (action !== 'enter' || token.type !== 'codeTextData') continue;
    const start = token.start.offset;
    const end = token.end.offset;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const slice = text.slice(start, end);
    if (!hasMeaningfulText(slice)) continue;
    const nonWhitespace = slice.replace(/\s/g, '').length;
    if (nonWhitespace < minChars) continue;
    const bytes = Buffer.byteLength(slice, 'utf8');
    if (spans.length >= maxSpans || totalBytes + bytes > maxBytes) continue;
    totalBytes += bytes;
    spans.push({ start, end });
  }
  return { spans, blocks };
};

export const segmentMarkdown = ({ text, ext, relPath, segmentsConfig }) => {
  const config = normalizeSegmentsConfig(segmentsConfig);
  const segments = [];
  const frontmatter = detectFrontmatter(text);
  if (frontmatter) {
    segments.push({
      type: 'config',
      languageId: frontmatter.languageId,
      start: frontmatter.start,
      end: frontmatter.end,
      parentSegmentId: null,
      embeddingContext: 'config',
      meta: { frontmatter: true }
    });
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
      meta: { fenceInfo: block.info || null }
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
  if (!segments.length) {
    segments.push({
      type: CONFIG_LANGS.has(ext) ? 'config' : 'prose',
      languageId: ext === '.md' ? 'markdown' : null,
      start: 0,
      end: text.length,
      parentSegmentId: null,
      embeddingContext: CONFIG_LANGS.has(ext) ? 'config' : 'prose',
      meta: null
    });
  }
  return finalizeSegments(segments, relPath);
};
