import { chunkSegments } from '../../../segments.js';
import { resolveJavaScriptDeclarationReference } from '../../../../lang/javascript/callable-occurrences.js';
import {
  resolveTreeSitterLanguageForSegment,
  resolveTreeSitterLanguagesForSegments
} from '../tree-sitter.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../../lang/tree-sitter/options.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

export const chunkSegmentsWithTreeSitterPasses = async ({
  text,
  ext,
  relPath,
  mode,
  segments,
  lineIndex,
  context,
  treeSitterConfig,
  languageOptions,
  log
}) => {
  if (!treeSitterConfig || treeSitterConfig.enabled === false) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  if (treeSitterConfig.languagePasses === false) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  if (!Array.isArray(segments) || !segments.length) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  const baseOptions = { treeSitter: treeSitterConfig };
  const passSegments = new Map();
  const fallbackSegments = [];
  for (const segment of segments) {
    const rawLanguageId = segment?.languageId || context?.languageId || null;
    const languageId = resolveTreeSitterLanguageForSegment(rawLanguageId, ext);
    if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId) || !isTreeSitterEnabled(baseOptions, languageId)) {
      fallbackSegments.push(segment);
      continue;
    }
    if (!passSegments.has(languageId)) passSegments.set(languageId, []);
    passSegments.get(languageId).push(segment);
  }
  if (passSegments.size <= 1 && !fallbackSegments.length) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  const chunks = [];
  if (fallbackSegments.length) {
    const fallbackContext = {
      ...context,
      treeSitter: { ...(treeSitterConfig || {}), enabled: false }
    };
    const fallbackChunks = chunkSegments({
      text,
      ext,
      relPath,
      mode,
      segments: fallbackSegments,
      lineIndex,
      context: fallbackContext
    });
    if (fallbackChunks && fallbackChunks.length) chunks.push(...fallbackChunks);
  }
  for (const [languageId, languageSegments] of passSegments) {
    const passTreeSitter = { ...(treeSitterConfig || {}), allowedLanguages: [languageId] };
    const passChunks = chunkSegments({
      text,
      ext,
      relPath,
      mode,
      segments: languageSegments,
      lineIndex,
      context: {
        ...context,
        treeSitter: passTreeSitter
      }
    });
    if (passChunks && passChunks.length) chunks.push(...passChunks);
  }
  if (!chunks.length) return chunks;
  chunks.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  return chunks;
};

export const validateChunkBounds = (chunks, textLength) => {
  if (!Array.isArray(chunks)) return 'chunk list missing';
  let lastStart = -1;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) return `chunk ${i} missing`;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return `chunk ${i} missing offsets`;
    }
    if (start < 0 || end < 0 || start > end || end > textLength) {
      return `chunk ${i} out of bounds`;
    }
    if (start < lastStart) {
      return `chunk ${i} out of order`;
    }
    lastStart = start;
  }
  return null;
};

export const sanitizeChunkBounds = (chunks, textLength) => {
  if (!Array.isArray(chunks)) return;
  const max = Number.isFinite(textLength) ? textLength : 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const clampedStart = Math.max(0, Math.min(start, max));
    const clampedEnd = Math.max(clampedStart, Math.min(end, max));
    if (clampedStart !== start) chunk.start = clampedStart;
    if (clampedEnd !== end) chunk.end = clampedEnd;
  }
};


/** Retain source-owned JS declarations/evaluations and legacy JS/TS module
 * gaps. Qualified occurrence identities can overlap declaration envelopes;
 * legacy geometric gaps cannot establish an overlapping execution owner.
 * Work stays bounded by the existing catalog, source occurrences and chunks.
 */
export const retainModuleCallChunks = ({ chunks, callIndex, languageId, textLength, jsDeclarations = null }) => {
  if (!['javascript', 'typescript'].includes(languageId)) return chunks;
  if (!callIndex?.callDetailsWithRange?.length && !(languageId === 'javascript' && jsDeclarations?.source?.state === 'qualified')) return chunks;
  const ranges = chunks.filter(chunk => Number.isSafeInteger(chunk.start) && Number.isSafeInteger(chunk.end)
    && chunk.start >= 0 && chunk.end > chunk.start && chunk.end <= textLength)
    .map(chunk => [chunk.start, chunk.end]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const covered = [];
  for (const range of ranges) {
    const prior = covered.at(-1);
    if (prior && range[0] <= prior[1]) prior[1] = Math.max(prior[1], range[1]);
    else covered.push([...range]);
  }
  const projected = new Map(), supplements = [];
  const catalogOwned = languageId === 'javascript' && jsDeclarations?.source?.state === 'qualified' && jsDeclarations.source.length === textLength;
  for (const chunk of chunks) {
    const id = catalogOwned ? resolveJavaScriptDeclarationReference(chunk, jsDeclarations).record?.id : chunk.meta?.jsDeclaration?.id;
    if (id) (projected.get(id) || projected.set(id, []).get(id)).push([chunk.start, chunk.end]);
  }
  if (catalogOwned) for (const record of Object.values(jsDeclarations.records)) {
    if (!['callable', 'class'].includes(record.kind) || projected.has(record.id)) continue;
    const range = record.associations.at(-1).range;
    const chunk = { ...range, name: record.displayName, kind: record.kind === 'class' ? 'ClassExpression' : 'FunctionExpression',
      meta: { jsDeclaration: { id: record.id, sourceHash: record.sourceHash, range: record.range, role: record.role, associations: record.associations } } };
    supplements.push(chunk); projected.set(record.id, [[chunk.start, chunk.end]]);
  }
  for (const values of projected.values()) {
    values.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let widest = -1;
    for (const value of values) { widest = Math.max(widest, value[1]); value[1] = widest; }
  }
  const alreadyProjected = (id, detail) => {
    const values = projected.get(id) || [];
    let low = 0, high = values.length;
    while (low < high) { const mid = (low + high) >>> 1; if (values[mid][0] <= detail.start) low = mid + 1; else high = mid; }
    return low > 0 && values[low - 1][1] >= detail.end;
  };
  const gaps = new Map();
  for (const detail of callIndex?.callDetailsWithRange || []) {
    if (!Number.isSafeInteger(detail.start) || !Number.isSafeInteger(detail.end)
      || detail.start < 0 || detail.end <= detail.start || detail.end > textLength) continue;
    const record = languageId === 'javascript' ? jsDeclarations?.records?.[detail.callerOccurrenceId] : null;
    const sourceOwned = record && ['module', 'evaluation'].includes(record.kind)
      && detail.callerDeclaration?.id === record.id && detail.evaluationOwner?.state === 'qualified'
      && detail.evaluationOwner.sourceOffset === 0
      && resolveJavaScriptDeclarationReference({ start: detail.start, end: detail.end, meta: { jsDeclaration: detail.callerDeclaration } }, jsDeclarations).record?.id === record.id;
    if (!sourceOwned && detail.caller !== '(module)') continue;
    if (sourceOwned && alreadyProjected(record.id, detail)) continue;
    let low = 0, high = covered.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (covered[mid][0] <= detail.start) low = mid + 1;
      else high = mid;
    }
    // Legacy ranges cannot certify overlapping scope. Qualified JavaScript
    // module/class-initialization owners can overlap declaration envelopes
    // without borrowing their invocation bodies.
    if (!sourceOwned && low && detail.start < covered[low - 1][1]) continue;
    if (!sourceOwned && low < covered.length && detail.end > covered[low][0]) continue;
    const group = sourceOwned ? `${record.id}:${low}` : low;
    const gap = gaps.get(group);
    if (gap) { gap.start = Math.min(gap.start, detail.start); gap.end = Math.max(gap.end, detail.end); }
    else gaps.set(group, { start: detail.start, end: detail.end, name: detail.caller || '(module)', kind: record?.kind === 'evaluation' ? 'SourceEvaluation' : 'Module',
      meta: sourceOwned || detail.callerDeclaration?.role === 'ModuleEvaluation' ? { jsDeclaration: detail.callerDeclaration } : {} });
  }
  if (!gaps.size && !supplements.length) return chunks;
  return [...chunks, ...supplements, ...gaps.values()].sort((a, b) => a.start - b.start || a.end - b.end);
};
