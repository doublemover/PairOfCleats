import {
  CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP,
  CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
  CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS
} from './call-sites.js';
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

export const selectRiskFlowsWithinBudget = ({
  rankedFlows,
  truncation,
  riskTruncation,
  referencedCallSiteIds,
  riskCapHits
}) => {
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
    if (
      (emittedBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_BYTES
      || (emittedTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_TOKENS
    ) {
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
  riskCapHits
}) => {
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
    if (
      (partialBytes + candidateBytes) > CONTEXT_PACK_MAX_RISK_PARTIAL_BYTES
      || (partialTokens + candidateTokens) > CONTEXT_PACK_MAX_RISK_PARTIAL_TOKENS
    ) {
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

  return {
    selectedRawPartialFlows,
    partialBytes,
    partialTokens,
    omittedPartialFlows
  };
};
