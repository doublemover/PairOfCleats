import { buildChunksFromLineHeadings, buildLineIndexFromLines } from '../helpers.js';
import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

export const MAX_REGEX_LINE = 8192;
export const DEFAULT_PROSE_FALLBACK_MAX_CHARS = 120 * 1024;
export const DEFAULT_PROSE_FALLBACK_CHUNK_CHARS = 24 * 1024;

/**
 * Attach normalized metadata to each chunk while preserving offsets and names.
 *
 * This is used by heuristic dispatchers so downstream scoring can rely on a
 * consistent `meta.format` marker even when chunkers provide only headings.
 *
 * @param {Array<{start:number,end:number,name:string|null,kind?:string,meta?:object}>|null} chunks
 * @param {string|null} format
 * @param {string|null} kind
 * @returns {Array<{start:number,end:number,name:string|null,kind:string,meta?:object}>|null}
 */
export const applyFormatMeta = (chunks, format, kind) => {
  if (!chunks) return null;
  const resolvedKind = kind || null;
  const hasFormat = Boolean(format);
  const output = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    output[i] = {
      ...chunk,
      kind: resolvedKind || chunk.kind,
      meta: hasFormat ? { ...(chunk.meta || {}), format } : chunk.meta
    };
  }
  return output;
};

/**
 * Split text into lines and return a line-start index, reusing the shared
 * index cache in `context.chunkingShared` when it matches the current text.
 *
 * Reuse keeps regex fallback passes deterministic while avoiding repeated
 * index construction across multiple chunkers in one dispatch cycle.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {{lines:string[],lineIndex:number[]}}
 */
export const splitLinesWithIndex = (text, context = null) => {
  const lines = text.split('\n');
  const sharedLineIndex = Array.isArray(context?.chunkingShared?.lineIndex)
    ? context.chunkingShared.lineIndex
    : null;
  if (sharedLineIndex && sharedLineIndex.length === lines.length) {
    return { lines, lineIndex: sharedLineIndex };
  }
  const lineIndex = buildLineIndexFromLines(lines);
  if (context?.chunkingShared && typeof context.chunkingShared === 'object') {
    context.chunkingShared.lineIndex = lineIndex;
  }
  return { lines, lineIndex };
};

/**
 * Build chunks by scanning lines with a regex heading matcher.
 *
 * Fallback behavior is intentionally total: when no headings are found this
 * always emits one full-file chunk so caller pipelines never receive `null`
 * for supported text formats.
 *
 * @param {string} text
 * @param {RegExp} matcher
 * @param {object} [options]
 * @param {number} [options.maxLineLength]
 * @param {(line:string)=>boolean} [options.skipLine]
 * @param {(line:string)=>boolean} [options.precheck]
 * @param {(match:RegExpMatchArray,line:string)=>string} [options.title]
 * @param {string|null} [options.format]
 * @param {string} [options.kind]
 * @param {string} [options.defaultName]
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string|null,kind:string,meta:object}>}
 */
export const chunkByLineRegex = (text, matcher, options = {}, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  const maxLineLength = Number.isFinite(Number(options.maxLineLength))
    ? Math.max(0, Math.floor(Number(options.maxLineLength)))
    : MAX_REGEX_LINE;
  const skipLine = typeof options.skipLine === 'function' ? options.skipLine : null;
  const precheck = typeof options.precheck === 'function' ? options.precheck : null;
  const titleFor = typeof options.title === 'function' ? options.title : null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (maxLineLength && line.length > maxLineLength) continue;
    if (skipLine && skipLine(line)) continue;
    if (precheck && !precheck(line)) continue;
    const match = line.match(matcher);
    if (!match) continue;
    const title = titleFor ? titleFor(match, line) : (match[1] || '').trim();
    if (!title) continue;
    headings.push({ line: i, title });
  }
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, options.format || null, options.kind || null);
  }
  return [{
    start: 0,
    end: text.length,
    name: options.defaultName || 'section',
    kind: options.kind || 'Section',
    meta: options.format ? { format: options.format } : {}
  }];
};

/**
 * Attempt tree-sitter chunking for a language, but only return a result when
 * the parser produced at least one concrete chunk.
 *
 * Returning `null` on empty parser output keeps heuristic fallback order
 * deterministic and avoids accidentally treating "parsed but empty" as success.
 *
 * @param {string} text
 * @param {string} languageId
 * @param {object} context
 * @returns {Array<object>|null}
 */
export const tryTreeSitterChunks = (text, languageId, context) => {
  // Keep fallback deterministic: only short-circuit when tree-sitter produced
  // concrete chunks for this language; otherwise continue with heuristics.
  const chunks = buildTreeSitterChunks({
    text,
    languageId,
    options: getTreeSitterOptions(context)
  });
  return (Array.isArray(chunks) && chunks.length) ? chunks : null;
};

/**
 * Resolve the first chunker whose matcher accepts the extension/path.
 *
 * Ordering is authoritative and intentionally not score-based.
 *
 * @param {Array<{match:(ext:string,relPath:string|null)=>boolean}>} chunkers
 * @param {string} ext
 * @param {string|null} relPath
 * @returns {object|null}
 */
export const resolveChunker = (chunkers, ext, relPath) => {
  for (let i = 0; i < chunkers.length; i += 1) {
    const entry = chunkers[i];
    if (entry.match(ext, relPath)) return entry;
  }
  return null;
};

/**
 * Fallback chunking for large prose bodies when structure-aware parsing fails.
 *
 * For small/normal-sized files this preserves one-chunk behavior. For very
 * large prose files it slices by configured character budget to cap tokenization
 * latency while still covering the full document.
 *
 * @param {string} text
 * @param {object} [context]
 * @returns {Array<{start:number,end:number,name:null,kind:'Section',meta:object}>}
 */
export const chunkLargeProseFallback = (text, context = {}) => {
  if (!text) return [];
  const chunking = context?.chunking && typeof context.chunking === 'object'
    ? context.chunking
    : {};
  const maxCharsRaw = Number(chunking.proseFallbackMaxChars);
  const chunkCharsRaw = Number(chunking.proseFallbackChunkChars);
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0
    ? Math.floor(maxCharsRaw)
    : DEFAULT_PROSE_FALLBACK_MAX_CHARS;
  const chunkChars = Number.isFinite(chunkCharsRaw) && chunkCharsRaw > 0
    ? Math.floor(chunkCharsRaw)
    : DEFAULT_PROSE_FALLBACK_CHUNK_CHARS;
  if (text.length <= maxChars || chunkChars <= 0) {
    return [{ start: 0, end: text.length, name: null, kind: 'Section', meta: {} }];
  }
  // Preserve full coverage while capping worst-case tokenization latency for
  // very large prose blobs that would otherwise become one giant chunk.
  const chunks = [];
  for (let start = 0; start < text.length; start += chunkChars) {
    const end = Math.min(text.length, start + chunkChars);
    chunks.push({ start, end, name: null, kind: 'Section', meta: {} });
  }
  return chunks;
};

/**
 * Build the narrow context surface consumed by chunking limit enforcement.
 * This avoids copying full parser-heavy context objects in hot paths.
 * @param {object} context
 * @param {string|null} relPath
 * @param {string} ext
 * @param {string} mode
 * @returns {object}
 */
export const buildLimitContext = (context, relPath, ext, mode) => {
  if (!context || typeof context !== 'object') {
    return { relPath, ext, mode };
  }
  return {
    chunking: context.chunking,
    chunkingShared: context.chunkingShared,
    relPath: relPath || context.relPath || null,
    ext: ext || context.ext || null,
    mode: mode || context.mode || null,
    file: context.file,
    filePath: context.filePath,
    fileExt: context.fileExt,
    fileRole: context.fileRole,
    languageId: context.languageId,
    lang: context.lang
  };
};
