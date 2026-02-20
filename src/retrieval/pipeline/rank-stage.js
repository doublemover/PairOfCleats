import { createTopKReducer } from './topk.js';
import { applyGraphRanking } from './graph-ranking.js';
import { createScoreBreakdown } from '../output/score-breakdown.js';
import { computeRelationBoost } from '../scoring/relation-boost.js';
import { resolveAnnType } from './provider-runtime.js';

/**
 * Execute ranking stage over fused sparse+ANN scores.
 * @param {object} input
 * @returns {Array<object>}
 */
export const runRankStage = ({
  idx,
  meta,
  fusedScores,
  useRrf,
  allowedIdx,
  hasAllowedId,
  abortIfNeeded,
  searchTopN,
  topkSlack,
  poolSnapshotStart,
  poolSnapshot,
  rankMetrics,
  explain,
  matchesQueryAst,
  getPhraseMatchInfo,
  phraseNgramSet,
  symbolBoostEnabled,
  symbolBoostDefinitionWeight,
  symbolBoostExportWeight,
  isDefinitionKind,
  isExportedChunk,
  relationBoostEnabled,
  relationBoostConfig,
  resolveFileRelations,
  queryTokens,
  graphRankingConfig,
  sqliteFtsNormalize,
  sqliteFtsWeights,
  sqliteFtsProfile,
  sqliteFtsCompilation,
  sqliteFtsUnavailable,
  profileId,
  fieldWeightsEnabled,
  bm25K1,
  bm25B,
  sqliteFtsDesiredForMode,
  annCandidatePolicy,
  blendEnabled
}) => {
  const topkStats = {};
  const reducer = createTopKReducer({
    k: searchTopN,
    slack: topkSlack,
    stats: topkStats,
    buildPayload: (entry) => entry?.payload ?? entry?.item ?? entry
  });

  const relationsByFile = new Map();
  const enrichedChunkByIdx = new Map();
  const processEntry = (entry, sourceRank) => {
    if (!entry) return;
    if (allowedIdx && !hasAllowedId(allowedIdx, entry.idx)) return;
    abortIfNeeded();
    const idxVal = entry.idx;
    const sparseScore = entry.sparseScore;
    const annScore = entry.annScore;
    const sparseTypeValue = entry.sparseType;
    const scoreType = entry.scoreType;
    let score = entry.score;
    const blendInfo = entry.blendInfo;
    const chunk = meta[idxVal];
    if (!chunk) return;
    if (!matchesQueryAst(idx, idxVal, chunk)) return;

    let enrichedChunk = enrichedChunkByIdx.get(idxVal) || null;
    let fileRelations = null;
    if (!enrichedChunk) {
      const filePath = chunk.file || '';
      if (relationsByFile.has(filePath)) {
        fileRelations = relationsByFile.get(filePath);
      } else {
        fileRelations = resolveFileRelations(
          idx.fileRelations,
          filePath,
          relationBoostConfig.caseFile
        );
        relationsByFile.set(filePath, fileRelations || null);
      }
      enrichedChunk = fileRelations
        ? {
          ...chunk,
          imports: fileRelations.imports || chunk.imports,
          exports: fileRelations.exports || chunk.exports,
          usages: fileRelations.usages || chunk.usages,
          importLinks: fileRelations.importLinks || chunk.importLinks
        }
        : chunk;
      enrichedChunkByIdx.set(idxVal, enrichedChunk);
    } else if (enrichedChunk !== chunk) {
      const filePath = chunk.file || '';
      fileRelations = relationsByFile.has(filePath)
        ? relationsByFile.get(filePath)
        : resolveFileRelations(idx.fileRelations, filePath, relationBoostConfig.caseFile);
      if (!relationsByFile.has(filePath)) relationsByFile.set(filePath, fileRelations || null);
    }

    let phraseMatches = 0;
    let phraseBoost = 0;
    let phraseFactor = 0;
    if (phraseNgramSet && phraseNgramSet.size) {
      const matchInfo = getPhraseMatchInfo(idx, idxVal, phraseNgramSet, chunk?.tokens);
      phraseMatches = matchInfo.matches;
      if (phraseMatches) {
        phraseFactor = Math.min(0.5, phraseMatches * 0.1);
        phraseBoost = score * phraseFactor;
        score += phraseBoost;
      }
    }
    let symbolBoost = 0;
    let symbolFactor = 1;
    let symbolInfo = null;
    if (symbolBoostEnabled) {
      const isDefinition = isDefinitionKind(chunk.kind);
      const isExported = isExportedChunk(enrichedChunk);
      let factor = 1;
      if (isDefinition) factor *= symbolBoostDefinitionWeight;
      if (isExported) factor *= symbolBoostExportWeight;
      symbolFactor = factor;
      if (factor !== 1) {
        symbolBoost = score * (factor - 1);
        score *= factor;
      }
      symbolInfo = {
        definition: isDefinition,
        export: isExported,
        factor: symbolFactor,
        boost: symbolBoost
      };
    }
    let relationInfo = null;
    if (relationBoostEnabled) {
      relationInfo = computeRelationBoost({
        chunk: enrichedChunk,
        fileRelations,
        queryTokens,
        config: relationBoostConfig
      });
      if (Number.isFinite(relationInfo?.boost) && relationInfo.boost > 0) {
        score += relationInfo.boost;
      }
    }
    const scoreBreakdown = explain
      ? createScoreBreakdown({
        sparse: sparseScore != null ? {
          type: sparseTypeValue,
          score: sparseScore,
          normalized: sparseTypeValue === 'fts' ? sqliteFtsNormalize : null,
          weights: sparseTypeValue === 'fts' ? sqliteFtsWeights : null,
          profile: sparseTypeValue === 'fts' ? sqliteFtsProfile : null,
          match: sparseTypeValue === 'fts' ? sqliteFtsCompilation.match : null,
          variant: sparseTypeValue === 'fts' ? sqliteFtsCompilation.variant : null,
          tokenizer: sparseTypeValue === 'fts' ? sqliteFtsCompilation.tokenizer : null,
          variantReason: sparseTypeValue === 'fts' ? sqliteFtsCompilation.reasonPath : null,
          normalizedQueryChanged: sparseTypeValue === 'fts' ? sqliteFtsCompilation.normalizedChanged : null,
          availabilityCode: sqliteFtsUnavailable?.code || null,
          availabilityReason: sqliteFtsUnavailable?.reason || null,
          indexProfile: profileId || null,
          fielded: fieldWeightsEnabled || false,
          k1: sparseTypeValue && sparseTypeValue !== 'fts' ? bm25K1 : null,
          b: sparseTypeValue && sparseTypeValue !== 'fts' ? bm25B : null,
          ftsFallback: sqliteFtsDesiredForMode ? sparseTypeValue !== 'fts' : false
        } : null,
        ann: annScore != null ? {
          score: annScore,
          source: entry.annSource || null,
          candidatePolicy: annCandidatePolicy || null
        } : null,
        rrf: useRrf ? blendInfo : null,
        phrase: phraseNgramSet ? {
          matches: phraseMatches,
          boost: phraseBoost,
          factor: phraseFactor
        } : null,
        symbol: symbolInfo,
        blend: blendEnabled && !useRrf ? blendInfo : null,
        relation: relationInfo,
        selected: {
          type: scoreType,
          score
        }
      })
      : null;
    const payload = {
      idx: idxVal,
      score,
      scoreType,
      scoreBreakdown,
      chunk: enrichedChunk,
      sparseScore,
      sparseType: sparseTypeValue,
      annScore,
      annSource: entry.annSource || null
    };
    reducer.pushRaw(score, idxVal, sourceRank, payload);
  };

  let sourceRank = 0;
  if (Array.isArray(fusedScores)) {
    for (const entry of fusedScores) {
      processEntry(entry, sourceRank);
      sourceRank += 1;
    }
  } else if (fusedScores && Array.isArray(fusedScores.entries)) {
    for (let i = 0; i < fusedScores.count; i += 1) {
      processEntry(fusedScores.entries[i], sourceRank);
      sourceRank += 1;
    }
  }

  let scored = reducer.finish({ limit: searchTopN });
  const poolStatsEnd = poolSnapshot();
  rankMetrics.topk = {
    k: searchTopN,
    slack: topkSlack,
    ...topkStats
  };
  rankMetrics.buffers = {
    candidate: {
      allocations: (poolStatsEnd.candidate.allocations || 0) - (poolSnapshotStart.candidate.allocations || 0),
      reuses: (poolStatsEnd.candidate.reuses || 0) - (poolSnapshotStart.candidate.reuses || 0),
      drops: (poolStatsEnd.candidate.drops || 0) - (poolSnapshotStart.candidate.drops || 0)
    },
    score: {
      allocations: (poolStatsEnd.score.allocations || 0) - (poolSnapshotStart.score.allocations || 0),
      reuses: (poolStatsEnd.score.reuses || 0) - (poolSnapshotStart.score.reuses || 0),
      drops: (poolStatsEnd.score.drops || 0) - (poolSnapshotStart.score.drops || 0)
    }
  };

  if (graphRankingConfig?.enabled) {
    const ranked = applyGraphRanking({
      entries: scored,
      graphRelations: idx.graphRelations || null,
      config: graphRankingConfig,
      explain
    });
    scored = ranked.entries;
  }

  return scored
    .map((entry) => ({
      ...entry.chunk,
      score: entry.score,
      scoreType: entry.scoreType,
      sparseScore: entry.sparseScore,
      sparseType: entry.sparseType,
      annScore: entry.annScore,
      annSource: entry.annSource,
      annType: resolveAnnType(entry.annSource),
      ...(explain ? { scoreBreakdown: entry.scoreBreakdown } : {})
    }))
    .filter(Boolean);
};
