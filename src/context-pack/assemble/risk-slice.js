import { normalizeRiskSummary, summarizeRiskStats } from '../../shared/risk-explain-summary.js';
import { observeRiskPackMetrics } from '../../shared/metrics/core.js';
import { createTruncationRecorder } from '../../shared/truncation.js';
import {
  filterRiskFlows,
  filterRiskPartialFlows,
  materializeRiskFilters
} from '../../shared/risk-filters.js';
import {
  loadJsonArrayArtifactSync,
  loadJsonObjectArtifactSync
} from '../../shared/artifact-io/loaders/core.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import {
  loadPiecesManifest,
  resolveArtifactPresence
} from '../../shared/artifact-io/manifest.js';
import { resolveChunkCandidatesBySeed } from '../seed-resolution.js';
import { createExcerptSourceContext } from '../excerpt-cache.js';
import {
  rankPartialRiskFlows,
  rankRiskFlows,
  resolveRiskAnchor
} from '../risk-ranking.js';
import { buildRiskSupportEnvelope } from '../risk-support.js';
import { hydrateRiskCallSiteDetails, normalizeRiskCallSiteDetails } from './call-sites.js';
import {
  buildRiskCaps,
  admitRiskFlowEnvelope,
  selectRiskFlowsWithinBudget,
  selectRiskPartialFlowsWithinBudget
} from './budgets.js';
import { buildRiskGuidance } from './guidance.js';
import {
  buildRiskArtifactStatus,
  buildRiskAnalysisStatus,
  classifyRiskLoadFailure,
  normalizeRiskProvenance,
  withRiskContractVersion
} from './risk-load.js';

const buildUnavailableRiskSlice = ({
  reason,
  riskSeedContext,
  riskFilterState,
  warnings,
  provenance,
  artifactStatus = null
}) => {
  const degradedReasons = Array.from(
    new Set(
      warnings
        .filter((entry) => typeof entry?.code === 'string' && entry.code.startsWith('RISK_'))
        .map((entry) => entry.code.toLowerCase())
    )
  );
  return withRiskContractVersion({
    version: 1,
    status: 'missing',
    reason,
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
      reason,
      degraded: true,
      summaryOnly: false,
      code: 'missing',
      strictFailure: true,
      artifactStatus,
      degradedReasons,
      flowsEmitted: null,
      uniqueCallSitesReferenced: null,
      capsHit: []
    },
    caps: null,
    truncation: [],
    provenance,
    degraded: true
  });
};

const buildDisabledOrSummaryOnlyRiskSlice = ({
  baseStatus,
  stats,
  summary,
  summaryOnly,
  baseArtifactStatus,
  riskFilterState,
  riskSeedContext,
  manifest,
  indexSignature,
  indexCompatKey
}) => {
  const summarizedStats = summarizeRiskStats(stats);
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
      truncatedCallSiteExcerpts: 0,
      bytes: 0,
      tokens: 0,
      partialBytes: 0,
      partialTokens: 0
    },
    hits: new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : [])
  });
  return withRiskContractVersion({
    version: 1,
    status: baseStatus,
    reason: stats?.reason || (baseStatus === 'disabled' ? 'disabled' : null),
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
    stats: summarizedStats,
    analysisStatus: buildRiskAnalysisStatus({
      status: baseStatus,
      reason: stats?.reason || (baseStatus === 'disabled' ? 'disabled' : null),
      degraded: false,
      summaryOnly,
      code: baseStatus,
      strictFailure: true,
      artifactStatus: baseArtifactStatus,
      stats: summarizedStats,
      caps: riskCaps,
      degradedReasons: []
    }),
    caps: riskCaps,
    truncation: [],
    filters: riskFilterState,
    provenance: normalizeRiskProvenance({
      manifest,
      stats,
      artifactStatus: baseArtifactStatus,
      indexSignature,
      indexCompatKey
    }),
    degraded: false
  });
};

const buildSelectedAnchor = ({ selected, alternates }) => ({
  kind: selected.kind,
  chunkUid: selected.chunkUid || null,
  ref: selected.ref || null,
  flowId: selected.flowId || null,
  alternateCount: alternates.length,
  alternates: alternates.slice(0, 5).map((entry) => ({
    kind: entry.kind,
    chunkUid: entry.chunkUid,
    ref: entry.ref,
    flowId: entry.flowId || null
  }))
});

const buildRiskSeedContext = ({ seedRef, primaryChunk, chunkIndex }) => {
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
  return riskSeedContext;
};

const resolveRiskArtifactPresence = ({ indexDir, manifest }) => ({
  stats: resolveArtifactPresence(indexDir, 'risk_interprocedural_stats', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  }),
  summaries: resolveArtifactPresence(indexDir, 'risk_summaries', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  }),
  flows: resolveArtifactPresence(indexDir, 'risk_flows', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  }),
  partialFlows: resolveArtifactPresence(indexDir, 'risk_partial_flows', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  }),
  callSites: resolveArtifactPresence(indexDir, 'call_sites', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict: true
  })
});

export const buildRiskSlice = ({
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
  const riskSeedContext = buildRiskSeedContext({ seedRef, primaryChunk, chunkIndex });
  const riskFilterState = materializeRiskFilters(riskFilters);
  if (!indexDir || !riskSeedContext.candidates.length) {
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice unavailable because no index directory or risk seed anchor was resolved.'
    });
    return buildUnavailableRiskSlice({
      reason: 'no-index-or-risk-anchor',
      riskSeedContext,
      riskFilterState,
      warnings,
      provenance: normalizeRiskProvenance({
        manifest: null,
        stats: null,
        artifactStatus: null,
        indexSignature,
        indexCompatKey
      })
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
    return buildUnavailableRiskSlice({
      reason: 'missing-manifest',
      riskSeedContext,
      riskFilterState,
      warnings,
      provenance: normalizeRiskProvenance({
        manifest: null,
        stats: null,
        artifactStatus: null,
        indexSignature,
        indexCompatKey
      })
    });
  }

  const presence = resolveRiskArtifactPresence({ indexDir, manifest });
  const statsMissing = presence.stats.format === 'missing' || presence.stats.missingMeta || presence.stats.missingPaths.length > 0;
  const summariesMissing = presence.summaries.format === 'missing'
    || presence.summaries.missingMeta
    || presence.summaries.missingPaths.length > 0;
  let statsLoadFailed = false;
  let summariesLoadFailed = false;
  let flowsLoadFailed = false;
  let partialFlowsLoadFailed = false;
  let callSitesLoadFailed = false;
  const riskTruncation = [];

  if (statsMissing && summariesMissing) {
    const artifactStatus = {
      stats: buildRiskArtifactStatus({ presence: presence.stats, required: true }),
      summaries: buildRiskArtifactStatus({ presence: presence.summaries, required: true }),
      flows: buildRiskArtifactStatus({ presence: presence.flows, required: false }),
      partialFlows: buildRiskArtifactStatus({ presence: presence.partialFlows, required: false }),
      callSites: buildRiskArtifactStatus({ presence: presence.callSites, required: false })
    };
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice unavailable because interprocedural stats and summaries artifacts are missing.'
    });
    return buildUnavailableRiskSlice({
      reason: 'missing-risk-artifacts',
      riskSeedContext,
      riskFilterState,
      warnings,
      artifactStatus,
      provenance: normalizeRiskProvenance({
        manifest,
        stats: null,
        artifactStatus,
        indexSignature,
        indexCompatKey
      })
    });
  }

  if (statsMissing) warnings.push({ code: 'RISK_STATS_MISSING', message: 'Required risk stats artifact is missing.' });
  if (summariesMissing) warnings.push({ code: 'RISK_SUMMARIES_MISSING', message: 'Required risk summaries artifact is missing.' });

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
    stats: buildRiskArtifactStatus({ presence: presence.stats, required: true, loadFailed: statsLoadFailed }),
    summaries: buildRiskArtifactStatus({ presence: presence.summaries, required: true, loadFailed: summariesLoadFailed }),
    flows: buildRiskArtifactStatus({
      presence: presence.flows,
      required: !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: flowsLoadFailed
    }),
    partialFlows: buildRiskArtifactStatus({
      presence: presence.partialFlows,
      required: includeRiskPartialFlows && !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: partialFlowsLoadFailed
    }),
    callSites: buildRiskArtifactStatus({ presence: presence.callSites, required: false, loadFailed: callSitesLoadFailed })
  };
  const baseStatus = stats?.status === 'disabled'
    ? 'disabled'
    : summaryOnly
      ? 'summary_only'
      : stats
        ? 'ok'
        : 'missing';

  if (baseStatus === 'disabled' || baseStatus === 'summary_only') {
    return buildDisabledOrSummaryOnlyRiskSlice({
      baseStatus,
      stats,
      summary,
      summaryOnly,
      baseArtifactStatus,
      riskFilterState,
      riskSeedContext,
      manifest,
      indexSignature,
      indexCompatKey
    });
  }

  const requiredArtifactStates = [baseArtifactStatus.stats, baseArtifactStatus.summaries];
  let degraded = requiredArtifactStates.some(state => state !== 'present');
  let flows = [];
  let partialFlows = [];
  const riskCandidateChunkUids = new Set(riskSeedContext.candidates.map((entry) => entry.chunkUid).filter(Boolean));
  const flowsMissing = presence.flows.format === 'missing' || presence.flows.missingMeta || presence.flows.missingPaths.length > 0;
  const partialFlowsMissing = presence.partialFlows.format === 'missing'
    || presence.partialFlows.missingMeta
    || presence.partialFlows.missingPaths.length > 0;
  const callSitesMissing = presence.callSites.format === 'missing'
    || presence.callSites.missingMeta
    || presence.callSites.missingPaths.length > 0;

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
  const selectedAnchor = buildSelectedAnchor({
    selected: resolvedAnchor.selected,
    alternates: resolvedAnchor.alternates
  });
  if (!summary && selectedAnchor.chunkUid) {
    summary = summaryRowsByChunkUid.get(selectedAnchor.chunkUid) || null;
  }

  const rankedFlows = rankRiskFlows(flows, selectedAnchor);
  const rankedPartialFlows = rankPartialRiskFlows(partialFlows, selectedAnchor);
  const referencedCallSiteIds = new Set();
  const riskCapHits = new Set(Array.isArray(stats?.capsHit) ? stats.capsHit : []);
  const packRiskTruncationRecorder = createTruncationRecorder({ scope: 'risk', target: truncation });
  const riskTruncationRecorder = createTruncationRecorder({ scope: 'risk', target: riskTruncation });
  const recordRiskTruncation = (cap, detail = {}) => {
    packRiskTruncationRecorder.record(cap, detail);
    riskTruncationRecorder.record(cap, detail);
  };
  const flowSelection = selectRiskFlowsWithinBudget({
    rankedFlows,
    truncation,
    riskTruncation,
    referencedCallSiteIds,
    riskCapHits,
    recordRiskTruncation
  });
  const partialFlowSelection = selectRiskPartialFlowsWithinBudget({
    rankedPartialFlows,
    truncation,
    riskTruncation,
    referencedCallSiteIds,
    riskCapHits,
    recordRiskTruncation
  });

  let truncatedCallSiteExcerptBytes = 0;
  let truncatedCallSiteExcerptTokens = 0;
  const attachDetails = (flow, getDetails) => ({ ...flow, evidence: { ...flow.evidence,
    callSitesByStep: flow.evidence.callSitesByStep.map(step => step.map(entry => ({ ...entry, details: getDetails(entry.callSiteId) || null })))
  } });
  const rowsById = new Map(), metadataById = new Map(), callSiteById = new Map();
  const callSiteFailure = err => {
    callSitesLoadFailed = true;
    const failureClass = classifyRiskLoadFailure(err);
    warnings.push({
      code: failureClass === 'timed_out' ? 'RISK_CALL_SITES_TIMED_OUT'
        : failureClass === 'schema_invalid' ? 'RISK_CALL_SITES_SCHEMA_INVALID' : 'RISK_CALL_SITES_LOAD_FAILED',
      message: 'Call-site evidence artifact could not be loaded for risk flows.',
      data: { error: err?.message || String(err) }
    });
    degraded = true;
  };
  if (referencedCallSiteIds.size > 0 && !callSitesMissing) {
    try {
      const callSiteRows = loadJsonArrayArtifactSync(indexDir, 'call_sites', {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
      for (const row of Array.isArray(callSiteRows) ? callSiteRows : []) {
        if (row?.callSiteId && referencedCallSiteIds.has(row.callSiteId)) rowsById.set(row.callSiteId, row);
      }
    } catch (err) {
      callSiteFailure(err);
    }
  } else if (referencedCallSiteIds.size > 0 && callSitesMissing) {
    warnings.push({
      code: 'RISK_CALL_SITES_MISSING',
      message: 'Risk flows reference call-site evidence, but the call_sites artifact is missing.'
    });
    degraded = true;
  }

  const metadataDetails = id => {
    if (!metadataById.has(id)) metadataById.set(id, normalizeRiskCallSiteDetails(rowsById.get(id)));
    return metadataById.get(id);
  };
  const sourceContext = createExcerptSourceContext();
  const hydratedDetails = id => {
    if (callSiteById.has(id)) return callSiteById.get(id);
    const row = rowsById.get(id);
    if (!row || callSitesLoadFailed) return null;
    try {
      const hydrated = hydrateRiskCallSiteDetails({ row, repoRoot, indexSignature, sourceContext });
      callSiteById.set(id, hydrated.details || null);
      if (hydrated.excerptTruncation?.bytes) truncatedCallSiteExcerptBytes++;
      if (hydrated.excerptTruncation?.tokens) truncatedCallSiteExcerptTokens++;
      return hydrated.details;
    } catch (err) { callSiteFailure(err); return null; }
  };
  let admitted, admittedPartial;
  try {
    // A metadata lower-bound check uses the remaining allowance after earlier
    // fully hydrated units. Only then may this candidate request source text.
    const hydrate = flow => attachDetails(flow, hydratedDetails);
    admitted = admitRiskFlowEnvelope({ flows: flowSelection.selectedRawFlows.map(flow => attachDetails(flow, metadataDetails)),
      riskCapHits, recordRiskTruncation, stage: 'hydrated evidence', hydrate });
    admittedPartial = admitRiskFlowEnvelope({ flows: partialFlowSelection.selectedRawPartialFlows.map(flow => attachDetails(flow, metadataDetails)),
      partial: true, riskCapHits, recordRiskTruncation, stage: 'hydrated evidence', hydrate });
  } finally { sourceContext.clear(); }

  if (truncatedCallSiteExcerptBytes > 0) {
    riskCapHits.add('maxCallSiteExcerptBytes');
    recordRiskTruncation('maxCallSiteExcerptBytes', {
      limit: 192,
      observed: truncatedCallSiteExcerptBytes,
      omitted: truncatedCallSiteExcerptBytes,
      note: 'Risk call-site excerpts were truncated to the configured per-call-site byte budget.'
    });
  }
  if (truncatedCallSiteExcerptTokens > 0) {
    riskCapHits.add('maxCallSiteExcerptTokens');
    recordRiskTruncation('maxCallSiteExcerptTokens', {
      limit: 24,
      observed: truncatedCallSiteExcerptTokens,
      omitted: truncatedCallSiteExcerptTokens,
      note: 'Risk call-site excerpts were truncated to the configured per-call-site token budget.'
    });
  }

  const normalizedFlows = admitted.flows, normalizedPartialFlows = admittedPartial.flows;
  flowSelection.omittedFlows += admitted.omittedFlows;
  partialFlowSelection.omittedPartialFlows += admittedPartial.omittedFlows;
  flowSelection.emittedBytes = admitted.bytes; flowSelection.emittedTokens = admitted.tokens;
  flowSelection.emittedSteps = normalizedFlows.reduce((total, flow) => total + flow.path.callSiteIdsByStep.length, 0);
  partialFlowSelection.partialBytes = admittedPartial.bytes; partialFlowSelection.partialTokens = admittedPartial.tokens;

  const guidance = buildRiskGuidance({
    flows: normalizedFlows,
    graphIndex,
    chunkIndex,
    repoRoot,
    indexCompatKey,
    indexSignature
  });
  const status = degraded ? 'degraded' : baseStatus;
  const resolvedArtifactStatus = {
    ...baseArtifactStatus,
    flows: buildRiskArtifactStatus({
      presence: presence.flows,
      required: !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: flowsLoadFailed
    }),
    partialFlows: buildRiskArtifactStatus({
      presence: presence.partialFlows,
      required: includeRiskPartialFlows && !(summaryOnly || stats?.status === 'disabled'),
      loadFailed: partialFlowsLoadFailed
    }),
    callSites: buildRiskArtifactStatus({
      presence: presence.callSites,
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
      omittedFlows: flowSelection.omittedFlows,
      candidatePartialFlows: rankedPartialFlows.length,
      selectedPartialFlows: normalizedPartialFlows.length,
      omittedPartialFlows: partialFlowSelection.omittedPartialFlows,
      emittedSteps: flowSelection.emittedSteps,
      omittedSteps: flowSelection.omittedSteps,
      omittedCallSites: flowSelection.omittedCallSites,
      truncatedCallSiteExcerpts: truncatedCallSiteExcerptBytes + truncatedCallSiteExcerptTokens,
      bytes: flowSelection.emittedBytes,
      tokens: flowSelection.emittedTokens,
      partialBytes: partialFlowSelection.partialBytes,
      partialTokens: partialFlowSelection.partialTokens
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
    requiredArtifactStates.includes('missing')
    || degradedReasons.includes('RISK_CALL_SITES_MISSING')
    || degradedReasons.includes('RISK_FLOWS_MISSING')
    || degradedReasons.includes('RISK_PARTIAL_FLOWS_MISSING')
  ) {
    statusCode = 'missing';
  } else if (degraded) {
    statusCode = 'degraded';
  }
  const upstreamIncomplete = stats?.inputCoverage?.status !== 'complete'
    || (Array.isArray(stats?.droppedRecords) && stats.droppedRecords.some(row => Number(row?.count) > 0));
  if (!degraded && (riskCaps.hits.length || riskTruncation.length || upstreamIncomplete)) {
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
    droppedFlows: flowSelection.omittedFlows,
    droppedPartialFlows: partialFlowSelection.omittedPartialFlows
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
    provenance: normalizeRiskProvenance({
      manifest,
      stats,
      artifactStatus: resolvedArtifactStatus,
      indexSignature,
      indexCompatKey
    }),
    degraded
  });
};
