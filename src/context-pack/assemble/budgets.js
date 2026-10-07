import {
  CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP,
  CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
  CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS
} from './call-sites.js';
import { createTruncationRecorder } from '../../shared/truncation.js';
import { normalizeRiskPathNodes } from './risk-load.js';

export const CONTEXT_PACK_MAX_RISK_FLOWS = 5;
export const CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW = 8;
export const CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS = 5;
export const CONTEXT_PACK_MAX_RISK_BYTES = 24 * 1024;
export const CONTEXT_PACK_MAX_RISK_TOKENS = 2048;
export const CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES = 16 * 1024;
export const CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS = 1024;

export const estimateRiskByteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

export const estimateRiskTokenCount = (value) => {
  const serialized = JSON.stringify(value);
  const matches = serialized.match(/[A-Za-z0-9_./:-]+/g);
  return matches ? matches.length : 0;
};

export const buildRiskCaps = ({ stats, counts, hits }) => ({
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

const normalizeRiskEndpointForBudget = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'object') return null;
  return {
    chunkUid: endpoint.chunkUid || null,
    ruleId: endpoint.ruleId || null,
    ruleName: endpoint.ruleName || null,
    ruleType: endpoint.ruleType || null,
    ruleRole: endpoint.ruleType || null,
    category: endpoint.category || null,
    severity: endpoint.severity || null,
    confidence: Number.isFinite(endpoint.confidence) ? endpoint.confidence : null,
    tags: Array.isArray(endpoint.tags) ? endpoint.tags.filter(Boolean) : []
  };
};

const buildRiskBudgetScore = (entry, flow, { includeSeverity = false } = {}) => {
  const score = {
    seedRelevance: entry.score.seedRelevance
  };
  if (includeSeverity) score.severity = entry.score.severity;
  score.confidence = Number.isFinite(entry.score.confidence) ? entry.score.confidence : null;
  score.hopCount = Number.isFinite(flow?.notes?.hopCount) ? flow.notes.hopCount : null;
  return score;
};

const normalizeRiskBudgetNotes = (notes, { includeTerminalReason = false, terminalReason = null } = {}) => {
  if (!notes || typeof notes !== 'object') return null;
  const out = {
    strictness: notes.strictness || null,
    sanitizerPolicy: notes.sanitizerPolicy || null,
    hopCount: Number.isFinite(notes.hopCount) ? notes.hopCount : null,
    sanitizerBarriersHit: Number.isFinite(notes.sanitizerBarriersHit)
      ? notes.sanitizerBarriersHit
      : null,
    capsHit: Array.isArray(notes.capsHit) ? notes.capsHit.slice() : []
  };
  if (includeTerminalReason) {
    out.terminalReason = notes.terminalReason || terminalReason || null;
  }
  return out;
};

const createRiskTruncationSink = ({
  truncation,
  riskTruncation,
  recordRiskTruncation = null
}) => {
  if (typeof recordRiskTruncation === 'function') return recordRiskTruncation;
  const packRecorder = createTruncationRecorder({ scope: 'risk', target: truncation });
  const riskRecorder = createTruncationRecorder({ scope: 'risk', target: riskTruncation });
  return (cap, detail = {}) => {
    packRecorder.record(cap, detail);
    riskRecorder.record(cap, detail);
  };
};

export const selectRiskFlowsWithinBudget = ({
  rankedFlows,
  truncation,
  riskTruncation,
  referencedCallSiteIds,
  riskCapHits,
  recordRiskTruncation: recordRiskTruncationInput = null
}) => {
  const recordRiskTruncation = createRiskTruncationSink({
    truncation,
    riskTruncation,
    recordRiskTruncation: recordRiskTruncationInput
  });
  const selectedRawFlows = [];
  let emittedBytes = 0;
  let emittedTokens = 0;
  let emittedSteps = 0;
  let omittedSteps = 0;
  let omittedCallSites = 0;
  let omittedFlows = 0;
  let maxFlowTruncationRecorded = false;
  let budgetTruncationRecorded = false;

  for (const entry of rankedFlows) {
    if (selectedRawFlows.length >= CONTEXT_PACK_MAX_RISK_FLOWS) {
      omittedFlows += 1;
      if (!maxFlowTruncationRecorded) {
        recordRiskTruncation('maxFlows', {
          limit: CONTEXT_PACK_MAX_RISK_FLOWS,
          observed: rankedFlows.length,
          omitted: rankedFlows.length - CONTEXT_PACK_MAX_RISK_FLOWS,
          note: 'Risk flows truncated for composite context pack.'
        });
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
      recordRiskTruncation('maxStepsPerFlow', {
        limit: CONTEXT_PACK_MAX_RISK_STEPS_PER_FLOW,
        observed: rawSteps.length,
        omitted,
        note: `Risk flow ${flow?.flowId || 'flow'} truncated to the configured step budget.`
      });
    }

    const rawWatchSteps = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
    const normalizedStepIds = limitedSteps.map((ids) => {
      const sourceIds = Array.isArray(ids) ? ids : [];
      const limitedIds = sourceIds.slice(0, CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP);
      if (sourceIds.length > limitedIds.length) {
        const omitted = sourceIds.length - limitedIds.length;
        omittedCallSites += omitted;
        riskCapHits.add('maxCallSitesPerStep');
        recordRiskTruncation('maxCallSitesPerStep', {
          limit: CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP,
          observed: sourceIds.length,
          omitted,
          note: `Risk flow ${flow?.flowId || 'flow'} truncated call-site evidence for one path step.`
        });
      }
      for (const callSiteId of limitedIds) {
        if (callSiteId) referencedCallSiteIds.add(callSiteId);
      }
      return limitedIds;
    });

    const candidate = {
      rank: entry.rank,
      flowId: flow?.flowId || null,
      source: normalizeRiskEndpointForBudget(flow?.source),
      sink: normalizeRiskEndpointForBudget(flow?.sink),
      category: flow?.sink?.category || flow?.source?.category || null,
      severity: flow?.sink?.severity || flow?.source?.severity || null,
      confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
      score: buildRiskBudgetScore(entry, flow, { includeSeverity: true }),
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
      notes: normalizeRiskBudgetNotes(flow?.notes)
    };

    const candidateBytes = estimateRiskByteSize(candidate);
    const candidateTokens = estimateRiskTokenCount(candidate);
    if (
      (emittedBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_BYTES
      || (emittedTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_TOKENS
    ) {
      omittedFlows += 1;
      if (!budgetTruncationRecorded) {
        const byteOmitted = (emittedBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_BYTES;
        const tokenOmitted = (emittedTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_TOKENS;
        if (byteOmitted) {
          recordRiskTruncation('maxRiskBytes', {
            limit: CONTEXT_PACK_MAX_RISK_BYTES,
            observed: emittedBytes + candidateBytes,
            omitted: candidateBytes,
            note: 'Risk flow budget hit the total serialized byte cap.'
          });
          riskCapHits.add('maxRiskBytes');
        }
        if (tokenOmitted) {
          recordRiskTruncation('maxRiskTokens', {
            limit: CONTEXT_PACK_MAX_RISK_TOKENS,
            observed: emittedTokens + candidateTokens,
            omitted: candidateTokens,
            note: 'Risk flow budget hit the total token cap.'
          });
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

  return {
    selectedRawFlows,
    emittedBytes,
    emittedTokens,
    emittedSteps,
    omittedSteps,
    omittedCallSites,
    omittedFlows
  };
};

export const selectRiskPartialFlowsWithinBudget = ({
  rankedPartialFlows,
  truncation,
  riskTruncation,
  referencedCallSiteIds,
  riskCapHits,
  recordRiskTruncation: recordRiskTruncationInput = null
}) => {
  const recordRiskTruncation = createRiskTruncationSink({
    truncation,
    riskTruncation,
    recordRiskTruncation: recordRiskTruncationInput
  });
  const selectedRawPartialFlows = [];
  let partialBytes = 0;
  let partialTokens = 0;
  let omittedPartialFlows = 0;
  let maxPartialFlowTruncationRecorded = false;
  let partialBudgetTruncationRecorded = false;

  for (const entry of rankedPartialFlows) {
    if (selectedRawPartialFlows.length >= CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS) {
      omittedPartialFlows += 1;
      if (!maxPartialFlowTruncationRecorded) {
        recordRiskTruncation('maxPartialFlows', {
          limit: CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
          observed: rankedPartialFlows.length,
          omitted: rankedPartialFlows.length - CONTEXT_PACK_MAX_RISK_PARTIAL_FLOWS,
          note: 'Partial risk flows truncated for composite context pack.'
        });
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
      source: normalizeRiskEndpointForBudget(flow?.source),
      confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
      score: buildRiskBudgetScore(entry, flow),
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
      notes: normalizeRiskBudgetNotes(flow?.notes, {
        includeTerminalReason: true,
        terminalReason: flow?.frontier?.terminalReason || null
      })
    };

    const candidateBytes = estimateRiskByteSize(candidate);
    const candidateTokens = estimateRiskTokenCount(candidate);
    if (
      (partialBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES
      || (partialTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS
    ) {
      omittedPartialFlows += 1;
      if (!partialBudgetTruncationRecorded) {
        if ((partialBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES) {
          recordRiskTruncation('maxPartialBytes', {
            limit: CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES,
            observed: partialBytes + candidateBytes,
            omitted: candidateBytes,
            note: 'Partial risk flow budget hit the total serialized byte cap.'
          });
          riskCapHits.add('maxPartialBytes');
        }
        if ((partialTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS) {
          recordRiskTruncation('maxPartialTokens', {
            limit: CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS,
            observed: partialTokens + candidateTokens,
            omitted: candidateTokens,
            note: 'Partial risk flow budget hit the total token cap.'
          });
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

  return {
    selectedRawPartialFlows,
    partialBytes,
    partialTokens,
    omittedPartialFlows
  };
};
