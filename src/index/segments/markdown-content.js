import { createRequire } from 'node:module';
import { normalizeLimit } from '../../shared/limits.js';
import { hasMeaningfulText } from './config.js';
import { createEmbeddedContentView, EMBEDDED_CONTENT_LIMITS } from '../../shared/embedded-content.js';

const require = createRequire(import.meta.url);
export const collectMarkdownSegments = (text, config) => {
  const spans = [];
  const blocks = [];
  const wantInline = config?.inlineCodeSpans === true;
  const minChars = wantInline ? normalizeLimit(config.inlineCodeMinChars, 8) : 0;
  const maxSpans = wantInline ? normalizeLimit(config.inlineCodeMaxSpans, 200) : 0;
  const maxBytes = wantInline ? normalizeLimit(config.inlineCodeMaxBytes, 64 * 1024) : 0;
  let totalBytes = 0;
  let events = [];
  const { parse, postprocess, preprocess } = require('micromark');
  try {
    events = postprocess(parse().document().write(preprocess()(text, 'utf8', true)));
  } catch {
    return { spans, blocks };
  }
  let current = null;
  const append = (start, end) => {
    if (end <= start) return;
    current.valueStart ??= start; current.valueEnd = end;
    if (current.unavailable) return;
    const last = current.pieces.at(-1);
    if (last?.end === start) last.end = end;
    else if (current.pieces.length < EMBEDDED_CONTENT_LIMITS.pieces) current.pieces.push({ start, end });
    else current.unavailable = 'piece-budget';
  };
  for (const [action, token, tokenContext] of events) {
    if (action === 'enter' && token.type === 'codeFenced') {
      current = { info: null, start: token.start.offset, pieces: [], fenceCount: 0,
        inFence: false, firstBreak: true, lastBreak: null, unavailable: null, valueStart: null, valueEnd: null };
      continue;
    }
    if (current) {
      if (token.type === 'codeFencedFence') {
        if (action === 'enter') { current.inFence = true; current.fenceCount++; }
        else current.inFence = false;
      }
      if (action === 'enter' && token.type === 'codeFencedFenceInfo') {
        current.info = text.slice(token.start.offset, token.end.offset);
      }
      if (action === 'enter' && !current.inFence && current.fenceCount === 1) {
        if (token.type === 'lineEnding' || token.type === 'lineEndingBlank') {
          if (current.firstBreak) current.firstBreak = false;
          else {
            // Micromark's end offset can include the next line's skipped host
            // prefix. Its serialized EOL identifies only the authored newline.
            const ending = tokenContext.sliceSerialize(token);
            const end = token.start.offset + ending.length;
            if (!/^(?:\r\n|\r|\n)$/u.test(ending) || end > token.end.offset
              || text.slice(token.start.offset, end) !== ending) current.unavailable = 'non-source-preserving-markdown-content';
            else append(token.start.offset, end);
            current.lastBreak = token.start.offset;
          }
        } else if (token.type === 'codeFlowValue') {
          const original = text.slice(token.start.offset, token.end.offset);
          // Partial tab expansion or preprocessing replacement needs generated
          // characters, which this exact source-piece protocol cannot express.
          if (original.length > EMBEDDED_CONTENT_LIMITS.transformedBytes && /[\t\0]/u.test(original)
            || original.length <= EMBEDDED_CONTENT_LIMITS.transformedBytes
              && tokenContext.sliceSerialize(token) !== original) current.unavailable = 'non-source-preserving-markdown-content';
          append(token.start.offset, token.end.offset); current.lastBreak = null;
        }
      }
      if (action === 'exit' && token.type === 'codeFenced') {
        // The separator before the closing fence is host framing. Other EOLs,
        // including authored blank lines and CRLF, stay byte-for-byte intact.
        if (current.lastBreak !== null) {
          current.valueEnd = current.lastBreak;
          const last = current.pieces.at(-1);
          if (!current.unavailable && last && last.start >= current.lastBreak) current.pieces.pop();
          else if (!current.unavailable && last) last.end = current.lastBreak;
        }
        if (current.valueStart !== null && current.valueEnd > current.valueStart) {
          let contentView = null;
          try { if (!current.unavailable) contentView = createEmbeddedContentView(text, current.pieces, { containerStart: current.start,
            containerEnd: token.end.offset, policy: 'markdown-fenced-content-v1' }); }
          catch (error) { if (error.code !== 'ERR_EMBEDDED_CONTENT') throw error; current.unavailable ||= error.reason; }
          blocks.push({ start: current.valueStart, end: current.valueEnd,
            containerStart: current.start, containerEnd: token.end.offset, info: current.info || null,
            closed: current.fenceCount > 1,
            contentView: current.unavailable ? null : contentView,
            ...(current.unavailable ? { contentUnavailable: current.unavailable } : {}) });
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

/** Comments and Markdown use the same installed parser and delimiter rules. */
export const collectMarkdownFencedContent = text => collectMarkdownSegments(text, null).blocks;
