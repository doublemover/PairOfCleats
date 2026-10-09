import path from 'node:path';
import { smartChunk } from '../../index/chunking.js';
import { LANGUAGE_ROUTE_DESCRIPTORS } from '../../index/language-registry/descriptors.js';
import { resolveSpecialCodeExt } from '../../index/constants.js';

export const ARCHIVE_CLASSIFICATION_VERSION = 'archive-classification.v2';
export const ARCHIVE_CHUNK_VERSION = 'archive-structure.v2';
export const ARCHIVE_CONTEXT_VERSION = 'archive-context.v2';
const configs = new Set(['.json', '.jsonl', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.env', '.properties']);
const markdown = new Set(['.md', '.markdown', '.mdx']);

/** Classification never removes evidence: eligibility is a separate proposed policy. */
export function classifyArchiveSource({ locator = '', kind = 'document', text = '' } = {}) {
  const name = path.posix.basename(String(locator).replaceAll('\\', '/'));
  let ext = resolveSpecialCodeExt(name) || path.posix.extname(name).toLowerCase();
  let classificationReason = ext ? 'registered_extension' : 'unknown_extension';
  let languageConfidence = 'high';
  const sample = text.slice(0, 32768);
  if (!LANGUAGE_ROUTE_DESCRIPTORS.some(row => row.extensions.includes(ext)) && !configs.has(ext) && !markdown.has(ext)) {
    languageConfidence = 'low'; classificationReason = 'prose_fallback';
    if (/^\s*(?:export\s+)?(?:async\s+)?function\s+[\p{L}_$][\p{L}\p{N}_$]*\s*\(/mu.test(sample)) {
      ext = '.js'; classificationReason = 'javascript_function_heuristic'; languageConfidence = 'medium';
    } else if (/^\s*(?:async\s+)?def\s+\w+\s*\([^\n]*\)\s*:/m.test(sample)) {
      ext = '.py'; classificationReason = 'python_definition_heuristic'; languageConfidence = 'medium';
    } else if (/^#{1,6} .+/m.test(sample) && /^ {0,3}(?:~{3,}|\x60{3,})/m.test(sample)) {
      ext = '.md'; classificationReason = 'markdown_heading_fence_heuristic'; languageConfidence = 'medium';
    } else if (text.length <= 32768 && /^\s*[\[{]/.test(sample)) {
      try { JSON.parse(text); ext = '.json'; classificationReason = 'validated_json'; languageConfidence = 'high'; } catch { /* Preserve ambiguous prose. */ }
    } else if (/^(?:\d{4}-\d{2}-\d{2}[^\n]*|\[?(?:INFO|WARN|ERROR|DEBUG)\]?[^\n]*)$/m.test(sample)) {
      ext = '.log'; classificationReason = 'log_line_heuristic'; languageConfidence = 'medium';
    }
  }
  const language = LANGUAGE_ROUTE_DESCRIPTORS.find(row => row.extensions.includes(ext))?.id
    || (markdown.has(ext) ? 'markdown' : configs.has(ext) ? ext.slice(1) : 'text');
  const format = configs.has(ext) ? 'config' : markdown.has(ext) ? 'markdown'
    : ext === '.log' ? 'log' : language !== 'text' || kind === 'code' ? 'code' : 'prose';
  const generated = /(?:^|[\/._-])(?:generated|min|bundle|lock)(?:[\/._-]|$)/i.test(locator)
    || /^\s*(?:\/\/|#|\/\*)[^\n]*(?:auto[- ]generated|do not edit)/i.test(text);
  const lexicalOnlyReason = ['metadata', 'tool_activity'].includes(kind) ? kind
    : generated ? 'generated_material_proposal' : null;
  return { version: ARCHIVE_CLASSIFICATION_VERSION, kind, language, format, ext, languageConfidence, classificationReason, fallbackReason: classificationReason === 'prose_fallback' ? 'no_confident_structure' : null,
    generated, semanticEligible: true, proposedSemanticEligibility: lexicalOnlyReason === null, lexicalOnlyReason };
}

/** Strictly reconstruct contiguous sanitized transport offsets, never invent missing bytes. */
export function reassembleArchiveFragments(records) {
  const groups = new Map();
  for (const record of records) {
    const p = record.provenance;
    if (!p || typeof record.body !== 'string') throw new Error('Projected archive fragments required.');
    const key = JSON.stringify([p.source_sha256, p.locator, record.artifact_kind, p.total_chars]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const output = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.provenance.chunk_start - b.provenance.chunk_start || a.id.localeCompare(b.id));
    let current = null;
    for (const row of rows) {
      const p = row.provenance;
      if (!Number.isSafeInteger(p.chunk_start) || !Number.isSafeInteger(p.chunk_end)
        || p.chunk_end - p.chunk_start !== row.body.length || p.chunk_end > p.total_chars) {
        throw new Error('Invalid sanitized fragment offsets.');
      }
      if (current && p.chunk_start < current.end) {
        const previous = current.fragments.find(item => item.start === p.chunk_start && item.end === p.chunk_end);
        if (previous && current.text.slice(p.chunk_start - current.start, p.chunk_end - current.start) === row.body) continue;
        throw new Error('Overlapping archive representations require separate facets.');
      }
      if (!current || current.end !== p.chunk_start) {
        current = { sourceSha256: p.source_sha256, locator: p.locator, kind: row.artifact_kind,
          title: row.title, start: p.chunk_start, end: p.chunk_start, totalChars: p.total_chars,
          text: '', fragments: [] };
        output.push(current);
      }
      current.text += row.body;
      current.end = p.chunk_end;
      current.fragments.push({ id: row.id, start: p.chunk_start, end: p.chunk_end });
    }
  }
  return output;
}

function paragraphRanges(text, start, end, title) {
  const ranges = [];
  let cursor = start;
  for (const match of text.slice(start, end).matchAll(/\n\s*\n/g)) {
    const boundary = start + match.index + match[0].length;
    ranges.push({ start: cursor, end: boundary, name: title }); cursor = boundary;
  }
  if (cursor < end) ranges.push({ start: cursor, end, name: title });
  return ranges;
}

/** Existing repository language/Markdown handlers, with complete coverage of omitted trivia. */
export function archiveStructuralSpans(text, options = {}) {
  const { chunkChars = 1000, overlapChars = 200, locator = '', artifactKind, kind = artifactKind || 'document' } = options;
  if (typeof text !== 'string' || !Number.isSafeInteger(chunkChars) || chunkChars < 1
    || !Number.isSafeInteger(overlapChars) || overlapChars < 0 || overlapChars >= chunkChars) {
    throw new Error('Invalid archive structural span controls.');
  }
  const classification = classifyArchiveSource({ locator, kind, text });
  const mode = ['code', 'config'].includes(classification.format) ? 'code' : 'prose';
  const chunks = smartChunk({ text, ext: classification.ext, relPath: locator, mode,
    context: { treeSitter: { enabled: false }, chunking: { maxBytes: 64 * 1024 * 1024 } } });
  if (classification.format === 'markdown') {
    const fences = []; let open = null;
    for (const match of text.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm)) {
      if (!open) open = { start: match.index, marker: match[1][0], length: match[1].length };
      else if (match[1][0] === open.marker && match[1].length >= open.length) {
        fences.push({ start: open.start, end: match.index + match[0].length, name: null }); open = null;
      }
    }
    if (open) fences.push({ start: open.start, end: text.length, name: null });
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (fences.some(fence => chunks[i].start > fence.start && chunks[i].start < fence.end)) chunks.splice(i, 1);
    }
    for (const fence of fences) fence.name = chunks.findLast(row => row.start <= fence.start)?.name || null;
    for (const row of chunks) {
      for (const fence of fences) {
        if (row.start < fence.start && row.end > fence.start) row.end = fence.start;
      }
    }
    chunks.push(...fences);
  }
  const boundaries = [...new Set([0, text.length, ...chunks.flatMap(row => [row.start, row.end])])]
    .filter(n => Number.isSafeInteger(n) && n >= 0 && n <= text.length).sort((a, b) => a - b);
  const ranges = [];
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1], end = boundaries[i];
    const owner = chunks.find(row => row.start <= start && row.end >= end);
    if (owner || !text.slice(start, end).trim()) ranges.push({ start, end, name: owner?.name });
    else ranges.push(...paragraphRanges(text, start, end, null));
  }
  // Attach preceding comments to their definition while preserving sanitized offsets.
  for (let i = ranges.length - 2; i >= 0; i--) {
    if (mode === 'code' && !ranges[i].name && ranges[i + 1].name
      && /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)\s*)*$/.test(text.slice(ranges[i].start, ranges[i].end))) {
      ranges[i + 1].start = ranges[i].start; ranges.splice(i, 1);
    }
  }
  const output = [];
  for (const range of ranges) {
    let start = range.start;
    while (start < range.end) {
      let end = Math.min(range.end, start + chunkChars);
      if (end < range.end) {
        const line = text.lastIndexOf('\n', end);
        if (line > start + chunkChars / 2) end = line + 1;
        if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
      const title = [locator, range.name].filter(Boolean).join(' — ').slice(0, 1024);
      output.push({ start, end, text: text.slice(start, end), title, contextTitle: title, classification });
      if (end === range.end) break;
      start = Math.max(start + 1, end - overlapChars);
      if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
    }
  }
  // Mutating end for trivia above must also retain exact source text.
  for (const span of output) span.text = text.slice(span.start, span.end);
  return output;
}


