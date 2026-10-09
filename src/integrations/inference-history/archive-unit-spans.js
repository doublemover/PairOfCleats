import { historySemanticSpans } from './semantic-values.js';
import { archiveStructuralSpans } from './archive-structure.js';
import { historyError } from './common.js';
import { ARTIFACT_PROJECTION_VERSION } from './artifact-projection.js';

/** Reconstruct only current-policy sanitized fragments. References stay unit-local. */
export function planArchiveUnitSpans(unit, siblings, config) {
  const metadata = JSON.parse(unit.metadata), details = metadata.sourceDetails;
  if ((details?.sourceSha256 || metadata.evidenceKind === 'recovered_artifact') && details?.projectionVersion !== ARTIFACT_PROJECTION_VERSION) {
    throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive asset policy requires explicit source reprojection and reimport.');
  }
  if (!details?.sourceSha256) {
    return Array.from(historySemanticSpans(unit.text, config.chunkChars, config.overlapChars, metadata)).map(span => ({ ...span, sourceStart: span.start, sourceEnd: span.end, unitStart: 0, unitEnd: unit.text.length }));
  }
  if (!Number.isSafeInteger(details.sanitizedStart) || !Number.isSafeInteger(details.sanitizedEnd)) {
    throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive structural policy requires explicit source reimport.');
  }
  if (siblings.length > 5000) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Archive structural fragment budget exceeded.');
  const rows = siblings.map(row => ({ ...row, metadata: JSON.parse(row.metadata) }))
    .sort((a, b) => a.metadata.sourceDetails.sanitizedStart - b.metadata.sourceDetails.sanitizedStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Adjacent fragments may be imported in different shards. Never bridge a gap or overlap.
  let group = [], selected = null;
  const belongs = row => row.metadata.sourceDetails.sanitizedStart === details.sanitizedStart && row.metadata.sourceDetails.sanitizedEnd === details.sanitizedEnd && row.text === unit.text;
  for (const row of rows) {
    const source = row.metadata.sourceDetails;
    if (source.projectionVersion !== ARTIFACT_PROJECTION_VERSION) {
      throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive asset policy requires explicit source reprojection and reimport.');
    }
    if (!Number.isSafeInteger(source.sanitizedStart) || source.sanitizedEnd - source.sanitizedStart !== row.text.length) {
      throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive sanitized source offsets require explicit reimport.');
    }
    if (group.length && group.at(-1).metadata.sourceDetails.sanitizedStart === source.sanitizedStart && group.at(-1).metadata.sourceDetails.sanitizedEnd === source.sanitizedEnd) {
      if (group.at(-1).text !== row.text) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Conflicting archive source fragments.');
      continue;
    }
    if (group.length && group.at(-1).metadata.sourceDetails.sanitizedEnd !== source.sanitizedStart) {
      if (group.some(belongs)) selected = group;
      group = [];
    }
    group.push(row);
  }
  if (group.some(belongs)) selected = group;
  if (!selected) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive source occurrence unavailable.');
  if (selected.reduce((sum, row) => sum + row.text.length, 0) > 16 * 1024 * 1024) {
    throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Archive structural source exceeds reconstruction budget.');
  }
  const text = selected.map(row => row.text).join('');
  const base = selected[0].metadata.sourceDetails.sanitizedStart;
  const start = details.sanitizedStart - base, end = details.sanitizedEnd - base;
  const spans = [], ranges = new Set();
  for (const span of archiveStructuralSpans(text, { ...metadata, ...details, chunkChars: config.chunkChars, overlapChars: config.overlapChars, intersectStart: start, intersectEnd: end })) {
    const localStart = Math.max(start, span.start) - start;
    const localEnd = Math.min(end, span.end) - start;
    const range = localStart + ':' + localEnd;
    if (localStart >= localEnd || ranges.has(range)) continue;
    ranges.add(range);
    spans.push({ ...span, sourceStart: span.start, sourceEnd: span.end, unitStart: start, unitEnd: end, start: localStart, end: localEnd });
  }
  if (spans.length > 5000) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Semantic unit span budget exceeded.');
  return spans;
}


/** Measure the complete model input without truncation; divide only oversized spans. */
export async function boundArchiveTokenSpans(spans, measure, maxTokens = 8192) {
  const output = [];
  let pending = spans;
  while (pending.length) {
    const next = [];
    for (let offset = 0; offset < pending.length; offset += 256) {
      const batch = pending.slice(offset, offset + 256);
      const lengths = await measure(batch.map(span => ({ text: span.text, title: span.title })));
      if (!Array.isArray(lengths) || lengths.length !== batch.length || lengths.some(length => !Number.isSafeInteger(length) || length < 1)) {
        throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid archive token measurement.');
      }
      for (let index = 0; index < batch.length; index++) {
        const span = batch[index];
        if (lengths[index] <= maxTokens) { output.push(span); continue; }
        let middle = Math.floor(span.text.length / 2);
        if (middle && /[\uD800-\uDBFF]/.test(span.text[middle - 1])) middle--;
        if (!middle) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Archive context exceeds model token budget.');
        for (const [from, to] of [[0, middle], [middle, span.text.length]]) {
          const sourceStart = span.sourceStart + from, sourceEnd = span.sourceStart + to;
          const start = Math.max(sourceStart, span.unitStart) - span.unitStart;
          const end = Math.min(sourceEnd, span.unitEnd) - span.unitStart;
          if (start < end) next.push({ ...span, text: span.text.slice(from, to), sourceStart, sourceEnd, start, end });
        }
      }
    }
    pending = next;
    if (output.length + pending.length > 5000) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Archive token span budget exceeded.');
  }
  const unique = new Map();
  for (const span of output.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const key = span.start + ':' + span.end;
    if (!unique.has(key)) unique.set(key, span);
  }
  return [...unique.values()];
}




