import { parseBabelAst } from '../../lang/babel-parser.js';
import { hasMeaningfulText } from './config.js';
import { finalizeSegments } from './finalize.js';

const collectJsxRanges = (node, ranges, seen = new Set()) => {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    const start = Number.isFinite(node.start) ? node.start : (Array.isArray(node.range) ? node.range[0] : null);
    const end = Number.isFinite(node.end) ? node.end : (Array.isArray(node.range) ? node.range[1] : null);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      ranges.push({ start, end });
    }
  }
  for (const value of Object.values(node)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) collectJsxRanges(entry, ranges, seen);
    } else if (typeof value === 'object' && value.type) {
      collectJsxRanges(value, ranges, seen);
    }
  }
};

const mergeRanges = (ranges) => {
  if (!ranges.length) return [];
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  let current = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, next.end) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
};

export const segmentJsx = ({ text, ext, relPath, languageId, context }) => {
  const baseLang = languageId || (ext === '.tsx' ? 'typescript' : 'javascript');
  let ast = context?.jsAst || null;
  if (!ast) {
    const mode = ext === '.tsx' ? 'typescript' : 'javascript';
    ast = parseBabelAst(text, { ext, mode });
  }
  if (!ast) return null;
  const ranges = [];
  collectJsxRanges(ast, ranges);
  const merged = mergeRanges(ranges);
  if (!merged.length) return null;
  const segments = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      const slice = text.slice(cursor, range.start);
      if (hasMeaningfulText(slice)) {
        segments.push({
          type: 'code',
          languageId: baseLang,
          start: cursor,
          end: range.start,
          parentSegmentId: null,
          embeddingContext: 'code',
          meta: {}
        });
      }
    }
    segments.push({
      type: 'embedded',
      languageId: 'html',
      start: range.start,
      end: range.end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: 'jsx' }
    });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    const slice = text.slice(cursor);
    if (hasMeaningfulText(slice)) {
      segments.push({
        type: 'code',
        languageId: baseLang,
        start: cursor,
        end: text.length,
        parentSegmentId: null,
        embeddingContext: 'code',
        meta: {}
      });
    }
  }
  return finalizeSegments(segments, relPath);
};
