import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../shared/hash.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import {
  normalizeLimit,
  normalizeOptionalNumber
} from '../shared/limits.js';
import { resolveProvenance } from '../shared/provenance.js';
import {
  normalizeRiskSummary,
  summarizeRiskStats
} from '../shared/risk-explain.js';
import {
  filterRiskFlows,
  normalizeRiskFilters,
  validateRiskFilters
} from '../shared/risk-filters.js';
import { buildGraphContextPack } from '../graph/context-pack.js';
import { compareStrings } from '../shared/sort.js';
import { isRelativePathEscape, readFileRangeSync } from '../shared/files.js';
import { normalizePathForRepo } from '../shared/path-normalize.js';
import {
  MAX_JSON_BYTES,
  loadJsonArrayArtifactSync,
  loadJsonObjectArtifactSync,
  loadJsonArrayArtifactRows,
  loadPiecesManifest,
  resolveArtifactPresence
} from '../shared/artifact-io.js';

const resolveSeedRef = (seed) => {
  if (!seed || typeof seed !== 'object') return null;
  if (seed.type && typeof seed.type === 'string') return seed;
  if ('status' in seed) return seed;
  return null;
};

const resolveSeedCandidates = (seed) => {
  if (!seed || typeof seed !== 'object' || !('status' in seed)) return [];
  const candidates = Array.isArray(seed.candidates) ? seed.candidates : [];
  const resolved = seed.resolved && typeof seed.resolved === 'object' ? seed.resolved : null;
  const out = [];
  const seen = new Set();
  const pushUnique = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const key = candidate.chunkUid
      ? `chunk:${candidate.chunkUid}`
      : candidate.symbolId
        ? `symbol:${candidate.symbolId}`
        : candidate.path
          ? `file:${candidate.path}`
          : null;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };
  if (resolved) pushUnique(resolved);
  for (const candidate of candidates) pushUnique(candidate);
  return out;
};

/**
 * Build a reusable index of chunk metadata to resolve seed refs efficiently.
 */
export const buildChunkIndex = (chunkMeta, { repoRoot = null } = {}) => {
  if (!Array.isArray(chunkMeta)) return null;
  const byChunkUid = new Map();
  const byFile = new Map();
  const bySymbol = new Map();
  for (const chunk of chunkMeta) {
    if (!chunk) continue;
    const entry = { ...chunk };
    const chunkUid = entry.chunkUid || entry.metaV2?.chunkUid || null;
    if (chunkUid && !byChunkUid.has(chunkUid)) byChunkUid.set(chunkUid, entry);
    const normalizedFile = normalizePathForRepo(entry.file, repoRoot);
    if (normalizedFile) {
      const list = byFile.get(normalizedFile) || [];
      list.push(entry);
      byFile.set(normalizedFile, list);
    }
    const symbolId = entry.metaV2?.symbol?.symbolId || null;
    if (symbolId && !bySymbol.has(symbolId)) bySymbol.set(symbolId, entry);
  }
  return {
    byChunkUid,
    byFile,
    bySymbol,
    normalizePath: (value) => normalizePathForRepo(value, repoRoot)
  };
};

const resolveChunkBySeed = (seedRef, chunkIndex, warnings) => {
  if (!chunkIndex) return null;
  const candidates = resolveChunkCandidatesBySeed(seedRef, chunkIndex);

  if (seedRef?.type) {
    const chunk = candidates[0]?.chunk || null;
    if (!chunk) {
      warnings.push({
        code: 'SEED_NOT_FOUND',
        message: `Seed ${seedRef.type} could not be resolved to chunk metadata.`
      });
    }
    return chunk;
  }

  if (seedRef && 'status' in seedRef) {
    if (candidates[0]?.chunk) return candidates[0].chunk;
    warnings.push({
      code: 'SEED_UNRESOLVED',
      message: 'Seed reference envelope could not be resolved to a chunk.'
    });
  }
  return null;
};

const resolveChunkCandidatesBySeed = (seedRef, chunkIndex) => {
  if (!seedRef || !chunkIndex) return [];
  const { byChunkUid, byFile, bySymbol, normalizePath } = chunkIndex;
  const resolved = [];
  const seen = new Set();
  const resolveFromNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'chunk') return node.chunkUid ? [byChunkUid.get(node.chunkUid) || null] : [];
    if (node.type === 'file') {
      const normalizedPath = normalizePath ? normalizePath(node.path) : node.path;
      const list = (normalizedPath && byFile.get(normalizedPath)) || byFile.get(node.path) || [];
      return Array.isArray(list) ? list : [];
    }
    if (node.type === 'symbol') return node.symbolId ? [bySymbol.get(node.symbolId) || null] : [];
    return [];
  };
  const pushResolved = (ref, chunk, candidateIndex = null) => {
    if (!ref?.type || !chunk) return;
    const chunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
    if (!chunkUid || seen.has(chunkUid)) return;
    seen.add(chunkUid);
    resolved.push({ ref, chunk, chunkUid, candidateIndex });
  };
  if (seedRef?.type) {
    for (const chunk of resolveFromNode(seedRef)) {
      pushResolved(seedRef, chunk, 0);
    }
    return resolved;
  }
  if (!('status' in seedRef)) return resolved;
  const candidates = resolveSeedCandidates(seedRef);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const ref = candidate?.chunkUid
      ? { type: 'chunk', chunkUid: candidate.chunkUid }
      : candidate?.path
        ? { type: 'file', path: candidate.path }
        : candidate?.symbolId
          ? { type: 'symbol', symbolId: candidate.symbolId }
          : null;
    if (!ref) continue;
    for (const chunk of resolveFromNode(ref)) {
      pushResolved(ref, chunk, index);
    }
  }
  return resolved;
};

const resolvePrimaryRef = (seedRef, chunk) => {
  if (seedRef?.type) return seedRef;
  if (chunk?.chunkUid || chunk?.metaV2?.chunkUid) {
    return { type: 'chunk', chunkUid: chunk.chunkUid || chunk.metaV2.chunkUid };
  }
  if (chunk?.file) return { type: 'file', path: chunk.file };
  return seedRef || null;
};

const CONTEXT_PACK_MAX_RISK_FLOWS = 5;
const CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW = 8;
const CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP = 3;
const CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES = 192;
const CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS = 24;
const CONTEXT_PACK_MAX_RISK_BYTES = 24 * 1024;
const CONTEXT_PACK_MAX_RISK_TOKENS = 2048;

const buildRiskArtifactStatus = ({ presence, required = false, loadFailed = false }) => {
  if (loadFailed) return 'load_failed';
  const missing = presence?.format === 'missing' || presence?.missingMeta || presence?.missingPaths?.length > 0;
  if (missing) return required ? 'missing' : 'not_required';
  return 'present';
};

export const classifyRiskLoadFailure = (err) => {
  const code = typeof err?.code === 'string' ? err.code : '';
  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  if (code === 'ETIMEDOUT'
    || code === 'ERR_ARTIFACT_TIMEOUT'
    || code === 'ERR_SUBPROCESS_TIMEOUT'
    || message.includes('timed out')
    || message.includes('timeout')) {
    return 'timed_out';
  }
  if (code === 'ERR_ARTIFACT_INVALID'
    || code === 'ERR_JSONL_INVALID'
    || code === 'ERR_MANIFEST_INVALID'
    || code === 'ERR_MANIFEST_INCOMPLETE'
    || code === 'ERR_MANIFEST_ENTRY_MISSING'
    || code === 'ERR_MANIFEST_SOURCE_AMBIGUOUS'
    || message.includes('invalid json')
    || message.includes('schema validation failed')
    || message.includes('invalid columnar payload')
    || message.includes('invalid json payload')) {
    return 'schema_invalid';
  }
  return 'degraded';
};

const normalizeRiskArtifactRefs = (stats) => {
  const artifacts = stats?.artifacts;
  if (!artifacts || typeof artifacts !== 'object') return null;
  const refs = {
    stats: artifacts.stats || null,
    summaries: artifacts.summaries || artifacts.riskSummaries || null,
    flows: artifacts.flows || artifacts.riskFlows || null,
    callSites: artifacts.callSites || null
  };
  return Object.values(refs).some(Boolean) ? refs : null;
};

const normalizeRiskRuleBundle = (stats) => {
  const ruleBundle = stats?.provenance?.ruleBundle;
  if (!ruleBundle || typeof ruleBundle !== 'object') return null;
  return {
    version: ruleBundle.version || null,
    fingerprint: ruleBundle.fingerprint || null,
    provenance: ruleBundle.provenance && typeof ruleBundle.provenance === 'object'
      ? {
        defaults: ruleBundle.provenance.defaults === true,
        sourcePath: ruleBundle.provenance.sourcePath || null
      }
      : null
  };
};

const normalizeRiskProvenance = ({
  manifest,
  stats,
  artifactStatus,
  indexSignature = null,
  indexCompatKey = null
}) => ({
  manifestVersion: Number.isFinite(manifest?.version) ? manifest.version : null,
  artifactSurfaceVersion: manifest?.artifactSurfaceVersion || null,
  compatibilityKey: manifest?.compatibilityKey || indexCompatKey || null,
  indexSignature: indexSignature || stats?.provenance?.indexSignature || null,
  indexCompatKey: indexCompatKey || manifest?.compatibilityKey || stats?.provenance?.indexCompatKey || null,
  mode: stats?.mode || null,
  generatedAt: stats?.generatedAt || null,
  ruleBundle: normalizeRiskRuleBundle(stats),
  effectiveConfigFingerprint: stats?.provenance?.effectiveConfigFingerprint || null,
  artifacts: artifactStatus,
  artifactRefs: normalizeRiskArtifactRefs(stats)
});

const normalizeRiskPathNodes = (flow) => {
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  return chunkUids.map((chunkUid) => ({ type: 'chunk', chunkUid }));
};

const RISK_SEVERITY_WEIGHT = Object.freeze({
  critical: 5,
  high: 4,
  medium: 3,
  moderate: 3,
  low: 2,
  info: 1
});

const resolveRiskSeverityWeight = (value) => {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return RISK_SEVERITY_WEIGHT[key] || 0;
};

const resolveRiskSeedRelevance = (flow, riskAnchor) => {
  const anchorChunkUid = riskAnchor?.chunkUid || null;
  const anchorKind = riskAnchor?.kind || null;
  if (!anchorChunkUid) return 0;
  if (anchorKind === 'source') {
    if (flow?.source?.chunkUid === anchorChunkUid) return 3;
    if (flow?.sink?.chunkUid === anchorChunkUid) return 2;
  }
  if (anchorKind === 'sink') {
    if (flow?.sink?.chunkUid === anchorChunkUid) return 3;
    if (flow?.source?.chunkUid === anchorChunkUid) return 2;
  }
  if (anchorKind === 'path') {
    const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
    if (chunkUids.includes(anchorChunkUid)) return 2;
    if (flow?.source?.chunkUid === anchorChunkUid || flow?.sink?.chunkUid === anchorChunkUid) return 1;
    return 0;
  }
  if (flow?.source?.chunkUid === anchorChunkUid || flow?.sink?.chunkUid === anchorChunkUid) return 2;
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  return chunkUids.includes(anchorChunkUid) ? 1 : 0;
};

const rankRiskFlows = (flows, riskAnchor) => Array.from(Array.isArray(flows) ? flows : [])
  .map((flow) => ({
    flow,
    score: {
      seedRelevance: resolveRiskSeedRelevance(flow, riskAnchor),
      severity: resolveRiskSeverityWeight(flow?.sink?.severity || flow?.source?.severity),
      confidence: Number.isFinite(flow?.confidence) ? flow.confidence : -1,
      hopCount: Number.isFinite(flow?.notes?.hopCount) ? flow.notes.hopCount : Number.MAX_SAFE_INTEGER
    }
  }))
  .sort((a, b) => {
    if (a.score.seedRelevance !== b.score.seedRelevance) return b.score.seedRelevance - a.score.seedRelevance;
    if (a.score.severity !== b.score.severity) return b.score.severity - a.score.severity;
    if (a.score.confidence !== b.score.confidence) return b.score.confidence - a.score.confidence;
    if (a.score.hopCount !== b.score.hopCount) return a.score.hopCount - b.score.hopCount;
    return compareStrings(a.flow?.flowId || '', b.flow?.flowId || '');
  })
  .map((entry, index) => ({ ...entry, rank: index + 1 }));

const RISK_ANCHOR_KIND_ORDER = Object.freeze({
  source: 0,
  sink: 1,
  path: 2,
  unresolved: 3
});

const resolveRiskAnchorKindWeight = (kind) => {
  if (kind === 'source' || kind === 'sink') return 3;
  if (kind === 'path') return 2;
  return 0;
};

const resolveRiskFlowAnchorKind = (flow, chunkUid) => {
  if (!chunkUid) return null;
  if (flow?.source?.chunkUid === chunkUid) return 'source';
  if (flow?.sink?.chunkUid === chunkUid) return 'sink';
  const pathChunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  return pathChunkUids.includes(chunkUid) ? 'path' : null;
};

const resolveRiskAnchor = ({ rankedFlows, riskSeedContext, warnings }) => {
  const candidates = Array.isArray(riskSeedContext?.candidates) ? riskSeedContext.candidates : [];
  if (!rankedFlows.length || !candidates.length) {
    return {
      selected: {
        kind: 'unresolved',
        chunkUid: riskSeedContext?.primaryChunkUid || null,
        ref: riskSeedContext?.primaryRef || null,
        flowId: null,
        candidateIndex: null
      },
      alternates: []
    };
  }
  const matches = [];
  for (const candidate of candidates) {
    for (const entry of rankedFlows) {
      const kind = resolveRiskFlowAnchorKind(entry.flow, candidate.chunkUid);
      if (!kind) continue;
      matches.push({
        kind,
        chunkUid: candidate.chunkUid,
        ref: candidate.ref,
        flowId: entry.flow?.flowId || null,
        candidateIndex: Number.isFinite(candidate.candidateIndex) ? candidate.candidateIndex : Number.MAX_SAFE_INTEGER,
        score: entry.score
      });
    }
  }
  if (!matches.length) {
    warnings.push({
      code: 'RISK_ANCHOR_UNRESOLVED',
      message: 'Risk flows were available, but none matched the resolved seed candidates.'
    });
    return {
      selected: {
        kind: 'unresolved',
        chunkUid: riskSeedContext?.primaryChunkUid || candidates[0]?.chunkUid || null,
        ref: riskSeedContext?.primaryRef || candidates[0]?.ref || null,
        flowId: null,
        candidateIndex: candidates[0]?.candidateIndex ?? null
      },
      alternates: []
    };
  }
  matches.sort((a, b) => {
    const kindWeightDelta = resolveRiskAnchorKindWeight(b.kind) - resolveRiskAnchorKindWeight(a.kind);
    if (kindWeightDelta) return kindWeightDelta;
    if (a.candidateIndex !== b.candidateIndex) return a.candidateIndex - b.candidateIndex;
    const roleDelta = (RISK_ANCHOR_KIND_ORDER[a.kind] ?? Number.MAX_SAFE_INTEGER)
      - (RISK_ANCHOR_KIND_ORDER[b.kind] ?? Number.MAX_SAFE_INTEGER);
    if (roleDelta) return roleDelta;
    if (a.score.severity !== b.score.severity) return b.score.severity - a.score.severity;
    if (a.score.confidence !== b.score.confidence) return b.score.confidence - a.score.confidence;
    if (a.score.hopCount !== b.score.hopCount) return a.score.hopCount - b.score.hopCount;
    return compareStrings(a.flowId || '', b.flowId || '');
  });
  const selected = matches[0];
  const alternates = matches.filter((entry, index) => {
    if (index === 0) return false;
    return entry.chunkUid !== selected.chunkUid || entry.kind !== selected.kind || entry.flowId !== selected.flowId;
  });
  if (alternates.length) {
    warnings.push({
      code: 'RISK_ANCHOR_ALTERNATES',
      message: 'Risk seed anchoring resolved multiple candidates; using the strongest deterministic match.',
      data: {
        selected: {
          kind: selected.kind,
          chunkUid: selected.chunkUid,
          flowId: selected.flowId
        },
        alternates: alternates.slice(0, 5).map((entry) => ({
          kind: entry.kind,
          chunkUid: entry.chunkUid,
          flowId: entry.flowId
        }))
      }
    });
  }
  return { selected, alternates };
};

const estimateRiskByteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const estimateRiskTokenCount = (value) => {
  const serialized = JSON.stringify(value);
  const matches = serialized.match(/[A-Za-z0-9_./:-]+/g);
  return matches ? matches.length : 0;
};

const normalizeRiskCallSiteDetails = (row) => {
  if (!row || typeof row !== 'object') return null;
  return {
    callSiteId: row.callSiteId || null,
    file: row.file || null,
    languageId: row.languageId || null,
    startLine: Number.isFinite(row.startLine) ? row.startLine : null,
    startCol: Number.isFinite(row.startCol) ? row.startCol : null,
    endLine: Number.isFinite(row.endLine) ? row.endLine : null,
    endCol: Number.isFinite(row.endCol) ? row.endCol : null,
    calleeRaw: row.calleeRaw || null,
    calleeNormalized: row.calleeNormalized || null,
    args: Array.isArray(row.args) ? row.args.slice(0, CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP) : []
  };
};

const resolveRiskCallSiteExcerpt = ({ row, repoRoot }) => {
  if (!row?.file || !repoRoot) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'unavailable' }
    };
  }
  const filePath = path.resolve(repoRoot, row.file);
  if (!isPathInsideRepo(repoRoot, filePath)) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'outside-repo' }
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'missing-file' }
    };
  }
  if (!Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end <= row.start) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'missing-range' }
    };
  }
  const resolvedExcerpt = resolveExcerpt({
    filePath,
    start: row.start,
    end: row.end,
    maxBytes: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
    maxTokens: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS
  });
  return {
    excerpt: resolvedExcerpt.excerpt || null,
    excerptHash: resolvedExcerpt.excerptHash || null,
    excerptTruncated: resolvedExcerpt.truncated === true,
    excerptTruncation: {
      bytes: resolvedExcerpt.truncatedBytes === true,
      tokens: resolvedExcerpt.truncatedTokens === true
    },
    provenance: {
      artifact: 'call_sites',
      excerptSource: 'repo-range',
      maxBytes: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
      maxTokens: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS
    }
  };
};

const hydrateRiskCallSiteDetails = ({ row, repoRoot }) => {
  const base = normalizeRiskCallSiteDetails(row);
  if (!base) return { details: null, excerptTruncated: false };
  const excerpt = resolveRiskCallSiteExcerpt({ row, repoRoot });
  return {
    details: {
      ...base,
      excerpt: excerpt.excerpt,
      excerptHash: excerpt.excerptHash,
      excerptTruncated: excerpt.excerptTruncated,
      excerptTruncation: excerpt.excerptTruncation,
      provenance: excerpt.provenance
    },
    excerptTruncated: excerpt.excerptTruncated,
    excerptTruncation: excerpt.excerptTruncation
  };
};

const buildRiskCaps = ({ stats, counts, hits }) => ({
  maxFlows: CONTEXT_PACK_MAX_RISK_FLOWS,
  maxStepsPerFlow: CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW,
  maxCallSitesPerStep: CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP,
  maxCallSiteExcerptBytes: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
  maxCallSiteExcerptTokens: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS,
  maxBytes: CONTEXT_PACK_MAX_RISK_BYTES,
  maxTokens: CONTEXT_PACK_MAX_RISK_TOKENS,
  configured: stats?.effectiveConfig?.caps || null,
  observed: {
    candidateFlows: counts.candidateFlows,
    selectedFlows: counts.selectedFlows,
    omittedFlows: counts.omittedFlows,
    emittedSteps: counts.emittedSteps,
    omittedSteps: counts.omittedSteps,
    omittedCallSites: counts.omittedCallSites,
    truncatedCallSiteExcerpts: counts.truncatedCallSiteExcerpts,
    bytes: counts.bytes,
    tokens: counts.tokens
  },
  hits: Array.from(hits)
});

const buildRiskAnalysisStatus = ({ status, reason, degraded, summaryOnly, code = 'ok', strictFailure = false, artifactStatus, stats, caps, degradedReasons }) => ({
  requested: true,
  status,
  reason,
  degraded,
  summaryOnly,
  code,
  strictFailure,
  artifactStatus,
  degradedReasons,
  flowsEmitted: stats?.flowsEmitted ?? null,
  uniqueCallSitesReferenced: stats?.uniqueCallSitesReferenced ?? null,
  capsHit: Array.from(new Set([...(Array.isArray(stats?.capsHit) ? stats.capsHit : []), ...(Array.isArray(caps?.hits) ? caps.hits : [])]))
});

const buildRiskSlice = ({
  indexDir,
  repoRoot,
  seedRef,
  primaryChunk,
  chunkIndex,
  riskFilters = null,
  indexSignature = null,
  indexCompatKey = null,
  warnings,
  truncation
}) => {
  const riskSeedContext = {
    primaryChunkUid: primaryChunk?.chunkUid || primaryChunk?.metaV2?.chunkUid || null,
    primaryRef: primaryChunk?.chunkUid || primaryChunk?.metaV2?.chunkUid
      ? { type: 'chunk', chunkUid: primaryChunk.chunkUid || primaryChunk.metaV2?.chunkUid }
      : (primaryChunk?.file ? { type: 'file', path: primaryChunk.file } : null),
    candidates: resolveChunkCandidatesBySeed(seedRef, chunkIndex)
  };
  if (!riskSeedContext.candidates.length && riskSeedContext.primaryChunkUid) {
    riskSeedContext.candidates.push({
      ref: riskSeedContext.primaryRef,
      chunk: primaryChunk,
      chunkUid: riskSeedContext.primaryChunkUid,
      candidateIndex: 0
    });
  }
  if (!indexDir || !riskSeedContext.candidates.length) {
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice unavailable because no index directory or risk seed anchor was resolved.'
    });
    return {
      status: 'missing',
      reason: 'no-index-or-risk-anchor',
      anchor: {
        kind: 'unresolved',
        chunkUid: riskSeedContext.primaryChunkUid || null,
        ref: riskSeedContext.primaryRef || null,
        alternateCount: 0,
        alternates: []
      },
      flows: [],
      summary: null,
      stats: null,
      analysisStatus: {
        requested: true,
        status: 'missing',
        reason: 'no-index-or-risk-anchor',
        degraded: true,
        summaryOnly: false,
        code: 'missing',
        strictFailure: true,
        artifactStatus: null,
        degradedReasons: ['missing-risk-anchor'],
        flowsEmitted: null,
        uniqueCallSitesReferenced: null,
        capsHit: []
      },
      degraded: true
    };
  }

  let manifest = null;
  try {
    manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  } catch (err) {
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice unavailable because pieces manifest could not be loaded.',
      data: { error: err?.message || String(err) }
    });
    return {
      status: 'missing',
      reason: 'missing-manifest',
      anchor: {
        kind: 'unresolved',
        chunkUid: riskSeedContext.primaryChunkUid || null,
        ref: riskSeedContext.primaryRef || riskSeedContext.candidates[0]?.ref || null,
        alternateCount: 0,
        alternates: []
      },
      flows: [],
      summary: null,
      stats: null,
      analysisStatus: {
        requested: true,
        status: 'missing',
        reason: 'missing-manifest',
        degraded: true,
        summaryOnly: false,
        code: 'missing',
        strictFailure: true,
        artifactStatus: null,
        degradedReasons: ['missing-manifest'],
        flowsEmitted: null,
        uniqueCallSitesReferenced: null,
        capsHit: []
      },
      degraded: true
    };
  }

  const statsPresence = resolveArtifactPresence(indexDir, 'risk_interprocedural_stats', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const summariesPresence = resolveArtifactPresence(indexDir, 'risk_summaries', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const flowsPresence = resolveArtifactPresence(indexDir, 'risk_flows', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const callSitesPresence = resolveArtifactPresence(indexDir, 'call_sites', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });

  const statsMissing = statsPresence.format === 'missing' || statsPresence.missingMeta || statsPresence.missingPaths.length > 0;
  const summariesMissing = summariesPresence.format === 'missing' || summariesPresence.missingMeta || summariesPresence.missingPaths.length > 0;
  let statsLoadFailed = false;
  let summariesLoadFailed = false;
  let flowsLoadFailed = false;
  let callSitesLoadFailed = false;
  const riskTruncation = [];
  if (statsMissing && summariesMissing) {
    const artifactStatus = {
      stats: buildRiskArtifactStatus({ presence: statsPresence, required: true }),
      summaries: buildRiskArtifactStatus({ presence: summariesPresence, required: true }),
      flows: buildRiskArtifactStatus({ presence: flowsPresence, required: false }),
      callSites: buildRiskArtifactStatus({ presence: callSitesPresence, required: false })
    };
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice unavailable because interprocedural stats and summaries artifacts are missing.'
    });
    return {
      status: 'missing',
      reason: 'missing-risk-artifacts',
      anchor: {
        kind: 'unresolved',
        chunkUid: riskSeedContext.primaryChunkUid || null,
        ref: riskSeedContext.primaryRef || riskSeedContext.candidates[0]?.ref || null,
        alternateCount: 0,
        alternates: []
      },
      flows: [],
      summary: null,
      stats: null,
      analysisStatus: {
        requested: true,
        status: 'missing',
        reason: 'missing-risk-artifacts',
        summaryOnly: false,
        code: 'missing',
        strictFailure: true,
        artifactStatus,
        degradedReasons: ['missing-risk-artifacts']
      },
      caps: null,
      truncation: [],
      provenance: normalizeRiskProvenance({ manifest, stats: null, artifactStatus, indexSignature, indexCompatKey }),
      degraded: true
    };
  }

  let stats = null;
  if (!statsMissing) {
    try {
      stats = loadJsonObjectArtifactSync(indexDir, 'risk_interprocedural_stats', {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
    } catch (err) {
      statsLoadFailed = true;
      const failureClass = classifyRiskLoadFailure(err);
      warnings.push({
        code: failureClass === 'timed_out'
          ? 'RISK_STATS_TIMED_OUT'
          : failureClass === 'schema_invalid'
            ? 'RISK_STATS_SCHEMA_INVALID'
            : 'RISK_STATS_LOAD_FAILED',
        message: 'Risk stats artifact could not be loaded.',
        data: { error: err?.message || String(err) }
      });
    }
  }

  let summary = null;
  let summaryRows = [];
  if (!summariesMissing) {
    try {
      summaryRows = loadJsonArrayArtifactSync(indexDir, 'risk_summaries', {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
    } catch (err) {
      summariesLoadFailed = true;
      const failureClass = classifyRiskLoadFailure(err);
      warnings.push({
        code: failureClass === 'timed_out'
          ? 'RISK_SUMMARIES_TIMED_OUT'
          : failureClass === 'schema_invalid'
            ? 'RISK_SUMMARIES_SCHEMA_INVALID'
            : 'RISK_SUMMARIES_LOAD_FAILED',
        message: 'Risk summaries artifact could not be loaded.',
        data: { error: err?.message || String(err) }
      });
    }
  }
  const summaryRowsByChunkUid = new Map();
  for (const row of Array.isArray(summaryRows) ? summaryRows : []) {
    if (row?.chunkUid && !summaryRowsByChunkUid.has(row.chunkUid)) {
      summaryRowsByChunkUid.set(row.chunkUid, row);
    }
  }
  summary = summaryRowsByChunkUid.get(riskSeedContext.primaryChunkUid) || null;

  const summaryOnly = stats?.effectiveConfig?.summaryOnly === true;
  const baseArtifactStatus = {
    stats: buildRiskArtifactStatus({ presence: statsPresence, required: true, loadFailed: statsLoadFailed }),
    summaries: buildRiskArtifactStatus({ presence: summariesPresence, required: true, loadFailed: summariesLoadFailed }),
    flows: buildRiskArtifactStatus({
      presence: flowsPresence,
      required: !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: flowsLoadFailed
    }),
    callSites: buildRiskArtifactStatus({ presence: callSitesPresence, required: false, loadFailed: callSitesLoadFailed })
  };
  const baseStatus = stats?.status === 'disabled'
    ? 'disabled'
    : summaryOnly
      ? 'summary_only'
      : stats
        ? 'ok'
        : 'missing';

  if (baseStatus === 'disabled') {
    const riskCaps = buildRiskCaps({
      stats,
      counts: {
        candidateFlows: 0,
        selectedFlows: 0,
        omittedFlows: 0,
        emittedSteps: 0,
        omittedSteps: 0,
        omittedCallSites: 0,
        bytes: 0,
        tokens: 0
      },
      hits: new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : [])
    });
    return {
      version: 1,
      status: 'disabled',
      reason: stats?.reason || 'disabled',
      anchor: {
        kind: 'unresolved',
        chunkUid: riskSeedContext.primaryChunkUid || null,
        ref: riskSeedContext.primaryRef || riskSeedContext.candidates[0]?.ref || null,
        alternateCount: 0,
        alternates: []
      },
      flows: [],
      summary: normalizeRiskSummary(summary, []),
      stats: summarizeRiskStats(stats),
      analysisStatus: buildRiskAnalysisStatus({
        status: 'disabled',
        reason: stats?.reason || 'disabled',
        degraded: false,
        summaryOnly,
        code: 'disabled',
        strictFailure: true,
        artifactStatus: baseArtifactStatus,
        stats: summarizeRiskStats(stats),
        caps: riskCaps,
        degradedReasons: []
      }),
      caps: riskCaps,
      truncation: [],
      filters: riskFilters,
      provenance: normalizeRiskProvenance({ manifest, stats, artifactStatus: baseArtifactStatus, indexSignature, indexCompatKey }),
      degraded: false
    };
  }

  if (baseStatus === 'summary_only') {
    const riskCaps = buildRiskCaps({
      stats,
      counts: {
        candidateFlows: 0,
        selectedFlows: 0,
        omittedFlows: 0,
        emittedSteps: 0,
        omittedSteps: 0,
        omittedCallSites: 0,
        bytes: 0,
        tokens: 0
      },
      hits: new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : [])
    });
    return {
      version: 1,
      status: 'summary_only',
      reason: stats?.reason || null,
      anchor: {
        kind: 'unresolved',
        chunkUid: riskSeedContext.primaryChunkUid || null,
        ref: riskSeedContext.primaryRef || riskSeedContext.candidates[0]?.ref || null,
        alternateCount: 0,
        alternates: []
      },
      flows: [],
      summary: normalizeRiskSummary(summary, []),
      stats: summarizeRiskStats(stats),
      analysisStatus: buildRiskAnalysisStatus({
        status: 'summary_only',
        reason: stats?.reason || null,
        degraded: false,
        summaryOnly,
        code: 'summary_only',
        strictFailure: true,
        artifactStatus: baseArtifactStatus,
        stats: summarizeRiskStats(stats),
        caps: riskCaps,
        degradedReasons: []
      }),
      caps: riskCaps,
      truncation: [],
      filters: riskFilters,
      provenance: normalizeRiskProvenance({ manifest, stats, artifactStatus: baseArtifactStatus, indexSignature, indexCompatKey }),
      degraded: false
    };
  }

  let degraded = false;
  let flows = [];
  const riskCandidateChunkUids = new Set(riskSeedContext.candidates.map((entry) => entry.chunkUid).filter(Boolean));
  const flowsMissing = flowsPresence.format === 'missing' || flowsPresence.missingMeta || flowsPresence.missingPaths.length > 0;
  const callSitesMissing = callSitesPresence.format === 'missing' || callSitesPresence.missingMeta || callSitesPresence.missingPaths.length > 0;
  if (!flowsMissing) {
    try {
      const flowRows = loadJsonArrayArtifactSync(indexDir, 'risk_flows', {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
      const relevantFlows = Array.isArray(flowRows)
        ? flowRows.filter((flow) => {
          const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
          if (flow?.source?.chunkUid && riskCandidateChunkUids.has(flow.source.chunkUid)) return true;
          if (flow?.sink?.chunkUid && riskCandidateChunkUids.has(flow.sink.chunkUid)) return true;
          return chunkUids.some((chunkUid) => riskCandidateChunkUids.has(chunkUid));
        })
        : [];
      flows = filterRiskFlows(relevantFlows, riskFilters);
    } catch (err) {
      flowsLoadFailed = true;
      const failureClass = classifyRiskLoadFailure(err);
      warnings.push({
        code: failureClass === 'timed_out'
          ? 'RISK_FLOWS_TIMED_OUT'
          : failureClass === 'schema_invalid'
            ? 'RISK_FLOWS_SCHEMA_INVALID'
            : 'RISK_FLOWS_LOAD_FAILED',
        message: 'Risk flows artifact could not be loaded.',
        data: { error: err?.message || String(err) }
      });
      degraded = true;
    }
  } else if (stats?.counts?.flowsEmitted > 0) {
    warnings.push({
      code: 'RISK_FLOWS_MISSING',
      message: 'Risk stats report emitted flows, but the risk_flows artifact is missing.'
    });
    degraded = true;
  }

  const preAnchorRankedFlows = rankRiskFlows(flows, null);
  const resolvedAnchor = resolveRiskAnchor({
    rankedFlows: preAnchorRankedFlows,
    riskSeedContext,
    warnings
  });
  const selectedAnchor = {
    kind: resolvedAnchor.selected.kind,
    chunkUid: resolvedAnchor.selected.chunkUid || null,
    ref: resolvedAnchor.selected.ref || null,
    flowId: resolvedAnchor.selected.flowId || null,
    alternateCount: resolvedAnchor.alternates.length,
    alternates: resolvedAnchor.alternates.slice(0, 5).map((entry) => ({
      kind: entry.kind,
      chunkUid: entry.chunkUid,
      ref: entry.ref,
      flowId: entry.flowId || null
    }))
  };
  if (!summary && selectedAnchor.chunkUid) {
    summary = summaryRowsByChunkUid.get(selectedAnchor.chunkUid) || null;
  }
  const rankedFlows = rankRiskFlows(flows, selectedAnchor);
  const referencedCallSiteIds = new Set();
  const selectedRawFlows = [];
  const riskCapHits = new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : []);
  let emittedBytes = 0;
  let emittedTokens = 0;
  let emittedSteps = 0;
  let omittedSteps = 0;
  let omittedCallSites = 0;
  let truncatedCallSiteExcerptBytes = 0;
  let truncatedCallSiteExcerptTokens = 0;
  let omittedFlows = 0;
  let maxFlowTruncationRecorded = false;
  let budgetTruncationRecorded = false;

  for (const entry of rankedFlows) {
    if (selectedRawFlows.length >= CONTEXT_PACK_MAX_RISK_FLOWS) {
      omittedFlows += 1;
      if (!maxFlowTruncationRecorded) {
        const record = {
          scope: 'risk',
          cap: 'maxFlows',
          limit: CONTEXT_PACK_MAX_RISK_FLOWS,
          observed: rankedFlows.length,
          omitted: rankedFlows.length - CONTEXT_PACK_MAX_RISK_FLOWS,
          note: 'Risk flows truncated for composite context pack.'
        };
        truncation.push(record);
        riskTruncation.push(record);
        maxFlowTruncationRecorded = true;
      }
      riskCapHits.add('maxFlows');
      continue;
    }

    const flow = entry.flow;
    const rawSteps = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
    const limitedSteps = rawSteps.slice(0, CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW);
    if (rawSteps.length > limitedSteps.length) {
      const omitted = rawSteps.length - limitedSteps.length;
      omittedSteps += omitted;
      riskCapHits.add('maxStepsPerFlow');
      const record = {
        scope: 'risk',
        cap: 'maxStepsPerFlow',
        limit: CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW,
        observed: rawSteps.length,
        omitted,
        note: `Risk flow ${flow?.flowId || 'flow'} truncated to the configured step budget.`
      };
      truncation.push(record);
      riskTruncation.push(record);
    }

    const normalizedStepIds = limitedSteps.map((ids) => {
      const sourceIds = Array.isArray(ids) ? ids : [];
      const limitedIds = sourceIds.slice(0, CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP);
      if (sourceIds.length > limitedIds.length) {
        const omitted = sourceIds.length - limitedIds.length;
        omittedCallSites += omitted;
        riskCapHits.add('maxCallSitesPerStep');
        const record = {
          scope: 'risk',
          cap: 'maxCallSitesPerStep',
          limit: CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP,
          observed: sourceIds.length,
          omitted,
          note: `Risk flow ${flow?.flowId || 'flow'} truncated call-site evidence for one path step.`
        };
        truncation.push(record);
        riskTruncation.push(record);
      }
      for (const callSiteId of limitedIds) {
        if (callSiteId) referencedCallSiteIds.add(callSiteId);
      }
      return limitedIds;
    });

    const candidate = {
      rank: entry.rank,
      flowId: flow?.flowId || null,
      source: flow?.source && typeof flow.source === 'object'
        ? {
          chunkUid: flow.source.chunkUid || null,
          ruleId: flow.source.ruleId || null,
          ruleName: flow.source.ruleName || null,
          ruleType: flow.source.ruleType || null,
          category: flow.source.category || null,
          severity: flow.source.severity || null,
          confidence: Number.isFinite(flow.source.confidence) ? flow.source.confidence : null
        }
        : null,
      sink: flow?.sink && typeof flow.sink === 'object'
        ? {
          chunkUid: flow.sink.chunkUid || null,
          ruleId: flow.sink.ruleId || null,
          ruleName: flow.sink.ruleName || null,
          ruleType: flow.sink.ruleType || null,
          category: flow.sink.category || null,
          severity: flow.sink.severity || null,
          confidence: Number.isFinite(flow.sink.confidence) ? flow.sink.confidence : null
        }
        : null,
      category: flow?.sink?.category || flow?.source?.category || null,
      severity: flow?.sink?.severity || flow?.source?.severity || null,
      confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
      score: {
        seedRelevance: entry.score.seedRelevance,
        severity: entry.score.severity,
        confidence: Number.isFinite(entry.score.confidence) ? entry.score.confidence : null,
        hopCount: Number.isFinite(flow?.notes?.hopCount) ? flow.notes.hopCount : null
      },
      path: {
        nodes: normalizeRiskPathNodes(flow),
        stepCount: rawSteps.length,
        truncatedSteps: rawSteps.length - limitedSteps.length,
        callSiteIdsByStep: normalizedStepIds
      },
      evidence: {
        sourceRuleId: flow?.source?.ruleId || null,
        sinkRuleId: flow?.sink?.ruleId || null,
        callSitesByStep: normalizedStepIds.map((ids) => ids.map((callSiteId) => ({
          callSiteId,
          details: null
        })))
      },
      notes: flow?.notes && typeof flow.notes === 'object'
        ? {
          strictness: flow.notes.strictness || null,
          sanitizerPolicy: flow.notes.sanitizerPolicy || null,
          hopCount: Number.isFinite(flow.notes.hopCount) ? flow.notes.hopCount : null,
          sanitizerBarriersHit: Number.isFinite(flow.notes.sanitizerBarriersHit)
            ? flow.notes.sanitizerBarriersHit
            : null,
          capsHit: Array.isArray(flow.notes.capsHit) ? flow.notes.capsHit.slice() : []
        }
        : null
    };

    const candidateBytes = estimateRiskByteSize(candidate);
    const candidateTokens = estimateRiskTokenCount(candidate);
    if ((emittedBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_BYTES
      || (emittedTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_TOKENS) {
      omittedFlows += 1;
      if (!budgetTruncationRecorded) {
        const byteOmitted = (emittedBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_BYTES;
        const tokenOmitted = (emittedTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_TOKENS;
        if (byteOmitted) {
          const record = {
            scope: 'risk',
            cap: 'maxRiskBytes',
            limit: CONTEXT_PACK_MAX_RISK_BYTES,
            observed: emittedBytes + candidateBytes,
            omitted: candidateBytes,
            note: 'Risk flow budget hit the total serialized byte cap.'
          };
          truncation.push(record);
          riskTruncation.push(record);
          riskCapHits.add('maxRiskBytes');
        }
        if (tokenOmitted) {
          const record = {
            scope: 'risk',
            cap: 'maxRiskTokens',
            limit: CONTEXT_PACK_MAX_RISK_TOKENS,
            observed: emittedTokens + candidateTokens,
            omitted: candidateTokens,
            note: 'Risk flow budget hit the total token cap.'
          };
          truncation.push(record);
          riskTruncation.push(record);
          riskCapHits.add('maxRiskTokens');
        }
        budgetTruncationRecorded = true;
      }
      continue;
    }

    emittedBytes += candidateBytes;
    emittedTokens += candidateTokens;
    emittedSteps += normalizedStepIds.length;
    selectedRawFlows.push(candidate);
  }

  const callSiteById = new Map();
  if (referencedCallSiteIds.size > 0 && !callSitesMissing) {
    try {
      const callSiteRows = loadJsonArrayArtifactSync(indexDir, 'call_sites', {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
      const relevantRows = Array.isArray(callSiteRows)
        ? callSiteRows.filter((row) => row?.callSiteId && referencedCallSiteIds.has(row.callSiteId))
        : [];
      prefetchFileRanges(relevantRows
        .filter((row) => row?.file && Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
        .map((row) => ({
          filePath: path.resolve(repoRoot, row.file),
          start: row.start,
          end: row.end
        })));
      for (const row of relevantRows) {
        if (row?.callSiteId && referencedCallSiteIds.has(row.callSiteId)) {
          const hydrated = hydrateRiskCallSiteDetails({ row, repoRoot });
          if (hydrated.details) {
            callSiteById.set(row.callSiteId, hydrated.details);
          }
          if (hydrated.excerptTruncation?.bytes) truncatedCallSiteExcerptBytes += 1;
          if (hydrated.excerptTruncation?.tokens) truncatedCallSiteExcerptTokens += 1;
        }
      }
    } catch (err) {
      callSitesLoadFailed = true;
      const failureClass = classifyRiskLoadFailure(err);
      warnings.push({
        code: failureClass === 'timed_out'
          ? 'RISK_CALL_SITES_TIMED_OUT'
          : failureClass === 'schema_invalid'
            ? 'RISK_CALL_SITES_SCHEMA_INVALID'
            : 'RISK_CALL_SITES_LOAD_FAILED',
        message: 'Call-site evidence artifact could not be loaded for risk flows.',
        data: { error: err?.message || String(err) }
      });
      degraded = true;
    }
  } else if (referencedCallSiteIds.size > 0 && callSitesMissing) {
    warnings.push({
      code: 'RISK_CALL_SITES_MISSING',
      message: 'Risk flows reference call-site evidence, but the call_sites artifact is missing.'
    });
    degraded = true;
  }

  if (truncatedCallSiteExcerptBytes > 0) {
    riskCapHits.add('maxCallSiteExcerptBytes');
    const record = {
      scope: 'risk',
      cap: 'maxCallSiteExcerptBytes',
      limit: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
      observed: truncatedCallSiteExcerptBytes,
      omitted: truncatedCallSiteExcerptBytes,
      note: 'Risk call-site excerpts were truncated to the configured per-call-site byte budget.'
    };
    truncation.push(record);
    riskTruncation.push(record);
  }
  if (truncatedCallSiteExcerptTokens > 0) {
    riskCapHits.add('maxCallSiteExcerptTokens');
    const record = {
      scope: 'risk',
      cap: 'maxCallSiteExcerptTokens',
      limit: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS,
      observed: truncatedCallSiteExcerptTokens,
      omitted: truncatedCallSiteExcerptTokens,
      note: 'Risk call-site excerpts were truncated to the configured per-call-site token budget.'
    };
    truncation.push(record);
    riskTruncation.push(record);
  }

  const normalizedFlows = selectedRawFlows.map((flow) => ({
    ...flow,
    evidence: {
      ...flow.evidence,
      callSitesByStep: flow.evidence.callSitesByStep.map((step) => step.map((entry) => ({
        ...entry,
        details: callSiteById.get(entry.callSiteId) || null
      })))
    }
  }));

  const status = degraded ? 'degraded' : baseStatus;
  const resolvedArtifactStatus = {
    ...baseArtifactStatus,
    flows: buildRiskArtifactStatus({
      presence: flowsPresence,
      required: !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: flowsLoadFailed
    }),
    callSites: buildRiskArtifactStatus({
      presence: callSitesPresence,
      required: referencedCallSiteIds.size > 0,
      loadFailed: callSitesLoadFailed
    })
  };
  const normalizedSummary = normalizeRiskSummary(summary, normalizedFlows);
  const riskCaps = buildRiskCaps({
    stats,
    counts: {
      candidateFlows: rankedFlows.length,
      selectedFlows: normalizedFlows.length,
      omittedFlows,
      emittedSteps,
      omittedSteps,
      omittedCallSites,
      truncatedCallSiteExcerpts: truncatedCallSiteExcerptBytes + truncatedCallSiteExcerptTokens,
      bytes: emittedBytes,
      tokens: emittedTokens
    },
    hits: riskCapHits
  });
  const degradedReasons = warnings
    .filter((entry) => typeof entry?.code === 'string' && entry.code.startsWith('RISK_'))
    .map((entry) => entry.code);
  let statusCode = 'ok';
  if (degradedReasons.some((entry) => entry.endsWith('_TIMED_OUT'))) {
    statusCode = 'timed_out';
  } else if (degradedReasons.some((entry) => entry.endsWith('_SCHEMA_INVALID'))) {
    statusCode = 'schema_invalid';
  } else if (degradedReasons.includes('RISK_CALL_SITES_MISSING') || degradedReasons.includes('RISK_FLOWS_MISSING')) {
    statusCode = 'missing';
  } else if (degraded) {
    statusCode = 'degraded';
  }
  if (!degraded && (riskCaps.hits.length || riskTruncation.length)) {
    statusCode = 'capped';
  }
  const strictFailure = statusCode !== 'ok';
  return {
    version: 1,
    status,
    reason: degraded ? 'partial-artifacts' : (stats?.reason || null),
    anchor: selectedAnchor,
    filters: riskFilters,
    flows: normalizedFlows,
    summary: normalizedSummary,
    stats: summarizeRiskStats(stats),
    analysisStatus: buildRiskAnalysisStatus({
      status,
      reason: degraded ? 'partial-artifacts' : (stats?.reason || null),
      degraded,
      summaryOnly,
      code: statusCode,
      strictFailure,
      artifactStatus: resolvedArtifactStatus,
      stats: summarizeRiskStats(stats),
      caps: riskCaps,
      degradedReasons
    }),
    caps: riskCaps,
    truncation: riskTruncation,
    provenance: normalizeRiskProvenance({ manifest, stats, artifactStatus: resolvedArtifactStatus, indexSignature, indexCompatKey }),
    degraded
  };
};

const trimUtf8Buffer = (buffer) => {
  let end = buffer.length;
  while (end > 0 && (buffer[end - 1] & 0xC0) === 0x80) {
    end -= 1;
  }
  if (end === 0) return buffer.subarray(0, 0);
  const lead = buffer[end - 1];
  let needed = 1;
  if ((lead & 0x80) === 0) needed = 1;
  else if ((lead & 0xE0) === 0xC0) needed = 2;
  else if ((lead & 0xF0) === 0xE0) needed = 3;
  else if ((lead & 0xF8) === 0xF0) needed = 4;
  if (end - 1 + needed <= buffer.length) {
    return buffer;
  }
  return buffer.subarray(0, Math.max(0, end - 1));
};

// Excerpt caches avoid repeated IO and token slicing for identical ranges.
const EXCERPT_CACHE_MAX = 128;
const FILE_RANGE_CACHE_MAX = 64;
const EXCERPT_HASH_CACHE_MAX = 256;
const UTF8_TRUNCATION_DETECTION_SLACK_BYTES = 4;
const excerptCache = new Map();
const fileRangeCache = new Map();
const excerptHashCache = new Map();

export const clearContextPackCaches = () => {
  excerptCache.clear();
  fileRangeCache.clear();
  excerptHashCache.clear();
};

const getCachedValue = (cache, key) => {
  if (!key) return null;
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setCachedValue = (cache, key, value, maxSize) => {
  if (!key) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const getFileCacheFingerprint = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return `${stats.size}:${Number.isFinite(stats.mtimeMs) ? Math.trunc(stats.mtimeMs) : 0}`;
  } catch {
    return 'missing';
  }
};

const readFilePrefix = (filePath, maxBytes) => {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return '';
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(maxBytes + UTF8_TRUNCATION_DETECTION_SLACK_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const slice = trimUtf8Buffer(buffer.subarray(0, bytesRead));
    return slice.toString('utf8');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
};

const readFileRangeCached = (filePath, start, end) => {
  const key = `${filePath}|${getFileCacheFingerprint(filePath)}|${start}|${end}`;
  const cached = getCachedValue(fileRangeCache, key);
  if (cached != null) return cached;
  const buffer = readFileRangeSync(filePath, start, end);
  const text = trimUtf8Buffer(buffer).toString('utf8');
  setCachedValue(fileRangeCache, key, text, FILE_RANGE_CACHE_MAX);
  return text;
};

const prefetchFileRanges = (ranges) => {
  if (!Array.isArray(ranges) || !ranges.length) return;
  for (const range of ranges) {
    if (!range?.filePath) continue;
    const key = `${range.filePath}|${getFileCacheFingerprint(range.filePath)}|${range.start}|${range.end}`;
    if (fileRangeCache.has(key)) continue;
    try {
      const buffer = readFileRangeSync(range.filePath, range.start, range.end);
      const text = trimUtf8Buffer(buffer).toString('utf8');
      setCachedValue(fileRangeCache, key, text, FILE_RANGE_CACHE_MAX);
    } catch {
      // Best-effort prefetch.
    }
  }
};

const isPathInsideRepo = (repoRoot, filePath) => {
  const relative = path.relative(repoRoot, filePath);
  if (!relative) return true;
  if (isRelativePathEscape(relative)) return false;
  return !path.isAbsolute(relative);
};

const sliceExcerpt = (text, maxBytes, maxTokens) => {
  let excerpt = text;
  let truncated = false;
  let truncatedBytes = false;
  let truncatedTokens = false;
  if (maxBytes != null && maxBytes > 0) {
    const buffer = Buffer.from(excerpt, 'utf8');
    if (buffer.length > maxBytes) {
      const safe = trimUtf8Buffer(buffer.subarray(0, maxBytes));
      excerpt = safe.toString('utf8');
      truncated = true;
      truncatedBytes = true;
    }
  }
  if (maxTokens != null && maxTokens > 0) {
    const tokens = excerpt.split(/\s+/).filter(Boolean);
    if (tokens.length > maxTokens) {
      excerpt = tokens.slice(0, maxTokens).join(' ');
      truncated = true;
      truncatedTokens = true;
    }
  }
  return { excerpt, truncated, truncatedBytes, truncatedTokens };
};

const resolveExcerpt = ({
  filePath,
  start,
  end,
  maxBytes,
  maxTokens
}) => {
  const cacheKeyInfo = buildLocalCacheKey({
    namespace: 'context-pack-excerpt',
    payload: {
      filePath,
      fileFingerprint: getFileCacheFingerprint(filePath),
      start: start ?? null,
      end: end ?? null,
      maxBytes: maxBytes ?? null,
      maxTokens: maxTokens ?? null
    }
  });
  const cached = getCachedValue(excerptCache, cacheKeyInfo.key);
  if (cached) return cached;
  let text = '';
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const safeMaxBytes = normalizeOptionalNumber(maxBytes);
    const readEnd = safeMaxBytes
      ? Math.min(end, start + safeMaxBytes + UTF8_TRUNCATION_DETECTION_SLACK_BYTES)
      : end;
    prefetchFileRanges([{ filePath, start, end: readEnd }]);
    text = readFileRangeCached(filePath, start, readEnd);
  } else {
    text = readFilePrefix(filePath, normalizeOptionalNumber(maxBytes));
  }
  const { excerpt, truncated, truncatedBytes, truncatedTokens } = sliceExcerpt(text, maxBytes, maxTokens);
  const excerptHash = excerpt ? `sha1:${sha1(excerpt)}` : null;
  let deduped = excerpt;
  if (excerptHash) {
    const cached = getCachedValue(excerptHashCache, excerptHash);
    if (cached) {
      deduped = cached;
    } else {
      setCachedValue(excerptHashCache, excerptHash, excerpt, EXCERPT_HASH_CACHE_MAX);
    }
  }
  const payload = { excerpt: deduped, truncated, excerptHash, truncatedBytes, truncatedTokens };
  setCachedValue(excerptCache, cacheKeyInfo.key, payload, EXCERPT_CACHE_MAX);
  return payload;
};

const buildPrimaryExcerpt = ({ chunk, repoRoot, maxBytes, maxTokens, warnings }) => {
  if (!chunk) {
    warnings.push({ code: 'MISSING_PRIMARY', message: 'Primary chunk not found for seed.' });
    return { excerpt: '', excerptHash: null, file: null, range: null, truncated: false };
  }
  const filePath = chunk.file ? path.resolve(repoRoot, chunk.file) : null;
  let text = '';
  let excerpt = '';
  let excerptHash = null;
  let truncated = false;
  if (filePath) {
    if (!isPathInsideRepo(repoRoot, filePath)) {
      warnings.push({
        code: 'PRIMARY_PATH_OUTSIDE_REPO',
        message: 'Primary chunk path resolves outside repo root.'
      });
    } else if (fs.existsSync(filePath)) {
      const maxBytesNum = normalizeOptionalNumber(maxBytes);
      const maxTokensNum = normalizeOptionalNumber(maxTokens);
      const resolvedExcerpt = resolveExcerpt({
        filePath,
        start: Number.isFinite(chunk.start) ? chunk.start : null,
        end: Number.isFinite(chunk.end) ? chunk.end : null,
        maxBytes: maxBytesNum,
        maxTokens: maxTokensNum
      });
      excerpt = resolvedExcerpt.excerpt || '';
      truncated = resolvedExcerpt.truncated;
      excerptHash = resolvedExcerpt.excerptHash || null;
    } else {
      warnings.push({
        code: 'PRIMARY_PATH_MISSING',
        message: 'Primary chunk path not found on disk.'
      });
    }
  } else if (chunk.headline) {
    text = String(chunk.headline);
  } else if (chunk.docmeta?.doc) {
    text = String(chunk.docmeta.doc);
  }

  if (!filePath || !excerpt) {
    const { excerpt: sliced, truncated: slicedTruncated } = sliceExcerpt(
      text,
      normalizeOptionalNumber(maxBytes),
      normalizeOptionalNumber(maxTokens)
    );
    excerpt = sliced;
    truncated = truncated || slicedTruncated;
    excerptHash = excerpt ? `sha1:${sha1(excerpt)}` : null;
  }
  if (truncated) {
    warnings.push({
      code: 'PRIMARY_EXCERPT_TRUNCATED',
      message: 'Primary excerpt truncated due to maxBytes/maxTokens.'
    });
  }
  const range = (Number.isFinite(chunk.startLine) || Number.isFinite(chunk.endLine))
    ? {
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : null,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : null
    }
    : null;
  return {
    excerpt,
    excerptHash,
    file: chunk.file || null,
    range,
    truncated
  };
};

const normalizeTypeFacts = (seedRef, chunk, maxTypeEntries, warnings) => {
  if (!chunk?.docmeta?.inferredTypes) {
    warnings.push({
      code: 'MISSING_TYPES',
      message: 'No inferred types found for seed.'
    });
    return [];
  }
  const facts = [];
  const pushFacts = (role, entries) => {
    if (!entries || typeof entries !== 'object') return;
    for (const [name, types] of Object.entries(entries)) {
      const list = Array.isArray(types) ? types : [];
      for (const entry of list) {
        if (!entry?.type) continue;
        facts.push({
          subject: seedRef,
          role: `${role}:${name}`,
          name,
          type: entry.type,
          source: entry.source || null,
          confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
        });
      }
    }
  };
  pushFacts('param', chunk.docmeta.inferredTypes.params);
  pushFacts('field', chunk.docmeta.inferredTypes.fields);
  pushFacts('local', chunk.docmeta.inferredTypes.locals);
  const returns = Array.isArray(chunk.docmeta.inferredTypes.returns)
    ? chunk.docmeta.inferredTypes.returns
    : [];
  for (const entry of returns) {
    if (!entry?.type) continue;
    facts.push({
      subject: seedRef,
      role: 'return',
      name: null,
      type: entry.type,
      source: entry.source || null,
      confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
    });
  }
  facts.sort((a, b) => compareStrings(a.role, b.role) || compareStrings(a.type, b.type));
  if (Number.isFinite(maxTypeEntries) && maxTypeEntries >= 0 && facts.length > maxTypeEntries) {
    warnings.push({
      code: 'TYPES_TRUNCATED',
      message: 'Type facts truncated due to maxTypeEntries.'
    });
    return facts.slice(0, maxTypeEntries);
  }
  return facts;
};

export const assembleCompositeContextPack = ({
  seed = null,
  chunkMeta = null,
  chunkIndex = null,
  repoRoot = process.cwd(),
  graphRelations = null,
  symbolEdges = null,
  callSites = null,
  graphIndex = null,
  includeGraph = true,
  includeTypes = false,
  includeRisk = false,
  riskStrict = false,
  riskFilters = null,
  includeImports = true,
  includeUsages = true,
  includeCallersCallees = true,
  includePaths = false,
  depth = 1,
  maxBytes = null,
  maxTokens = null,
  maxTypeEntries = null,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  now = () => new Date().toISOString()
} = {}) => {
  const timingStart = process.hrtime.bigint();
  const memoryStart = process.memoryUsage();
  const warnings = [];
  const truncation = [];
  const seedRef = resolveSeedRef(seed);
  const normalizedRiskFilters = normalizeRiskFilters(riskFilters);
  const riskFilterValidation = validateRiskFilters(normalizedRiskFilters);
  if (!riskFilterValidation.ok) {
    const error = new Error(`Invalid risk filters: ${riskFilterValidation.errors.join('; ')}`);
    error.code = 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID';
    throw error;
  }
  const resolvedChunkIndex = chunkIndex || buildChunkIndex(chunkMeta);
  const primaryChunk = resolveChunkBySeed(seedRef, resolvedChunkIndex, warnings);
  const primaryRef = resolvePrimaryRef(seedRef, primaryChunk);

  const primary = {
    ref: primaryRef || { type: 'chunk', chunkUid: null },
    file: null,
    range: null,
    excerpt: '',
    excerptHash: null,
    provenance: null
  };
  const excerptPayload = buildPrimaryExcerpt({
    chunk: primaryChunk,
    repoRoot,
    maxBytes,
    maxTokens,
    warnings
  });
  primary.file = excerptPayload.file;
  primary.range = excerptPayload.range;
  primary.excerpt = excerptPayload.excerpt;
  primary.excerptHash = excerptPayload.excerptHash;
  const excerptBytes = primary.excerpt ? Buffer.byteLength(primary.excerpt, 'utf8') : 0;

  let graph = null;
  if (includeGraph && primaryRef) {
    const graphs = [];
    if (includeCallersCallees) graphs.push('callGraph');
    if (includeUsages) graphs.push('usageGraph');
    if (includeImports) graphs.push('importGraph');
    const edgeFilters = graphs.length ? { graphs } : null;
    graph = buildGraphContextPack({
      seed: primaryRef,
      graphRelations,
      symbolEdges,
      callSites,
      graphIndex,
      direction: 'both',
      depth: normalizeLimit(depth, 1),
      edgeFilters,
      caps,
      includePaths,
      indexSignature,
      indexCompatKey,
      repo,
      indexDir,
      now
    });
    if (Array.isArray(graph?.warnings)) {
      warnings.push(...graph.warnings);
    }
    if (Array.isArray(graph?.truncation)) {
      truncation.push(...graph.truncation);
    }
  } else if (includeGraph) {
    warnings.push({ code: 'MISSING_GRAPH', message: 'Graph slice omitted due to missing seed.' });
  }

  let types = null;
  if (includeTypes) {
    const facts = normalizeTypeFacts(primaryRef || seedRef, primaryChunk, maxTypeEntries, warnings);
    types = { facts };
  }

  let risk = null;
  if (includeRisk) {
    risk = buildRiskSlice({
      indexDir,
      repoRoot,
      seedRef,
      primaryChunk,
      chunkIndex: resolvedChunkIndex,
      riskFilters: normalizedRiskFilters,
      indexSignature,
      indexCompatKey,
      warnings,
      truncation
    });
    if (riskStrict && risk?.analysisStatus?.strictFailure) {
      const err = new Error(`Risk slice strict failure: ${risk.analysisStatus.code || risk.status || 'unknown'}`);
      err.code = 'ERR_CONTEXT_PACK_RISK_STRICT';
      err.risk = {
        status: risk.status || null,
        code: risk.analysisStatus.code || null,
        reason: risk.reason || null
      };
      throw err;
    }
  }

  const capsUsed = {
    graph: { ...caps },
    types: Number.isFinite(maxTypeEntries) ? { maxTypeEntries } : {}
  };
  const provenanceResolved = resolveProvenance({
    provenance,
    indexSignature,
    indexCompatKey,
    capsUsed,
    repo,
    indexDir,
    now,
    label: 'CompositeContextPack'
  });

  const memoryEnd = process.memoryUsage();
  const snapshotMemory = (value) => ({
    heapUsed: value.heapUsed,
    rss: value.rss,
    external: value.external,
    arrayBuffers: value.arrayBuffers
  });
  const peakMemory = {
    heapUsed: Math.max(memoryStart.heapUsed, memoryEnd.heapUsed),
    rss: Math.max(memoryStart.rss, memoryEnd.rss),
    external: Math.max(memoryStart.external, memoryEnd.external),
    arrayBuffers: Math.max(memoryStart.arrayBuffers, memoryEnd.arrayBuffers)
  };
  const elapsedMs = Number((process.hrtime.bigint() - timingStart) / 1000000n);

  return {
    version: '1.0.0',
    seed: primaryRef || seedRef || { v: 1, status: 'unresolved', candidates: [], resolved: null },
    provenance: provenanceResolved,
    primary,
    graph,
    types,
    risk,
    truncation: truncation.length ? truncation : null,
    warnings: warnings.length ? warnings : null,
    stats: {
      timing: { elapsedMs },
      memory: {
        start: snapshotMemory(memoryStart),
        end: snapshotMemory(memoryEnd),
        peak: peakMemory
      },
      excerptBytes
    }
  };
};

const resolveChunkUidMapSeedRefs = (seedRef) => {
  if (!seedRef || typeof seedRef !== 'object') return [];
  if (seedRef.type && typeof seedRef.type === 'string') return [seedRef];
  if (!('status' in seedRef)) return [];
  const candidates = resolveSeedCandidates(seedRef);
  const refs = [];
  const seen = new Set();
  const pushUnique = (ref) => {
    if (!ref?.type) return;
    const key = ref.type === 'chunk'
      ? `chunk:${ref.chunkUid || ''}`
      : ref.type === 'file'
        ? `file:${ref.path || ''}`
        : ref.type === 'symbol'
          ? `symbol:${ref.symbolId || ''}`
          : null;
    if (!key || seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const candidate of candidates) {
    if (candidate?.chunkUid) {
      pushUnique({ type: 'chunk', chunkUid: candidate.chunkUid });
    } else if (candidate?.path) {
      pushUnique({ type: 'file', path: candidate.path });
    } else if (candidate?.symbolId) {
      pushUnique({ type: 'symbol', symbolId: candidate.symbolId });
    }
  }
  return refs;
};

const buildChunkUidMapSeedIndex = async ({
  indexDir,
  manifest,
  strict,
  repoRoot
} = {}) => {
  if (!indexDir) return null;
  const byChunkUid = new Map();
  const byFile = new Map();
  let rowsIndexed = 0;
  try {
    for await (const row of loadJsonArrayArtifactRows(indexDir, 'chunk_uid_map', {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict
    })) {
      const chunk = normalizeChunkUidMapRowAsChunk(row);
      if (!chunk) continue;
      rowsIndexed += 1;
      if (chunk.chunkUid && !byChunkUid.has(chunk.chunkUid)) {
        byChunkUid.set(chunk.chunkUid, chunk);
      }
      const normalizedFile = normalizePathForRepo(chunk.file, repoRoot);
      if (normalizedFile) {
        const list = byFile.get(normalizedFile) || [];
        list.push(chunk);
        byFile.set(normalizedFile, list);
      }
    }
  } catch {
    return null;
  }
  return {
    byChunkUid,
    byFile,
    rowsIndexed
  };
};

const normalizeChunkUidMapRowAsChunk = (row) => {
  if (!row || typeof row !== 'object') return null;
  if (!Number.isFinite(row.docId) || !row.chunkUid || !row.file) return null;
  return {
    id: row.docId,
    chunkUid: row.chunkUid,
    chunkId: row.chunkId || null,
    file: row.file,
    start: Number.isFinite(row.start) ? row.start : null,
    end: Number.isFinite(row.end) ? row.end : null,
    startLine: null,
    endLine: null
  };
};

const resolveChunkUidMapSeedCandidatesFromIndex = ({
  seedIndex,
  seedRef,
  repoRoot
} = {}) => {
  if (!seedIndex || !seedRef) return [];
  if (seedRef.type === 'chunk') {
    const chunk = seedRef.chunkUid ? (seedIndex.byChunkUid.get(seedRef.chunkUid) || null) : null;
    return chunk ? [chunk] : [];
  }
  if (seedRef.type === 'file') {
    const normalizedSeedFile = normalizePathForRepo(seedRef.path, repoRoot);
    return normalizedSeedFile ? (seedIndex.byFile.get(normalizedSeedFile) || []) : [];
  }
  return [];
};

/**
 * Provider-based context-pack assembly that avoids materializing full `chunk_meta`.
 *
 * Current implementation uses the `chunk_uid_map` tooling artifact to resolve the seed's
 * primary chunk (file + byte range) and then delegates to `assembleCompositeContextPack`.
 */
export const assembleCompositeContextPackStreaming = async ({
  seed = null,
  chunkMeta = null,
  chunkIndex = null,
  repoRoot = process.cwd(),
  indexDir = null,
  manifest = null,
  strict = true,
  ...rest
} = {}) => {
  if (chunkMeta || chunkIndex) {
    return assembleCompositeContextPack({ seed, chunkMeta, chunkIndex, repoRoot, indexDir, ...rest });
  }
  if (!indexDir) {
    return assembleCompositeContextPack({ seed, chunkMeta: null, chunkIndex: null, repoRoot, indexDir, ...rest });
  }
  const resolvedManifest = manifest || loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict });
  const seedRef = resolveSeedRef(seed);
  const candidates = resolveChunkUidMapSeedRefs(seedRef);
  const seedIndex = candidates.length
    ? await buildChunkUidMapSeedIndex({
      indexDir,
      manifest: resolvedManifest,
      strict,
      repoRoot
    })
    : null;
  const resolvedChunks = [];
  const seenChunkUids = new Set();
  for (const candidate of candidates) {
    const chunks = resolveChunkUidMapSeedCandidatesFromIndex({
      seedIndex,
      seedRef: candidate,
      repoRoot
    });
    for (const chunk of chunks) {
      const chunkUid = chunk?.chunkUid || null;
      if (!chunkUid || seenChunkUids.has(chunkUid)) continue;
      seenChunkUids.add(chunkUid);
      resolvedChunks.push(chunk);
    }
  }
  const chunkMetaResolved = resolvedChunks.length ? resolvedChunks : null;
  const chunkIndexResolved = chunkMetaResolved ? buildChunkIndex(chunkMetaResolved, { repoRoot }) : null;
  const payload = assembleCompositeContextPack({
    seed,
    chunkMeta: chunkMetaResolved,
    chunkIndex: chunkIndexResolved,
    repoRoot,
    indexDir,
    ...rest
  });
  if (!resolvedChunks.length && payload && payload.warnings) {
    payload.warnings.push({
      code: 'CHUNK_UID_MAP_MISS',
      message: 'chunk_uid_map could not resolve seed to chunk metadata; excerpt may be incomplete.'
    });
  } else if (!resolvedChunks.length && payload) {
    payload.warnings = [{
      code: 'CHUNK_UID_MAP_MISS',
      message: 'chunk_uid_map could not resolve seed to chunk metadata; excerpt may be incomplete.'
    }];
  }
  if (payload?.stats) {
    payload.stats.seedResolution = {
      strategy: 'chunk_uid_map_index',
      candidates: candidates.length,
      rowsIndexed: seedIndex?.rowsIndexed || 0,
      hit: resolvedChunks.length > 0
    };
  }
  return payload;
};
