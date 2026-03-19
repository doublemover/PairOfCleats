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
import { observeRiskPackMetrics } from '../shared/metrics.js';
import {
  filterRiskFlows,
  filterRiskPartialFlows,
  materializeRiskFilters,
  normalizeRiskFilters,
  validateRiskFilters
} from '../shared/risk-filters.js';
import { buildGraphContextPack } from '../graph/context-pack.js';
import { buildSuggestTestsReport } from '../graph/suggest-tests.js';
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
import { CONTEXT_PACK_RISK_CONTRACT_VERSION } from '../contracts/context-pack-risk-contract.js';
import { buildRiskSupportEnvelope } from './risk-support.js';
import {
  buildChunkIndex,
  buildChunkUidMapSeedIndex,
  normalizeChunkUidMapRowAsChunk,
  resolveChunkBySeed,
  resolveChunkCandidatesBySeed,
  resolveChunkUidMapSeedCandidatesFromIndex,
  resolveChunkUidMapSeedRefs,
  resolvePrimaryRef,
  resolveSeedCandidates,
  resolveSeedRef
} from './seed-resolution.js';
import {
  buildPrimaryExcerpt,
  clearContextPackCaches,
  normalizeTypeFacts
} from './excerpt-cache.js';
import {
  rankPartialRiskFlows,
  rankRiskFlows,
  resolveRiskAnchor
} from './risk-ranking.js';

export { buildChunkIndex } from './seed-resolution.js';
export { clearContextPackCaches } from './excerpt-cache.js';

const CONTEXT_PACK_MAX_RISK_FLOWS = 5;
const CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW = 8;
const CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS = 5;
const CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP = 3;
const CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES = 192;
const CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS = 24;
const CONTEXT_PACK_MAX_RISK_BYTES = 24 * 1024;
const CONTEXT_PACK_MAX_RISK_TOKENS = 2048;
const CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES = 16 * 1024;
const CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS = 1024;
const CONTEXT_PACK_MAX_RISK_GUIDANCE_CALLERS = 3;
const CONTEXT_PACK_MAX_RISK_GUIDANCE_SYMBOLS = 5;
const CONTEXT_PACK_MAX_RISK_GUIDANCE_TESTS = 3;

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
    partialFlows: artifacts.partialFlows || artifacts.riskPartialFlows || null,
    callSites: artifacts.callSites || null
  };
  return Object.values(refs).some(Boolean) ? refs : null;
};

const normalizeRiskRuleBundle = (stats) => {
  const ruleBundle = stats?.provenance?.ruleBundle;
  if (!ruleBundle || typeof ruleBundle !== 'object') return null;
  const roleModel = ruleBundle.roleModel && typeof ruleBundle.roleModel === 'object'
    ? ruleBundle.roleModel
    : {
      version: '1.0.0',
      directRoles: ['source', 'sink', 'sanitizer'],
      propagatorLikeRoles: ['propagator', 'wrapper', 'builder', 'callback', 'asyncHandoff'],
      propagatorLikeEncoding: 'watch-semantics'
    };
  return {
    version: ruleBundle.version || null,
    fingerprint: ruleBundle.fingerprint || null,
    roleModel: {
      version: roleModel.version || null,
      directRoles: Array.isArray(roleModel.directRoles) ? roleModel.directRoles.filter(Boolean) : [],
      propagatorLikeRoles: Array.isArray(roleModel.propagatorLikeRoles)
        ? roleModel.propagatorLikeRoles.filter(Boolean)
        : [],
      propagatorLikeEncoding: roleModel.propagatorLikeEncoding || null
    },
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

/**
 * Build remediation guidance from the already-selected risk flows.
 *
 * Ranking is intentionally simple and deterministic:
 * - callers: direct inbound callers of source/sink chunks first, then callers of
 *   other flow-path chunks, then lexical tie-breakers
 * - symbols: symbols attached to source/sink chunks first, then other flow-path
 *   chunks, then lexical tie-breakers
 * - tests: defer to suggest-tests scoring over the files touched by selected
 *   risk flows, then cap deterministically
 */
const buildRiskGuidance = ({
  flows,
  graphIndex,
  chunkIndex,
  repoRoot,
  indexCompatKey
}) => {
  if (!graphIndex || !Array.isArray(flows) || flows.length === 0) return null;
  const callGraphIndex = graphIndex.callGraphIndex instanceof Map ? graphIndex.callGraphIndex : new Map();
  const symbolIndex = graphIndex.symbolIndex && graphIndex.symbolIndex.byChunk instanceof Map
    ? graphIndex.symbolIndex.byChunk
    : new Map();
  const byChunkUid = chunkIndex?.byChunkUid instanceof Map ? chunkIndex.byChunkUid : new Map();
  const guidanceCaps = {
    maxCallers: CONTEXT_PACK_MAX_RISK_GUIDANCE_CALLERS,
    maxSymbols: CONTEXT_PACK_MAX_RISK_GUIDANCE_SYMBOLS,
    maxTests: CONTEXT_PACK_MAX_RISK_GUIDANCE_TESTS,
    hits: []
  };

  const resolveChunkMeta = (chunkUid) => {
    if (!chunkUid) return null;
    const node = callGraphIndex.get(chunkUid);
    if (node) {
      return {
        chunkUid,
        file: node.file || null,
        name: node.name || null,
        kind: node.kind || null
      };
    }
    const chunk = byChunkUid.get(chunkUid);
    if (!chunk) return null;
    return {
      chunkUid,
      file: chunk.file || chunk.metaV2?.file || chunk.virtualPath || null,
      name: chunk.name || chunk.metaV2?.symbol?.name || chunk.metaV2?.name || null,
      kind: chunk.kind || chunk.metaV2?.symbol?.kind || null
    };
  };

  const flowFiles = new Set();
  const callerScores = new Map();
  const symbolScores = new Map();
  const collectTargetChunkUids = (flow) => {
    const targetChunkUids = new Set();
    const sourceChunkUid = flow?.source?.chunkUid || null;
    const sinkChunkUid = flow?.sink?.chunkUid || null;
    if (sourceChunkUid) targetChunkUids.add(sourceChunkUid);
    if (sinkChunkUid) targetChunkUids.add(sinkChunkUid);
    for (const node of Array.isArray(flow?.path?.nodes) ? flow.path.nodes : []) {
      if (node?.type === 'chunk' && node.chunkUid) targetChunkUids.add(node.chunkUid);
    }
    return {
      all: Array.from(targetChunkUids),
      sourceChunkUid,
      sinkChunkUid
    };
  };

  for (const flow of flows) {
    const { all: targetChunkUids, sourceChunkUid, sinkChunkUid } = collectTargetChunkUids(flow);
    for (const targetChunkUid of targetChunkUids) {
      const targetMeta = resolveChunkMeta(targetChunkUid);
      if (targetMeta?.file) flowFiles.add(targetMeta.file);

      const incoming = Array.isArray(callGraphIndex.get(targetChunkUid)?.in)
        ? callGraphIndex.get(targetChunkUid).in
        : [];
      for (const callerChunkUid of incoming) {
        if (!callerChunkUid || targetChunkUids.includes(callerChunkUid)) continue;
        const entry = callerScores.get(callerChunkUid) || {
          chunkUid: callerChunkUid,
          file: null,
          name: null,
          kind: null,
          score: 0,
          coveredTargets: new Set()
        };
        const callerMeta = resolveChunkMeta(callerChunkUid);
        entry.file = entry.file || callerMeta?.file || null;
        entry.name = entry.name || callerMeta?.name || null;
        entry.kind = entry.kind || callerMeta?.kind || null;
        const weight = (callerChunkUid === sourceChunkUid || callerChunkUid === sinkChunkUid)
          ? 4
          : (targetChunkUid === sourceChunkUid || targetChunkUid === sinkChunkUid ? 3 : 1);
        entry.score += weight;
        entry.coveredTargets.add(targetMeta?.name || targetMeta?.file || targetChunkUid);
        callerScores.set(callerChunkUid, entry);
      }

      const symbolEntries = symbolIndex.get(targetChunkUid) || [];
      for (const symbolEntry of symbolEntries) {
        const resolvedRef = symbolEntry?.toRef?.resolved || symbolEntry?.toRef?.candidates?.[0] || null;
        const symbolId = symbolEntry?.symbolId || resolvedRef?.symbolId || null;
        if (!symbolId) continue;
        const entry = symbolScores.get(symbolId) || {
          symbolId,
          chunkUid: resolvedRef?.chunkUid || targetChunkUid || null,
          path: resolvedRef?.path || null,
          name: resolvedRef?.name || null,
          kind: resolvedRef?.kind || null,
          score: 0,
          coveredChunks: new Set()
        };
        entry.score += (targetChunkUid === sourceChunkUid || targetChunkUid === sinkChunkUid) ? 3 : 1;
        entry.coveredChunks.add(targetMeta?.name || targetMeta?.file || targetChunkUid);
        symbolScores.set(symbolId, entry);
      }
    }
  }

  const callers = Array.from(callerScores.values())
    .map((entry) => ({
      chunkUid: entry.chunkUid,
      file: entry.file,
      name: entry.name,
      kind: entry.kind,
      score: entry.score,
      coveredTargets: Array.from(entry.coveredTargets).sort(compareStrings),
      reason: `Direct caller of ${Array.from(entry.coveredTargets).sort(compareStrings).join(', ')}`
    }))
    .sort((left, right) => (
      right.score - left.score
      || compareStrings(left.name || '', right.name || '')
      || compareStrings(left.file || '', right.file || '')
      || compareStrings(left.chunkUid || '', right.chunkUid || '')
    ));

  const symbols = Array.from(symbolScores.values())
    .map((entry) => ({
      symbolId: entry.symbolId,
      chunkUid: entry.chunkUid,
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      score: entry.score,
      coveredChunks: Array.from(entry.coveredChunks).sort(compareStrings),
      reason: `Attached to ${Array.from(entry.coveredChunks).sort(compareStrings).join(', ')}`
    }))
    .sort((left, right) => (
      right.score - left.score
      || compareStrings(left.name || '', right.name || '')
      || compareStrings(left.path || '', right.path || '')
      || compareStrings(left.symbolId || '', right.symbolId || '')
    ));

  const testReport = flowFiles.size > 0
    ? buildSuggestTestsReport({
      changed: Array.from(flowFiles).sort(compareStrings),
      graphRelations: graphIndex.graphRelations || null,
      repoRoot,
      caps: {
        maxSuggestions: CONTEXT_PACK_MAX_RISK_GUIDANCE_TESTS,
        maxCandidates: CONTEXT_PACK_MAX_RISK_GUIDANCE_TESTS * 4
      },
      indexCompatKey
    })
    : { suggestions: [], truncation: [] };
  const tests = Array.isArray(testReport?.suggestions)
    ? testReport.suggestions.map((entry) => ({
      testPath: entry.testPath || null,
      score: Number.isFinite(entry.score) ? entry.score : null,
      reason: entry.reason || null,
      witnessPath: entry.witnessPath || null
    }))
    : [];

  if (callers.length > CONTEXT_PACK_MAX_RISK_GUIDANCE_CALLERS) guidanceCaps.hits.push('maxCallers');
  if (symbols.length > CONTEXT_PACK_MAX_RISK_GUIDANCE_SYMBOLS) guidanceCaps.hits.push('maxSymbols');
  if (Array.isArray(testReport?.truncation) && testReport.truncation.some((entry) => entry?.cap === 'maxSuggestions')) {
    guidanceCaps.hits.push('maxTests');
  }

  return {
    ranking: {
      callers: 'Direct inbound callers of source/sink chunks rank above callers of other flow-path chunks; ties use lexical order.',
      symbols: 'Symbols attached to source/sink chunks rank above symbols from other flow-path chunks; ties use lexical order.',
      tests: 'Candidate tests reuse suggest-tests scoring over files touched by the selected risk flows.'
    },
    caps: guidanceCaps,
    callers: callers.slice(0, CONTEXT_PACK_MAX_RISK_GUIDANCE_CALLERS),
    symbols: symbols.slice(0, CONTEXT_PACK_MAX_RISK_GUIDANCE_SYMBOLS),
    tests: tests.slice(0, CONTEXT_PACK_MAX_RISK_GUIDANCE_TESTS)
  };
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
    if (flow?.frontier?.chunkUid === anchorChunkUid) return 3;
    if (flow?.source?.chunkUid === anchorChunkUid) return 2;
  }
  if (anchorKind === 'path') {
    const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
    if (chunkUids.includes(anchorChunkUid)) return 2;
    if (flow?.source?.chunkUid === anchorChunkUid || flow?.sink?.chunkUid === anchorChunkUid) return 1;
    return 0;
  }
  if (
    flow?.source?.chunkUid === anchorChunkUid
    || flow?.sink?.chunkUid === anchorChunkUid
    || flow?.frontier?.chunkUid === anchorChunkUid
  ) return 2;
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  return chunkUids.includes(anchorChunkUid) ? 1 : 0;
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
  maxPartialFlows: CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
  maxCallSitesPerStep: CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP,
  maxCallSiteExcerptBytes: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
  maxCallSiteExcerptTokens: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS,
  maxBytes: CONTEXT_PACK_MAX_RISK_BYTES,
  maxTokens: CONTEXT_PACK_MAX_RISK_TOKENS,
  maxPartialBytes: CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES,
  maxPartialTokens: CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS,
  configured: stats?.effectiveConfig?.caps || null,
  observed: {
    candidateFlows: counts.candidateFlows,
    selectedFlows: counts.selectedFlows,
    omittedFlows: counts.omittedFlows,
    candidatePartialFlows: counts.candidatePartialFlows,
    selectedPartialFlows: counts.selectedPartialFlows,
    omittedPartialFlows: counts.omittedPartialFlows,
    emittedSteps: counts.emittedSteps,
    omittedSteps: counts.omittedSteps,
    omittedCallSites: counts.omittedCallSites,
    truncatedCallSiteExcerpts: counts.truncatedCallSiteExcerpts,
    bytes: counts.bytes,
    tokens: counts.tokens,
    partialBytes: counts.partialBytes,
    partialTokens: counts.partialTokens
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
  partialFlowsEmitted: stats?.partialFlowsEmitted ?? null,
  uniqueCallSitesReferenced: stats?.uniqueCallSitesReferenced ?? null,
  capsHit: Array.from(new Set([...(Array.isArray(stats?.capsHit) ? stats.capsHit : []), ...(Array.isArray(caps?.hits) ? caps.hits : [])]))
});

const withRiskContractVersion = (riskPayload) => ({
  ...riskPayload,
  contractVersion: CONTEXT_PACK_RISK_CONTRACT_VERSION
});

const buildRiskSlice = ({
  indexDir,
  repoRoot,
  seedRef,
  primaryChunk,
  chunkIndex,
  graphIndex = null,
  includeRiskPartialFlows = false,
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
  const riskFilterState = materializeRiskFilters(riskFilters);
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
    return withRiskContractVersion({
      version: 1,
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
      partialFlows: [],
      filters: riskFilterState,
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
      caps: null,
      truncation: [],
      provenance: normalizeRiskProvenance({ manifest: null, stats: null, artifactStatus: null, indexSignature, indexCompatKey }),
      degraded: true
    });
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
    return withRiskContractVersion({
      version: 1,
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
      partialFlows: [],
      filters: riskFilterState,
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
      caps: null,
      truncation: [],
      provenance: normalizeRiskProvenance({ manifest: null, stats: null, artifactStatus: null, indexSignature, indexCompatKey }),
      degraded: true
    });
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
  const partialFlowsPresence = resolveArtifactPresence(indexDir, 'risk_partial_flows', {
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
  let partialFlowsLoadFailed = false;
  let callSitesLoadFailed = false;
  const riskTruncation = [];
  if (statsMissing && summariesMissing) {
    const artifactStatus = {
      stats: buildRiskArtifactStatus({ presence: statsPresence, required: true }),
      summaries: buildRiskArtifactStatus({ presence: summariesPresence, required: true }),
      flows: buildRiskArtifactStatus({ presence: flowsPresence, required: false }),
      partialFlows: buildRiskArtifactStatus({ presence: partialFlowsPresence, required: false }),
      callSites: buildRiskArtifactStatus({ presence: callSitesPresence, required: false })
    };
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice unavailable because interprocedural stats and summaries artifacts are missing.'
    });
    return withRiskContractVersion({
      version: 1,
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
      partialFlows: [],
      filters: riskFilterState,
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
    });
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
    partialFlows: buildRiskArtifactStatus({
      presence: partialFlowsPresence,
      required: includeRiskPartialFlows && !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: partialFlowsLoadFailed
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
        candidatePartialFlows: 0,
        selectedPartialFlows: 0,
        omittedPartialFlows: 0,
        emittedSteps: 0,
        omittedSteps: 0,
        omittedCallSites: 0,
        bytes: 0,
        tokens: 0,
        partialBytes: 0,
        partialTokens: 0
      },
      hits: new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : [])
    });
    return withRiskContractVersion({
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
      partialFlows: [],
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
      filters: riskFilterState,
      provenance: normalizeRiskProvenance({ manifest, stats, artifactStatus: baseArtifactStatus, indexSignature, indexCompatKey }),
      degraded: false
    });
  }

  if (baseStatus === 'summary_only') {
    const riskCaps = buildRiskCaps({
      stats,
      counts: {
        candidateFlows: 0,
        selectedFlows: 0,
        omittedFlows: 0,
        candidatePartialFlows: 0,
        selectedPartialFlows: 0,
        omittedPartialFlows: 0,
        emittedSteps: 0,
        omittedSteps: 0,
        omittedCallSites: 0,
        bytes: 0,
        tokens: 0,
        partialBytes: 0,
        partialTokens: 0
      },
      hits: new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : [])
    });
    return withRiskContractVersion({
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
      partialFlows: [],
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
      filters: riskFilterState,
      provenance: normalizeRiskProvenance({ manifest, stats, artifactStatus: baseArtifactStatus, indexSignature, indexCompatKey }),
      degraded: false
    });
  }

  let degraded = false;
  let flows = [];
  let partialFlows = [];
  const riskCandidateChunkUids = new Set(riskSeedContext.candidates.map((entry) => entry.chunkUid).filter(Boolean));
  const flowsMissing = flowsPresence.format === 'missing' || flowsPresence.missingMeta || flowsPresence.missingPaths.length > 0;
  const partialFlowsMissing = partialFlowsPresence.format === 'missing'
    || partialFlowsPresence.missingMeta
    || partialFlowsPresence.missingPaths.length > 0;
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

  if (includeRiskPartialFlows) {
    if (!partialFlowsMissing) {
      try {
        const partialRows = loadJsonArrayArtifactSync(indexDir, 'risk_partial_flows', {
          manifest,
          maxBytes: MAX_JSON_BYTES,
          strict: true
        });
        const relevantPartialFlows = Array.isArray(partialRows)
          ? partialRows.filter((flow) => {
            const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
            if (flow?.source?.chunkUid && riskCandidateChunkUids.has(flow.source.chunkUid)) return true;
            if (flow?.frontier?.chunkUid && riskCandidateChunkUids.has(flow.frontier.chunkUid)) return true;
            return chunkUids.some((chunkUid) => riskCandidateChunkUids.has(chunkUid));
          })
          : [];
        partialFlows = filterRiskPartialFlows(relevantPartialFlows, riskFilters);
      } catch (err) {
        partialFlowsLoadFailed = true;
        const failureClass = classifyRiskLoadFailure(err);
        warnings.push({
          code: failureClass === 'timed_out'
            ? 'RISK_PARTIAL_FLOWS_TIMED_OUT'
            : failureClass === 'schema_invalid'
              ? 'RISK_PARTIAL_FLOWS_SCHEMA_INVALID'
              : 'RISK_PARTIAL_FLOWS_LOAD_FAILED',
          message: 'Risk partial flows artifact could not be loaded.',
          data: { error: err?.message || String(err) }
        });
        degraded = true;
      }
    } else if (stats?.counts?.partialFlowsEmitted > 0) {
      warnings.push({
        code: 'RISK_PARTIAL_FLOWS_MISSING',
        message: 'Risk stats report emitted partial flows, but the risk_partial_flows artifact is missing.'
      });
      degraded = true;
    }
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
  const selectedRawPartialFlows = [];
  const riskCapHits = new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : []);
  let emittedBytes = 0;
  let emittedTokens = 0;
  let partialBytes = 0;
  let partialTokens = 0;
  let emittedSteps = 0;
  let omittedSteps = 0;
  let omittedCallSites = 0;
  let truncatedCallSiteExcerptBytes = 0;
  let truncatedCallSiteExcerptTokens = 0;
  let omittedFlows = 0;
  let omittedPartialFlows = 0;
  let maxFlowTruncationRecorded = false;
  let budgetTruncationRecorded = false;
  let maxPartialFlowTruncationRecorded = false;
  let partialBudgetTruncationRecorded = false;

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

    const rawWatchSteps = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
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
          ruleRole: flow.source.ruleType || null,
          category: flow.source.category || null,
          severity: flow.source.severity || null,
          confidence: Number.isFinite(flow.source.confidence) ? flow.source.confidence : null,
          tags: Array.isArray(flow.source.tags) ? flow.source.tags.filter(Boolean) : []
        }
        : null,
      sink: flow?.sink && typeof flow.sink === 'object'
        ? {
          chunkUid: flow.sink.chunkUid || null,
          ruleId: flow.sink.ruleId || null,
          ruleName: flow.sink.ruleName || null,
          ruleType: flow.sink.ruleType || null,
          ruleRole: flow.sink.ruleType || null,
          category: flow.sink.category || null,
          severity: flow.sink.severity || null,
          confidence: Number.isFinite(flow.sink.confidence) ? flow.sink.confidence : null,
          tags: Array.isArray(flow.sink.tags) ? flow.sink.tags.filter(Boolean) : []
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
        callSiteIdsByStep: normalizedStepIds,
        watchByStep: rawWatchSteps.slice(0, limitedSteps.length).map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
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

  const rankedPartialFlows = rankPartialRiskFlows(partialFlows, selectedAnchor);
  for (const entry of rankedPartialFlows) {
    if (selectedRawPartialFlows.length >= CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS) {
      omittedPartialFlows += 1;
      if (!maxPartialFlowTruncationRecorded) {
        const record = {
          scope: 'risk',
          cap: 'maxFlows',
          limit: CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
          observed: rankedPartialFlows.length,
          omitted: rankedPartialFlows.length - CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
          note: 'Partial risk flows truncated for composite context pack.'
        };
        truncation.push(record);
        riskTruncation.push(record);
        maxPartialFlowTruncationRecorded = true;
      }
      riskCapHits.add('maxPartialFlows');
      continue;
    }
    const flow = entry.flow;
    const rawSteps = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
    const limitedSteps = rawSteps.slice(0, CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW);
    const rawWatchSteps = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
    const normalizedStepIds = limitedSteps.map((ids) => {
      const sourceIds = Array.isArray(ids) ? ids : [];
      const limitedIds = sourceIds.slice(0, CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP);
      for (const callSiteId of limitedIds) {
        if (callSiteId) referencedCallSiteIds.add(callSiteId);
      }
      return limitedIds;
    });
    for (const blocked of Array.isArray(flow?.frontier?.blockedExpansions) ? flow.frontier.blockedExpansions : []) {
      for (const callSiteId of Array.isArray(blocked?.callSiteIds) ? blocked.callSiteIds : []) {
        if (callSiteId) referencedCallSiteIds.add(callSiteId);
      }
    }
    const candidate = {
      rank: entry.rank,
      partialFlowId: flow?.partialFlowId || null,
      source: flow?.source && typeof flow.source === 'object'
        ? {
          chunkUid: flow.source.chunkUid || null,
          ruleId: flow.source.ruleId || null,
          ruleName: flow.source.ruleName || null,
          ruleType: flow.source.ruleType || null,
          ruleRole: flow.source.ruleType || null,
          category: flow.source.category || null,
          severity: flow.source.severity || null,
          confidence: Number.isFinite(flow.source.confidence) ? flow.source.confidence : null,
          tags: Array.isArray(flow.source.tags) ? flow.source.tags.filter(Boolean) : []
        }
        : null,
      confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
      score: {
        seedRelevance: entry.score.seedRelevance,
        confidence: Number.isFinite(entry.score.confidence) ? entry.score.confidence : null,
        hopCount: Number.isFinite(flow?.notes?.hopCount) ? flow.notes.hopCount : null
      },
      frontier: {
        chunkUid: flow?.frontier?.chunkUid || null,
        terminalReason: flow?.frontier?.terminalReason || null,
        blockedExpansions: Array.isArray(flow?.frontier?.blockedExpansions)
          ? flow.frontier.blockedExpansions.map((blocked) => ({
            targetChunkUid: blocked?.targetChunkUid || null,
            reason: blocked?.reason || null,
            callSiteIds: Array.isArray(blocked?.callSiteIds) ? blocked.callSiteIds.filter(Boolean) : []
          }))
          : []
      },
      path: {
        nodes: normalizeRiskPathNodes(flow),
        stepCount: rawSteps.length,
        truncatedSteps: rawSteps.length - limitedSteps.length,
        callSiteIdsByStep: normalizedStepIds,
        watchByStep: rawWatchSteps.slice(0, limitedSteps.length).map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
      },
      evidence: {
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
          capsHit: Array.isArray(flow.notes.capsHit) ? flow.notes.capsHit.slice() : [],
          terminalReason: flow.notes.terminalReason || flow?.frontier?.terminalReason || null
        }
        : null
    };

    const candidateBytes = estimateRiskByteSize(candidate);
    const candidateTokens = estimateRiskTokenCount(candidate);
    if ((partialBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES
      || (partialTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS) {
      omittedPartialFlows += 1;
      if (!partialBudgetTruncationRecorded) {
        if ((partialBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES) {
          const record = {
            scope: 'risk',
            cap: 'maxRiskBytes',
            limit: CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES,
            observed: partialBytes + candidateBytes,
            omitted: candidateBytes,
            note: 'Partial risk flow budget hit the total serialized byte cap.'
          };
          truncation.push(record);
          riskTruncation.push(record);
          riskCapHits.add('maxPartialBytes');
        }
        if ((partialTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS) {
          const record = {
            scope: 'risk',
            cap: 'maxRiskTokens',
            limit: CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS,
            observed: partialTokens + candidateTokens,
            omitted: candidateTokens,
            note: 'Partial risk flow budget hit the total token cap.'
          };
          truncation.push(record);
          riskTruncation.push(record);
          riskCapHits.add('maxPartialTokens');
        }
        partialBudgetTruncationRecorded = true;
      }
      continue;
    }
    partialBytes += candidateBytes;
    partialTokens += candidateTokens;
    selectedRawPartialFlows.push(candidate);
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
  const normalizedPartialFlows = selectedRawPartialFlows.map((flow) => ({
    ...flow,
    evidence: {
      ...flow.evidence,
      callSitesByStep: flow.evidence.callSitesByStep.map((step) => step.map((entry) => ({
        ...entry,
        details: callSiteById.get(entry.callSiteId) || null
      })))
    }
  }));
  const guidance = buildRiskGuidance({
    flows: normalizedFlows,
    graphIndex,
    chunkIndex,
    repoRoot,
    indexCompatKey
  });

  const status = degraded ? 'degraded' : baseStatus;
  const resolvedArtifactStatus = {
    ...baseArtifactStatus,
    flows: buildRiskArtifactStatus({
      presence: flowsPresence,
      required: !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: flowsLoadFailed
    }),
    partialFlows: buildRiskArtifactStatus({
      presence: partialFlowsPresence,
      required: includeRiskPartialFlows && !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: partialFlowsLoadFailed
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
      candidatePartialFlows: rankedPartialFlows.length,
      selectedPartialFlows: normalizedPartialFlows.length,
      omittedPartialFlows,
      emittedSteps,
      omittedSteps,
      omittedCallSites,
      truncatedCallSiteExcerpts: truncatedCallSiteExcerptBytes + truncatedCallSiteExcerptTokens,
      bytes: emittedBytes,
      tokens: emittedTokens,
      partialBytes,
      partialTokens
    },
    hits: riskCapHits
  });
  const degradedReasons = warnings
    .filter((entry) => typeof entry?.code === 'string' && entry.code.startsWith('RISK_'))
    .map((entry) => entry.code);
  let statusCode = 'ok';
  if (stats?.status === 'timed_out') {
    statusCode = 'timed_out';
  } else if (degradedReasons.some((entry) => entry.endsWith('_TIMED_OUT'))) {
    statusCode = 'timed_out';
  } else if (degradedReasons.some((entry) => entry.endsWith('_SCHEMA_INVALID'))) {
    statusCode = 'schema_invalid';
  } else if (
    degradedReasons.includes('RISK_CALL_SITES_MISSING')
    || degradedReasons.includes('RISK_FLOWS_MISSING')
    || degradedReasons.includes('RISK_PARTIAL_FLOWS_MISSING')
  ) {
    statusCode = 'missing';
  } else if (degraded) {
    statusCode = 'degraded';
  }
  if (!degraded && (riskCaps.hits.length || riskTruncation.length)) {
    statusCode = 'capped';
  }
  const strictFailure = statusCode !== 'ok';
  const summarizedStats = summarizeRiskStats(stats);
  const analysisStatus = buildRiskAnalysisStatus({
    status,
    reason: degraded ? 'partial-artifacts' : (stats?.reason || null),
    degraded,
    summaryOnly,
    code: statusCode,
    strictFailure,
    artifactStatus: resolvedArtifactStatus,
    stats: summarizedStats,
    caps: riskCaps,
    degradedReasons
  });
  const support = buildRiskSupportEnvelope({
    primaryChunk,
    summary: normalizedSummary,
    stats,
    analysisStatus
  });
  observeRiskPackMetrics({
    status: statusCode,
    capsHit: riskCaps.hits,
    truncation: riskTruncation,
    droppedFlows: omittedFlows,
    droppedPartialFlows: omittedPartialFlows
  });
  return withRiskContractVersion({
    version: 1,
    status,
    reason: degraded ? 'partial-artifacts' : (stats?.reason || null),
    anchor: selectedAnchor,
    filters: riskFilterState,
    flows: normalizedFlows,
    partialFlows: normalizedPartialFlows,
    summary: normalizedSummary,
    support,
    guidance,
    stats: summarizedStats,
    analysisStatus,
    caps: riskCaps,
    truncation: riskTruncation,
    provenance: normalizeRiskProvenance({ manifest, stats, artifactStatus: resolvedArtifactStatus, indexSignature, indexCompatKey }),
    degraded
  });
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
  includeRiskPartialFlows = false,
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
    indexSignature,
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
      graphIndex,
      includeRiskPartialFlows,
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
