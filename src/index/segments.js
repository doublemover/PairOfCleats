import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { sha1 } from '../shared/hash.js';
import { smartChunk } from './chunking.js';

const CONFIG_EXTS = new Set([
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml'
]);

const LANGUAGE_ID_EXT = new Map([
  ['javascript', '.js'],
  ['typescript', '.ts'],
  ['tsx', '.tsx'],
  ['jsx', '.jsx'],
  ['html', '.html'],
  ['css', '.css'],
  ['markdown', '.md'],
  ['yaml', '.yaml'],
  ['json', '.json'],
  ['toml', '.toml'],
  ['ini', '.ini'],
  ['xml', '.xml'],
  ['python', '.py'],
  ['ruby', '.rb'],
  ['php', '.php'],
  ['go', '.go'],
  ['rust', '.rs'],
  ['java', '.java'],
  ['csharp', '.cs'],
  ['kotlin', '.kt'],
  ['sql', '.sql'],
  ['shell', '.sh']
]);

const resolveSegmentType = (mode, ext) => {
  if (mode === 'prose') return 'prose';
  if (CONFIG_EXTS.has(ext)) return 'config';
  return 'code';
};

const resolveSegmentTokenMode = (segment) => {
  const hint = segment.embeddingContext || segment.meta?.embeddingContext || null;
  if (hint === 'prose') return 'prose';
  if (hint === 'code' || hint === 'config') return 'code';
  if (segment.type === 'prose' || segment.type === 'comment') return 'prose';
  return 'code';
};

const shouldIndexSegment = (segment, tokenMode, fileMode) => {
  if (segment.type === 'embedded') return true;
  return tokenMode === fileMode;
};

const resolveSegmentExt = (baseExt, segment) => {
  if (segment.ext) return segment.ext;
  if (segment.languageId && LANGUAGE_ID_EXT.has(segment.languageId)) {
    return LANGUAGE_ID_EXT.get(segment.languageId);
  }
  return baseExt;
};

const buildSegmentId = (relPath, segment) => {
  const key = [
    relPath || '',
    segment.type,
    segment.languageId || '',
    segment.start,
    segment.end,
    segment.parentSegmentId || ''
  ].join('|');
  return `seg_${sha1(key)}`;
};

const finalizeSegments = (segments, relPath) => {
  const output = [];
  for (const segment of segments || []) {
    if (!segment) continue;
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const normalized = {
      ...segment,
      start,
      end
    };
    normalized.segmentId = normalized.segmentId || buildSegmentId(relPath, normalized);
    output.push(normalized);
  }
  output.sort((a, b) => a.start - b.start || a.end - b.end);
  return output;
};

export function discoverSegments({
  text,
  ext,
  relPath,
  mode,
  languageId = null
}) {
  const baseSegment = {
    type: resolveSegmentType(mode, ext),
    languageId,
    start: 0,
    end: text.length,
    parentSegmentId: null,
    meta: {}
  };
  return finalizeSegments([baseSegment], relPath);
}

export function chunkSegments({
  text,
  ext,
  relPath,
  mode,
  context = {},
  segments = [],
  lineIndex = null
}) {
  const resolvedLineIndex = lineIndex || buildLineIndex(text);
  const chunks = [];
  for (const segment of segments) {
    const segmentText = text.slice(segment.start, segment.end);
    const tokenMode = resolveSegmentTokenMode(segment);
    if (!shouldIndexSegment(segment, tokenMode, mode)) continue;
    const segmentExt = resolveSegmentExt(ext, segment);
    const segmentContext = {
      ...context,
      languageId: segment.languageId || context.languageId || null,
      segment
    };
    const segmentChunks = smartChunk({
      text: segmentText,
      ext: segmentExt,
      relPath,
      mode: tokenMode,
      context: segmentContext,
      languageId: segment.languageId || null
    });
    if (!Array.isArray(segmentChunks) || !segmentChunks.length) continue;
    const segmentStartLine = offsetToLine(resolvedLineIndex, segment.start);
    for (const chunk of segmentChunks) {
      if (!chunk) continue;
      const adjusted = { ...chunk };
      adjusted.start = chunk.start + segment.start;
      adjusted.end = chunk.end + segment.start;
      if (adjusted.meta && typeof adjusted.meta === 'object') {
        if (Number.isFinite(adjusted.meta.startLine)) {
          adjusted.meta.startLine = segmentStartLine + adjusted.meta.startLine - 1;
        }
        if (Number.isFinite(adjusted.meta.endLine)) {
          adjusted.meta.endLine = segmentStartLine + adjusted.meta.endLine - 1;
        }
      }
      adjusted.segment = {
        segmentId: segment.segmentId,
        type: segment.type,
        languageId: segment.languageId || null,
        start: segment.start,
        end: segment.end,
        parentSegmentId: segment.parentSegmentId || null,
        embeddingContext: segment.embeddingContext || segment.meta?.embeddingContext || null
      };
      chunks.push(adjusted);
    }
  }
  return chunks;
}
