import { compareStrings } from '../../shared/sort.js';
import { buildSuggestTestsReport } from '../../graph/suggest-tests.js';

export const CONTEXT_PACK_MAX_RISK_GUIDANCE_CALLERS = 3;
export const CONTEXT_PACK_MAX_RISK_GUIDANCE_SYMBOLS = 5;
export const CONTEXT_PACK_MAX_RISK_GUIDANCE_TESTS = 3;

export const buildRiskGuidance = ({
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
