import { canonicalSemanticJson } from '../identity.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { runtimeImportError } from './raw-store.js';

const FUNCTION_KINDS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction',
  'ArrowFunctionExpression', 'MethodDeclaration', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod',
  'Constructor', 'GetAccessor', 'SetAccessor']);
const functionTarget = target => target.kind === 'scope' ? FUNCTION_KINDS.has(target.scopeKind)
  : ['expression', 'statement'].includes(target.kind) && FUNCTION_KINDS.has(target.astKind);

/** Candidate syntax is not semantic authority. Resolve against one pinned published family. */
export const qualifyRuntimeSourceCandidates = async ({ capture, candidates, semanticContext = null, signal = null }) => {
  if (!semanticContext) return candidates.map(row => ({ ...row, targetRecords: [],
    targetReason: row.targets.length ? 'unverified_semantic_candidates' : 'semantic_targets_not_supplied', source: null }));
  const { store, manifest } = semanticContext;
  if (!store?.getRecords || !store?.iterateRows || !manifest
    || canonicalSemanticJson(store.generation) !== canonicalSemanticJson(capture.generation)
    || canonicalSemanticJson(manifest.generation) !== canonicalSemanticJson(capture.generation)) {
    throw runtimeImportError('Runtime semantic authority is not the exact pinned generation.', 'ERR_RUNTIME_QUERY_SCOPE');
  }
  const partitions = new Map(manifest.partitions.map(partition => [partition.partitionId, partition]));
  const sources = new Map();
  const result = [];
  for (const candidate of candidates) {
    throwIfAborted(signal);
    const targets = [], reasons = new Set();
    let source = null;
    for (let start = 0; start < candidate.targets.length; start += 64) {
      const refs = candidate.targets.slice(start, start + 64).filter(ref => {
        const descriptor = partitions.get(ref.partitionId);
        if (!descriptor || descriptor.sourceUnitId !== candidate.sourceUnitId) {
          reasons.add('target_not_owned_by_capture_source'); return false;
        }
        return true;
      });
      const records = refs.length ? await store.getRecords(refs, ['span', 'scope', 'data'], { signal }) : [];
      for (let index = 0; index < refs.length; index++) {
        const ref = refs[index], record = records[index];
        if (!record) { reasons.add('target_record_unavailable'); continue; }
        let owner = sources.get(ref.partitionId);
        if (!owner) {
          for await (const row of store.iterateRows(ref.partitionId, 'semantic_sources', { signal })) {
            if (owner) throw runtimeImportError('Semantic target has multiple source owners.');
            owner = row;
          }
          if (!owner) throw runtimeImportError('Semantic target source manifest is unavailable.');
          sources.set(ref.partitionId, owner);
        }
        if (owner.repositoryNamespace !== capture.repositoryNamespace || owner.sourceUnitId !== candidate.sourceUnitId
          || owner.byteHash !== candidate.sourceHash) { reasons.add('target_source_identity_mismatch'); continue; }
        source = owner;
        if (!Array.isArray(record.span) || record.span.length !== 2 || record.span[0] < 0
          || record.span[1] > owner.textLength || record.span[1] <= record.span[0]) {
          reasons.add('target_source_range_unavailable'); continue;
        }
        targets.push({ ref, span: record.span, kind: record.kind, scopeKind: record.data?.scopeKind,
          astKind: record.data?.astKind || record.data?.statementKind });
      }
    }
    result.push({ ...candidate, targetRecords: targets, source,
      targetReason: [...reasons].join(',') || (targets.length ? null : 'semantic_targets_not_supplied') });
  }
  return result;
};

/** Supported direct-source coordinates only. Unknown source maps/inlining stay explicit. */
export const runtimeObservationTargets = ({ candidates, kind, data }) => {
  if (data?.inlineFrames?.length || data?.inlinedInto || data?.generatedRange) {
    return { targets: [], targetQuality: 'ambiguous', reason: 'runtime_coordinate_mapping_ambiguous' };
  }
  const records = [];
  for (const candidate of candidates) {
    const source = candidate.source;
    if (!source || source.mapping) continue;
    let range = null;
    if (kind === 'cpuProfile' && data.lineNumber != null && data.columnNumber != null
      && source.coordinateUnit === 'utf16' && data.lineNumber < source.lineStarts.length) {
      const offset = source.lineStarts[data.lineNumber] + data.columnNumber;
      const lineEnd = source.lineStarts[data.lineNumber + 1] ?? source.textLength;
      if (offset >= source.lineStarts[data.lineNumber] && offset < lineEnd) range = [offset, offset + 1];
    } else if (data?.sourceRange?.coordinateUnit === 'utf16' && source.coordinateUnit === 'utf16'
      && data.sourceRange.start >= 0 && data.sourceRange.end <= source.textLength
      && data.sourceRange.end > data.sourceRange.start) range = [data.sourceRange.start, data.sourceRange.end];
    if (!range) continue;
    for (const target of candidate.targetRecords) {
      if (kind === 'cpuProfile' ? !functionTarget(target)
        : !['expression', 'statement'].includes(target.kind) && !functionTarget(target)) continue;
      if (target.span[0] <= range[0] && target.span[1] >= range[1]) records.push(target.ref);
    }
  }
  const targets = [...new Map(records.map(ref => [canonicalSemanticJson(ref), ref])).values()];
  if (targets.length > 1) return { targets: [], targetQuality: 'ambiguous', reason: 'runtime_operation_coordinates_ambiguous' };
  const unverified = candidates.some(candidate => candidate.targetReason === 'unverified_semantic_candidates');
  return { targets, targetQuality: targets.length ? 'verified-coordinate' : unverified ? 'unverified-candidate' : 'unavailable',
    reason: targets.length ? null : unverified ? 'unverified_semantic_candidates' : 'runtime_operation_coordinates_unavailable_or_mismatched' };
};
