import { INTENT_CONFIDENCE_BUCKET_THRESHOLDS } from '../query-intent.js';

export const TRUST_SURFACE_SCHEMA_VERSION = 1;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const isPlainObject = (value) => (
  value && typeof value === 'object' && value.constructor === Object
);

const toBoolean = (value) => value === true;

const toBucket = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'low' || raw === 'medium' || raw === 'high'
    ? raw
    : 'low';
};

/**
 * Derive trust-surface signals from intent/context/ANN policy metadata.
 * These booleans intentionally capture cross-stage degradations so clients can
 * explain why confidence was reduced even when ranking still succeeds.
 *
 * @param {{
 *  intentInfo?:object,
 *  contextExpansionStats?:object,
 *  annCandidatePolicy?:object
 * }} input
 * @returns {{
 *  intentAbstained:boolean,
 *  parseFallback:boolean,
 *  contextExpansionTruncated:boolean,
 *  annCandidateConstrained:boolean
 * }}
 */
const resolveSignals = ({ intentInfo, contextExpansionStats, annCandidatePolicy }) => {
  const contextModes = ['code', 'prose', 'extracted-prose', 'records'];
  const contextExpansionTruncated = contextModes.some((mode) => Boolean(contextExpansionStats?.[mode]?.truncation));
  return {
    intentAbstained: toBoolean(intentInfo?.abstain),
    parseFallback: intentInfo?.parseStrategy === 'heuristic-fallback',
    contextExpansionTruncated,
    annCandidateConstrained: annCandidatePolicy?.outputMode === 'constrained'
  };
};

/**
 * Build canonical reason codes for the trust/confidence surface.
 * Reason ordering is stable and low-confidence is surfaced first so logs and
 * contracts remain deterministic for regression tests.
 *
 * @param {{confidenceBucket:'low'|'medium'|'high',signals:object}} input
 * @returns {string[]}
 */
const resolveReasonCodes = ({ confidenceBucket, signals }) => {
  const reasons = [];
  if (confidenceBucket === 'low') reasons.push('low_intent_confidence');
  if (signals.intentAbstained) reasons.push('intent_abstained');
  if (signals.parseFallback) reasons.push('query_parse_fallback');
  if (signals.contextExpansionTruncated) reasons.push('context_expansion_truncated');
  if (signals.annCandidateConstrained) reasons.push('ann_candidate_constrained');
  if (!reasons.length) reasons.push('confidence_nominal');
  return reasons;
};

export const CONFIDENCE_BUCKET_DEFINITIONS = Object.freeze({
  low: { minInclusive: 0, maxExclusive: INTENT_CONFIDENCE_BUCKET_THRESHOLDS.medium },
  medium: {
    minInclusive: INTENT_CONFIDENCE_BUCKET_THRESHOLDS.medium,
    maxExclusive: INTENT_CONFIDENCE_BUCKET_THRESHOLDS.high
  },
  high: { minInclusive: INTENT_CONFIDENCE_BUCKET_THRESHOLDS.high, maxInclusive: 1 }
});

/**
 * Build a stable trust/confidence explain surface for retrieval output.
 * @param {object} input
 * @returns {object}
 */
export const buildTrustSurface = ({
  intentInfo,
  contextExpansionStats,
  annCandidatePolicy
} = {}) => {
  const confidence = clamp01(intentInfo?.confidence);
  const confidenceBucket = toBucket(intentInfo?.confidenceBucket);
  const confidenceMargin = clamp01(intentInfo?.confidenceMargin);
  const signals = resolveSignals({ intentInfo, contextExpansionStats, annCandidatePolicy });
  const reasons = resolveReasonCodes({ confidenceBucket, signals });
  return {
    schemaVersion: TRUST_SURFACE_SCHEMA_VERSION,
    confidence: {
      value: confidence,
      margin: confidenceMargin,
      bucket: confidenceBucket,
      buckets: CONFIDENCE_BUCKET_DEFINITIONS
    },
    signals,
    reasonCodes: reasons
  };
};

/**
 * Parse trust/confidence surface while ignoring unknown forward fields.
 * @param {object} surface
 * @returns {object}
 */
export const readTrustSurface = (surface) => {
  if (!isPlainObject(surface)) {
    return buildTrustSurface();
  }
  const confidence = isPlainObject(surface.confidence) ? surface.confidence : {};
  const signals = isPlainObject(surface.signals) ? surface.signals : {};
  const normalized = {
    schemaVersion: Number.isFinite(Number(surface.schemaVersion))
      ? Number(surface.schemaVersion)
      : TRUST_SURFACE_SCHEMA_VERSION,
    confidence: {
      value: clamp01(confidence.value),
      margin: clamp01(confidence.margin),
      bucket: toBucket(confidence.bucket),
      buckets: CONFIDENCE_BUCKET_DEFINITIONS
    },
    signals: {
      intentAbstained: toBoolean(signals.intentAbstained),
      parseFallback: toBoolean(signals.parseFallback),
      contextExpansionTruncated: toBoolean(signals.contextExpansionTruncated),
      annCandidateConstrained: toBoolean(signals.annCandidateConstrained)
    },
    reasonCodes: Array.isArray(surface.reasonCodes)
      ? surface.reasonCodes.map((entry) => String(entry)).filter(Boolean)
      : []
  };
  if (!normalized.reasonCodes.length) {
    normalized.reasonCodes = resolveReasonCodes({
      confidenceBucket: normalized.confidence.bucket,
      signals: normalized.signals
    });
  }
  return normalized;
};

const formatExplainLine = (label, parts, color) => {
  const filtered = parts.filter(Boolean);
  if (!filtered.length) return null;
  const prefix = `   ${label}: `;
  if (color?.gray && typeof color.gray === 'function') {
    return color.gray(prefix) + filtered.join(', ');
  }
  return prefix + filtered.join(', ');
};

const formatScorePiece = (label, parts, color) => {
  if (!parts.length) return '';
  return `${label}=${parts.join(',')}`;
};

export function formatScoreBreakdown(scoreBreakdown, color) {
  if (!scoreBreakdown || typeof scoreBreakdown !== 'object') return [];
  const parts = [];
  const selected = scoreBreakdown.selected || null;
  if (selected) {
    const entry = [];
    if (selected.type) entry.push(selected.type);
    if (Number.isFinite(selected.score)) entry.push(selected.score.toFixed(3));
    const piece = formatScorePiece('Score', entry, color);
    if (piece) parts.push(piece);
  }
  const sparse = scoreBreakdown.sparse || null;
  if (sparse) {
    const entry = [];
    if (sparse.type) entry.push(sparse.type);
    if (Number.isFinite(sparse.score)) entry.push(sparse.score.toFixed(3));
    const piece = formatScorePiece('Sparse', entry, color);
    if (piece) parts.push(piece);
  }
  const ann = scoreBreakdown.ann || null;
  if (ann) {
    const entry = [];
    if (ann.source) entry.push(ann.source);
    if (Number.isFinite(ann.score)) entry.push(ann.score.toFixed(3));
    const piece = formatScorePiece('ANN', entry, color);
    if (piece) parts.push(piece);
  }
  const rrf = scoreBreakdown.rrf || null;
  if (rrf && Number.isFinite(rrf.score)) {
    const piece = formatScorePiece('RRF', [rrf.score.toFixed(3)], color);
    if (piece) parts.push(piece);
  }
  const symbol = scoreBreakdown.symbol || null;
  if (symbol) {
    const entry = [];
    if (typeof symbol.definition === 'boolean') entry.push(symbol.definition ? 'def' : 'nodef');
    if (typeof symbol.export === 'boolean') entry.push(symbol.export ? 'exp' : 'noexp');
    if (Number.isFinite(symbol.factor)) entry.push(`x${symbol.factor.toFixed(2)}`);
    const piece = formatScorePiece('Symbol', entry, color);
    if (piece) parts.push(piece);
  }
  const relation = scoreBreakdown.relation || null;
  if (relation && relation.enabled !== false) {
    const entry = [];
    if (Number.isFinite(relation.callMatches)) entry.push(`call=${relation.callMatches}`);
    if (Number.isFinite(relation.usageMatches)) entry.push(`use=${relation.usageMatches}`);
    if (Number.isFinite(relation.boost)) entry.push(`+${relation.boost.toFixed(3)}`);
    const piece = formatScorePiece('Relation', entry, color);
    if (piece) parts.push(piece);
  }
  const graph = scoreBreakdown.graph || null;
  if (graph) {
    const entry = [];
    if (Number.isFinite(graph.score)) entry.push(graph.score.toFixed(3));
    if (Number.isFinite(graph.degree)) entry.push(`deg=${graph.degree}`);
    if (Number.isFinite(graph.proximity)) entry.push(`prox=${graph.proximity}`);
    const piece = formatScorePiece('Graph', entry, color);
    if (piece) parts.push(piece);
  }
  if (!parts.length) return [];
  const prefix = '   Scores: ';
  if (color?.gray && typeof color.gray === 'function') {
    return [color.gray(prefix) + parts.join(' | ')];
  }
  return [prefix + parts.join(' | ')];
}
