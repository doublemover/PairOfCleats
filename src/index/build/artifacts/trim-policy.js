export const TRIM_POLICY_VERSION = '1.0.0';

export const TRIM_REASONS = Object.freeze({
  rowOversize: 'row_oversize',
  dropRequiredFields: 'drop_required_fields',
  dropRowOverBudget: 'drop_row_over_budget',
  deduped: 'deduped',
  dedupeCollision: 'dedupe_collision',
  callSitesClearArgs: 'call_sites_clear_args',
  callSitesClearEvidence: 'call_sites_clear_evidence',
  callSitesClearKwargs: 'call_sites_clear_kwargs',
  callSitesClearSnippetHash: 'call_sites_clear_snippet_hash',
  symbolsClearSignature: 'symbols_clear_signature',
  symbolsClearName: 'symbols_clear_name',
  symbolsClearKind: 'symbols_clear_kind',
  symbolsClearLang: 'symbols_clear_lang',
  symbolsDropExtensions: 'symbols_drop_extensions',
  symbolOccurrencesClearRange: 'symbol_occurrences_clear_range',
  symbolRefTrimCandidates: 'symbol_ref_trim_candidates',
  symbolRefClearImportHint: 'symbol_ref_clear_import_hint',
  symbolEdgesDropEvidence: 'symbol_edges_drop_evidence',
  symbolEdgesClearReason: 'symbol_edges_clear_reason',
  symbolEdgesClearConfidence: 'symbol_edges_clear_confidence',
  chunkMetaDropTokenFields: 'chunk_meta_drop_token_fields',
  chunkMetaDropContextFields: 'chunk_meta_drop_context_fields',
  chunkMetaDropOptionalFields: 'chunk_meta_drop_optional_fields',
  chunkMetaFallbackMinimal: 'chunk_meta_fallback_minimal',
  chunkMetaTruncateFallbackText: 'chunk_meta_truncate_fallback_text',
  chunkMetaClearFallbackText: 'chunk_meta_clear_fallback_text'
});

export const TRIM_REASON_TAXONOMY = Object.freeze([
  ...Object.values(TRIM_REASONS)
]);

const normalizeReasonKey = (reason) => (
  typeof reason === 'string' && reason.trim() ? reason.trim() : null
);

export const addTrimReason = (stats, reason, count = 1) => {
  if (!stats || typeof stats !== 'object') return;
  const key = normalizeReasonKey(reason);
  if (!key) return;
  const increment = Number.isFinite(Number(count)) ? Math.max(1, Math.floor(Number(count))) : 1;
  if (!stats.trimReasonCounts || typeof stats.trimReasonCounts !== 'object') {
    stats.trimReasonCounts = {};
  }
  stats.trimReasonCounts[key] = (stats.trimReasonCounts[key] || 0) + increment;
};

export const addTrimReasons = (stats, reasons) => {
  if (!Array.isArray(reasons) || !reasons.length) return;
  for (const reason of reasons) {
    addTrimReason(stats, reason);
  }
};

export const normalizeTrimReasonCounts = (counts) => {
  if (!counts || typeof counts !== 'object') return {};
  const source = counts;
  const normalized = {};
  for (const key of TRIM_REASON_TAXONOMY) {
    const value = Number(source[key]);
    if (!Number.isFinite(value) || value <= 0) continue;
    normalized[key] = Math.floor(value);
  }
  const extras = Object.keys(source)
    .filter((key) => !TRIM_REASON_TAXONOMY.includes(key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of extras) {
    const value = Number(source[key]);
    if (!Number.isFinite(value) || value <= 0) continue;
    normalized[key] = Math.floor(value);
  }
  return normalized;
};

export const buildTrimMetadata = (stats, {
  trimmedFields = null,
  trimmedRows = null,
  droppedRows = null,
  maxRowBytes = null
} = {}) => {
  const hasNumericOverride = (value) => (
    value !== null
    && value !== undefined
    && Number.isFinite(Number(value))
  );
  const resolvedTrimmedRows = hasNumericOverride(trimmedRows)
    ? Math.max(0, Math.floor(Number(trimmedRows)))
    : Math.max(0, Math.floor(Number(stats?.trimmedRows) || 0));
  const resolvedDroppedRows = hasNumericOverride(droppedRows)
    ? Math.max(0, Math.floor(Number(droppedRows)))
    : Math.max(0, Math.floor(Number(stats?.droppedRows) || 0));
  const resolvedMaxRowBytes = hasNumericOverride(maxRowBytes)
    ? Math.max(0, Math.floor(Number(maxRowBytes)))
    : Math.max(0, Math.floor(Number(stats?.maxRowBytes) || 0));
  const reasons = normalizeTrimReasonCounts(stats?.trimReasonCounts);
  return {
    trimPolicyVersion: TRIM_POLICY_VERSION,
    trimmedRows: resolvedTrimmedRows,
    droppedRows: resolvedDroppedRows,
    maxRowBytes: resolvedMaxRowBytes,
    trimReasonCounts: reasons,
    ...(trimmedFields && Object.keys(trimmedFields).length ? { trimmedFields } : {})
  };
};
