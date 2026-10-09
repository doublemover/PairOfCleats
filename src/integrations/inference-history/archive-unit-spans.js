import { historySemanticSpans } from './semantic-values.js';
import { archiveStructuralSpans } from './archive-structure.js';
import { digest, historyError } from './common.js';
import { ARTIFACT_PROJECTION_VERSION } from './artifact-projection.js';

export const ARCHIVE_SOURCE_PLAN_MAX_SPANS = 65536;
export const ARCHIVE_SOURCE_PLAN_MAX_CHARS = 64 * 1024 * 1024;
const sourceLimit = message => historyError('ERR_INFERENCE_HISTORY_LIMIT', message);
const requireProjection = metadata => {
  const details = metadata.sourceDetails;
  if ((details?.sourceSha256 || metadata.evidenceKind === 'recovered_artifact') && details?.projectionVersion !== ARTIFACT_PROJECTION_VERSION) {
    throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive asset policy requires explicit source reprojection and reimport.');
  }
};

/** One immutable, bounded source plan. Its owner must discard it when leaving the group. */
export function createArchiveSourcePlan(siblings, config) {
  if (siblings.length > 5000) throw sourceLimit('Archive structural fragment budget exceeded.');
  if (siblings.reduce((sum, row) => sum + row.text.length, 0) > 16 * 1024 * 1024) {
    throw sourceLimit('Archive structural source exceeds reconstruction budget.');
  }
  const rows = siblings.map(row => ({ ...row, parsed: JSON.parse(row.metadata) }))
    .sort((a, b) => a.parsed.sourceDetails.sanitizedStart - b.parsed.sourceDetails.sanitizedStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groupIdentity = JSON.stringify([rows[0]?.parsed.sourceDetails?.sourceSha256, rows[0]?.parsed.sourceDetails?.locator ?? null, rows[0]?.parsed.sourceDetails?.artifactKind]);
  const runs = [], byUnit = new Map();
  let group = [];
  for (const row of rows) {
    requireProjection(row.parsed);
    const source = row.parsed.sourceDetails;
    if (JSON.stringify([source?.sourceSha256, source?.locator ?? null, source?.artifactKind]) !== groupIdentity || source?.kind !== undefined && source.kind !== source.artifactKind) {
      throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive source plan requires one exact source/context group.');
    }
    if (!Number.isSafeInteger(source?.sanitizedStart) || !Number.isSafeInteger(source?.sanitizedEnd) || source.sanitizedStart < 0 || source.sanitizedEnd - source.sanitizedStart !== row.text.length) {
      throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive sanitized source offsets require explicit source reimport.');
    }
    const previous = group.at(-1)?.parsed.sourceDetails;
    if (previous && previous.sanitizedStart === source.sanitizedStart && previous.sanitizedEnd === source.sanitizedEnd) {
      if (group.at(-1).text !== row.text) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Conflicting archive source fragments.');
      byUnit.set(row.id, { row, group });
      continue;
    }
    if (previous && previous.sanitizedEnd !== source.sanitizedStart) {
      runs.push(group); group = [];
    }
    group.push(row); byUnit.set(row.id, { row, group });
  }
  if (group.length) runs.push(group);
  let spanCount = 0, inputChars = 0;
  const prepared = new Map();
  for (const run of runs) {
    const text = run.map(row => row.text).join(''), first = run[0].parsed;
    if (text.length && (spanCount >= ARCHIVE_SOURCE_PLAN_MAX_SPANS || inputChars >= ARCHIVE_SOURCE_PLAN_MAX_CHARS)) throw sourceLimit('Archive source plan exceeds explicit span/input budgets.');
    const spans = archiveStructuralSpans(text, { ...first, ...first.sourceDetails,
      chunkChars: config.chunkChars, overlapChars: config.overlapChars,
      maxSpans: ARCHIVE_SOURCE_PLAN_MAX_SPANS - spanCount,
      maxSpanChars: ARCHIVE_SOURCE_PLAN_MAX_CHARS - inputChars });
    spanCount += spans.length;
    inputChars += spans.reduce((sum, span) => sum + span.text.length + span.title.length + 23, 0);
    prepared.set(run, { base: first.sourceDetails.sanitizedStart, spans: Object.freeze(spans.map(span => Object.freeze(span))) });
  }
  const dependencies = Object.freeze(siblings.map(row => Object.freeze({ id: row.id, hash: digest(JSON.stringify([row.text, row.metadata])) })));
  return Object.freeze({
    dependencies,
    statistics: Object.freeze({ reconstructions: runs.length, structuralParses: runs.length, spans: spanCount, inputChars }),
    forUnit(unit) {
      const entry = byUnit.get(unit.id);
      if (!entry || entry.row.text !== unit.text || entry.row.metadata !== unit.metadata) {
        throw historyError('ERR_INFERENCE_HISTORY_STALE', 'Archive source changed during embedding refresh.');
      }
      const details = entry.row.parsed.sourceDetails, plan = prepared.get(entry.group);
      const start = details.sanitizedStart - plan.base, end = details.sanitizedEnd - plan.base;
      const spans = [], ranges = new Set();
      for (const span of plan.spans) {
        if (span.start >= end || span.end <= start) continue;
        const localStart = Math.max(start, span.start) - start, localEnd = Math.min(end, span.end) - start;
        const range = localStart + ':' + localEnd;
        if (localStart >= localEnd || ranges.has(range)) continue;
        ranges.add(range);
        spans.push({ ...span, sourceStart: span.start, sourceEnd: span.end, unitStart: start, unitEnd: end, start: localStart, end: localEnd });
      }
      if (spans.length > 5000) throw sourceLimit('Semantic unit span budget exceeded.');
      return spans;
    }
  });
}

/** Reconstruct only current-policy sanitized fragments. References stay unit-local. */
export function planArchiveUnitSpans(unit, siblings, config, sourcePlan = null) {
  const metadata = JSON.parse(unit.metadata), details = metadata.sourceDetails;
  requireProjection(metadata);
  if (!details?.sourceSha256) {
    return Array.from(historySemanticSpans(unit.text, config.chunkChars, config.overlapChars, metadata)).map(span => ({ ...span, sourceStart: span.start, sourceEnd: span.end, unitStart: 0, unitEnd: unit.text.length }));
  }
  if (!Number.isSafeInteger(details.sanitizedStart) || !Number.isSafeInteger(details.sanitizedEnd)) {
    throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive structural policy requires explicit source reimport.');
  }
  return (sourcePlan ?? createArchiveSourcePlan(siblings, config)).forUnit(unit);
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
