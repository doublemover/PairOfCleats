import { compareStrings } from '../shared/sort.js';

const resolveRiskSeverityWeight = (value) => {
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
};

const resolveRiskSeedRelevance = (flow, riskAnchor) => {
  if (!flow || !riskAnchor) return 0;
  const anchorChunkUid = riskAnchor?.chunkUid || null;
  if (!anchorChunkUid) return 0;
  const anchorKind = riskAnchor?.kind || null;
  if (anchorKind === 'source' && flow?.source?.chunkUid === anchorChunkUid) return 3;
  if (anchorKind === 'sink' && flow?.sink?.chunkUid === anchorChunkUid) return 3;
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

export const rankRiskFlows = (flows, riskAnchor) => Array.from(Array.isArray(flows) ? flows : [])
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

export const rankPartialRiskFlows = (flows, riskAnchor) => Array.from(Array.isArray(flows) ? flows : [])
  .map((flow) => ({
    flow,
    score: {
      seedRelevance: resolveRiskSeedRelevance(flow, riskAnchor),
      confidence: Number.isFinite(flow?.confidence) ? flow.confidence : -1,
      hopCount: Number.isFinite(flow?.notes?.hopCount) ? flow.notes.hopCount : Number.MAX_SAFE_INTEGER
    }
  }))
  .sort((a, b) => {
    if (a.score.seedRelevance !== b.score.seedRelevance) return b.score.seedRelevance - a.score.seedRelevance;
    if (a.score.confidence !== b.score.confidence) return b.score.confidence - a.score.confidence;
    if (a.score.hopCount !== b.score.hopCount) return a.score.hopCount - b.score.hopCount;
    return compareStrings(a.flow?.partialFlowId || '', b.flow?.partialFlowId || '');
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

export const resolveRiskAnchor = ({ rankedFlows, riskSeedContext, warnings }) => {
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
