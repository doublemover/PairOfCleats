import { loadUserConfig } from '../../../shared/dict-utils.js';
import { resolveIndexDir } from '../../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../../src/retrieval/cli/index-loader.js';
import { createError, ERROR_CODES } from '../../../../src/shared/error-codes.js';
import { attachObservability, buildChildObservability } from '../../../../src/shared/observability.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../../../src/shared/risk-filters.js';
import { buildCompositeContextPackPayload } from '../../../../src/integrations/tooling/context-pack.js';
import { buildRiskExplainPayload } from '../../../analysis/explain-risk.js';
import { resolveRepoPath } from '../../repo.js';

export async function runRiskExplain(args = {}, context = {}) {
  if (context.signal?.aborted) {
    throw createError(ERROR_CODES.CANCELLED, 'Request cancelled.');
  }
  const repoPath = resolveRepoPath(args.repoPath);
  const chunkUid = String(args.chunk || '').trim();
  if (!chunkUid) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'chunk is required.');
  }
  const userConfig = loadUserConfig(repoPath);
  const indexDir = resolveIndexDir(repoPath, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw createError(ERROR_CODES.NO_INDEX, `Code index not found at ${indexDir}.`);
  }
  const filters = normalizeRiskFilters(args.filters || null);
  const validation = validateRiskFilters(filters);
  if (!validation.ok) {
    throw createError(ERROR_CODES.INVALID_REQUEST, `Invalid risk filters: ${validation.errors.join('; ')}`);
  }
  const observability = buildChildObservability(context.observability, {
    surface: 'analysis',
    operation: 'risk_explain',
    context: {
      repoRoot: repoPath,
      chunkUid
    }
  });
  if (typeof context.progress === 'function') {
    context.progress({ phase: 'start', message: 'Building risk explanation.', observability });
  }
  const result = await buildRiskExplainPayload({
    indexDir,
    chunkUid,
    max: args.max,
    filters,
    includePartialFlows: args.includePartialFlows === true,
    maxPartialFlows: args.maxPartialFlows
  });
  if (typeof context.progress === 'function') {
    context.progress({ phase: 'done', message: 'Risk explanation ready.', observability });
  }
  return attachObservability(result, observability);
}

export async function runContextPack(args = {}, context = {}) {
  if (context.signal?.aborted) {
    throw createError(ERROR_CODES.CANCELLED, 'Request cancelled.');
  }
  const repoPath = resolveRepoPath(args.repoPath);
  const observability = buildChildObservability(context.observability, {
    surface: 'analysis',
    operation: 'context_pack',
    context: {
      repoRoot: repoPath
    }
  });
  if (typeof context.progress === 'function') {
    context.progress({ phase: 'start', message: 'Building context pack.', observability });
  }
  try {
    const result = await buildCompositeContextPackPayload({
      repoRoot: repoPath,
      seed: args.seed,
      hops: args.hops,
      includeGraph: args.includeGraph,
      includeTypes: args.includeTypes,
      includeRisk: args.includeRisk,
      includeRiskPartialFlows: args.includeRiskPartialFlows,
      strictRisk: args.strictRisk,
      riskFilters: args.filters || null,
      includeImports: args.includeImports,
      includeUsages: args.includeUsages,
      includeCallersCallees: args.includeCallersCallees,
      includePaths: args.includePaths,
      maxBytes: args.maxBytes,
      maxTokens: args.maxTokens,
      maxTypeEntries: args.maxTypeEntries,
      maxDepth: args.maxDepth,
      maxFanoutPerNode: args.maxFanoutPerNode,
      maxNodes: args.maxNodes,
      maxEdges: args.maxEdges,
      maxPaths: args.maxPaths,
      maxCandidates: args.maxCandidates,
      maxWorkUnits: args.maxWorkUnits,
      maxWallClockMs: args.maxWallClockMs
    });
    if (typeof context.progress === 'function') {
      context.progress({ phase: 'done', message: 'Context pack ready.', observability });
    }
    return attachObservability(result, observability);
  } catch (err) {
    if (err?.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST' || err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID') {
      throw createError(ERROR_CODES.INVALID_REQUEST, err.message);
    }
    if (err?.code === 'ERR_CONTEXT_PACK_NO_INDEX') {
      throw createError(ERROR_CODES.NO_INDEX, err.message);
    }
    throw err;
  }
}
