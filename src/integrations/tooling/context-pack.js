import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../shared/risk-filters.js';
import { emitCliError, emitCliOutput, mergeCaps, resolveFormat } from './cli-helpers.js';
import { assembleCompositeContextPack, buildChunkIndex } from '../../context-pack/assemble.js';
import { renderCompositeContextPack, renderCompositeContextPackJson } from '../../retrieval/output/composite-context-pack.js';
import { validateCompositeContextPack } from '../../contracts/validators/analysis.js';
import { ERROR_CODES } from '../../shared/error-codes.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../workspace/config.js';
import { toRealPathSync } from '../../workspace/identity.js';
import { selectWorkspaceRepos } from '../../retrieval/federation/select.js';

const DEFAULT_MAX_FEDERATED_CONTEXT_PACK_REPOS = 4;
const MAX_FEDERATED_CONTEXT_PACK_REPOS = 16;

const buildRiskFilterInput = (input = {}) => ({
  rule: input.rule,
  category: input.category,
  severity: input.severity,
  tag: input.tag,
  source: input.source,
  sink: input.sink,
  flowId: input.flowId ?? input.flow_id ?? input['flow-id'],
  sourceRule: input.sourceRule ?? input.source_rule ?? input['source-rule'],
  sinkRule: input.sinkRule ?? input.sink_rule ?? input['sink-rule']
});

const createContextPackRequestError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const normalizeFederatedRepoLimit = (value) => {
  const parsed = normalizeOptionalNumber(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_FEDERATED_CONTEXT_PACK_REPOS;
  return Math.min(MAX_FEDERATED_CONTEXT_PACK_REPOS, Math.max(1, Math.floor(parsed)));
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const buildRepoProvenance = ({ repoId, alias = null, priority = 0, workspaceId = null, base = false }) => ({
  repoId: repoId || null,
  alias: alias || null,
  priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
  workspaceId: workspaceId || null,
  base: base === true
});

const annotateRiskCallSiteDetails = (details, repo) => {
  if (!details || typeof details !== 'object') return details || null;
  return {
    ...details,
    repo
  };
};

const annotateRiskNode = (node, repo) => {
  if (!node || typeof node !== 'object') return node || null;
  return {
    ...node,
    repo
  };
};

const annotateRiskSourceSink = (entry, repo) => {
  if (!entry || typeof entry !== 'object') return entry || null;
  return {
    ...entry,
    repo
  };
};

const annotateRiskFlow = (flow, repo) => {
  if (!flow || typeof flow !== 'object') return flow || null;
  return {
    ...flow,
    repo,
    source: annotateRiskSourceSink(flow.source, repo),
    sink: annotateRiskSourceSink(flow.sink, repo),
    path: flow.path && typeof flow.path === 'object'
      ? {
        ...flow.path,
        nodes: Array.isArray(flow.path.nodes) ? flow.path.nodes.map((node) => annotateRiskNode(node, repo)) : []
      }
      : flow.path,
    evidence: flow.evidence && typeof flow.evidence === 'object'
      ? {
        ...flow.evidence,
        callSitesByStep: Array.isArray(flow.evidence.callSitesByStep)
          ? flow.evidence.callSitesByStep.map((step) => (
            Array.isArray(step)
              ? step.map((entry) => ({
                ...entry,
                details: annotateRiskCallSiteDetails(entry?.details, repo)
              }))
              : []
          ))
          : flow.evidence.callSitesByStep
      }
      : flow.evidence
  };
};

const annotateRiskPartialFlow = (flow, repo) => {
  if (!flow || typeof flow !== 'object') return flow || null;
  return {
    ...flow,
    repo,
    source: annotateRiskSourceSink(flow.source, repo),
    frontier: flow.frontier && typeof flow.frontier === 'object'
      ? {
        ...flow.frontier,
        repo,
        blockedExpansions: Array.isArray(flow.frontier.blockedExpansions)
          ? flow.frontier.blockedExpansions.map((entry) => ({ ...entry, repo }))
          : []
      }
      : flow.frontier,
    path: flow.path && typeof flow.path === 'object'
      ? {
        ...flow.path,
        nodes: Array.isArray(flow.path.nodes) ? flow.path.nodes.map((node) => annotateRiskNode(node, repo)) : []
      }
      : flow.path,
    evidence: flow.evidence && typeof flow.evidence === 'object'
      ? {
        ...flow.evidence,
        callSitesByStep: Array.isArray(flow.evidence.callSitesByStep)
          ? flow.evidence.callSitesByStep.map((step) => (
            Array.isArray(step)
              ? step.map((entry) => ({
                ...entry,
                details: annotateRiskCallSiteDetails(entry?.details, repo)
              }))
              : []
          ))
          : flow.evidence.callSitesByStep
      }
      : flow.evidence
  };
};

const annotateFederatedRisk = (risk, repo) => {
  if (!risk || typeof risk !== 'object') return risk || null;
  return {
    ...risk,
    summary: risk.summary && typeof risk.summary === 'object'
      ? { ...risk.summary, repo }
      : risk.summary,
    flows: Array.isArray(risk.flows) ? risk.flows.map((flow) => annotateRiskFlow(flow, repo)) : [],
    partialFlows: Array.isArray(risk.partialFlows)
      ? risk.partialFlows.map((flow) => annotateRiskPartialFlow(flow, repo))
      : []
  };
};

const resolveFederatedSelection = (input = {}) => ({
  select: input.select?.repos ?? input.select?.select ?? input.select ?? [],
  tag: input.select?.tags ?? input.select?.tag ?? input.tags ?? input.tag,
  repoFilter: input.select?.repoFilter ?? input.select?.['repo-filter'] ?? input.repoFilter ?? input['repo-filter'],
  includeDisabled: input.select?.includeDisabled === true || input.includeDisabled === true
});

const resolveWorkspaceConfigForContextPack = (input = {}, context = {}) => {
  const trustedWorkspaceConfig = context?.trustedWorkspaceConfig === true
    && input?.workspaceConfig
    && typeof input.workspaceConfig === 'object'
    && !Array.isArray(input.workspaceConfig)
    ? input.workspaceConfig
    : null;
  if (!trustedWorkspaceConfig) {
    const workspacePath = typeof input.workspacePath === 'string' ? input.workspacePath.trim() : '';
    if (!workspacePath) {
      throw createContextPackRequestError(
        'ERR_CONTEXT_PACK_INVALID_REQUEST',
        'Federated context pack requires workspacePath.',
        400
      );
    }
    return loadWorkspaceConfig(workspacePath);
  }
  if (input?.workspaceId && input.workspaceId !== trustedWorkspaceConfig.repoSetId) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_INVALID_REQUEST',
      'workspaceId does not match the provided workspacePath.',
      400
    );
  }
  const requestWorkspacePath = typeof input?.workspacePath === 'string' ? input.workspacePath.trim() : '';
  const trustedWorkspacePath = typeof trustedWorkspaceConfig.workspacePath === 'string'
    ? trustedWorkspaceConfig.workspacePath.trim()
    : '';
  if (requestWorkspacePath && trustedWorkspacePath) {
    if (toRealPathSync(path.resolve(requestWorkspacePath)) !== toRealPathSync(path.resolve(trustedWorkspacePath))) {
      throw createContextPackRequestError(
        'ERR_CONTEXT_PACK_INVALID_REQUEST',
        'workspacePath does not match the provided workspace configuration.',
        400
      );
    }
  }
  return trustedWorkspaceConfig;
};

const shouldUseFederatedContextPack = (input = {}) => {
  const workspacePath = typeof input.workspacePath === 'string' ? input.workspacePath.trim() : '';
  return Boolean(workspacePath || input.workspaceConfig);
};

const buildFederatedRiskMetadata = ({
  workspaceConfig,
  selection,
  baseRepo,
  selectedRepos,
  skippedRepos,
  maxRepos,
  includePaths
}) => ({
  enabled: true,
  workspace: {
    workspaceId: workspaceConfig.repoSetId,
    name: workspaceConfig.name || '',
    workspacePath: includePaths ? workspaceConfig.workspacePath : null
  },
  selection: {
    selectedRepoIds: selectedRepos.map((repo) => repo.repoId),
    selectedRepos: selectedRepos.map((repo) => ({
      repoId: repo.repoId,
      alias: repo.alias || null,
      priority: Number(repo.priority || 0),
      enabled: repo.enabled !== false,
      base: repo.repoId === baseRepo.repoId
    })),
    ...selection.selectionMeta,
    maxRepos,
    bounded: (selection.selectedRepos?.length || 0) > maxRepos
  },
  skippedRepos: skippedRepos.map((entry) => ({
    repoId: entry.repoId,
    alias: entry.alias || null,
    reason: entry.reason || 'unselected'
  }))
});

const compareNullableStrings = (left, right) => String(left || '').localeCompare(String(right || ''));

const rerankFederatedFlows = (flows = []) => flows
  .slice()
  .sort((left, right) => (
    Number(right?.repo?.base === true) - Number(left?.repo?.base === true)
    || Number(right?.repo?.priority || 0) - Number(left?.repo?.priority || 0)
    || Number(right?.score?.seedRelevance || 0) - Number(left?.score?.seedRelevance || 0)
    || Number(right?.score?.severity || 0) - Number(left?.score?.severity || 0)
    || Number(right?.confidence || 0) - Number(left?.confidence || 0)
    || compareNullableStrings(left?.repo?.alias, right?.repo?.alias)
    || compareNullableStrings(left?.flowId, right?.flowId)
  ))
  .map((flow, index) => ({ ...flow, rank: index + 1 }));

const rerankFederatedPartialFlows = (flows = []) => flows
  .slice()
  .sort((left, right) => (
    Number(right?.repo?.base === true) - Number(left?.repo?.base === true)
    || Number(right?.repo?.priority || 0) - Number(left?.repo?.priority || 0)
    || Number(right?.score?.seedRelevance || 0) - Number(left?.score?.seedRelevance || 0)
    || Number(right?.confidence || 0) - Number(left?.confidence || 0)
    || compareNullableStrings(left?.repo?.alias, right?.repo?.alias)
    || compareNullableStrings(left?.partialFlowId, right?.partialFlowId)
  ))
  .map((flow, index) => ({ ...flow, rank: index + 1 }));

const mergeFederatedRiskPayloads = ({ basePayload, repoResults, workspaceConfig, selection, maxRepos, includePaths }) => {
  const baseResult = repoResults.find((entry) => entry.repo.repoId === basePayload?.risk?.federation?.baseRepoId)
    || repoResults[0];
  const baseRepo = baseResult.repo;
  const selectedRepos = repoResults.map((entry) => entry.repo);
  const selectedRepoIds = new Set(selectedRepos.map((repo) => repo.repoId));
  const skippedRepos = selection.selectedRepos
    .filter((repo) => !selectedRepoIds.has(repo.repoId))
    .map((repo) => ({ ...repo, reason: 'repo-cap' }));
  const federation = buildFederatedRiskMetadata({
    workspaceConfig,
    selection,
    baseRepo,
    selectedRepos,
    skippedRepos,
    maxRepos,
    includePaths
  });
  const mergedFlows = rerankFederatedFlows(repoResults.flatMap((entry) => entry.payload.risk?.flows || []));
  const mergedPartialFlows = rerankFederatedPartialFlows(repoResults.flatMap((entry) => entry.payload.risk?.partialFlows || []));
  const mergedWarnings = Array.from(new Set(
    repoResults.flatMap((entry) => Array.isArray(entry.payload?.warnings) ? entry.payload.warnings.map((warning) => JSON.stringify(warning)) : [])
  )).map((entry) => JSON.parse(entry));
  const mergedTruncation = Array.from(new Set(
    repoResults.flatMap((entry) => Array.isArray(entry.payload?.risk?.truncation) ? entry.payload.risk.truncation.map((item) => JSON.stringify(item)) : [])
  )).map((entry) => JSON.parse(entry));
  const degraded = repoResults.some((entry) => entry.payload?.risk?.degraded === true);
  return {
    ...basePayload,
    warnings: mergedWarnings.length ? mergedWarnings : basePayload.warnings,
    risk: {
      ...basePayload.risk,
      status: degraded ? 'degraded' : basePayload.risk.status,
      degraded: degraded || basePayload.risk.degraded === true,
      reason: degraded ? 'federated-partial-artifacts' : basePayload.risk.reason,
      flows: mergedFlows,
      partialFlows: mergedPartialFlows,
      truncation: mergedTruncation.length ? mergedTruncation : basePayload.risk.truncation,
      federation
    }
  };
};

async function buildSingleRepoCompositeContextPackPayload(input = {}) {
  const repoRoot = input.repoRoot ? path.resolve(input.repoRoot) : resolveRepoRoot(process.cwd());
  if (!input.seed) {
    throw createContextPackRequestError('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Missing seed.', 400);
  }
  if (!Number.isFinite(Number(input.hops))) {
    throw createContextPackRequestError('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Missing hops.', 400);
  }

  const riskFilters = normalizeRiskFilters(buildRiskFilterInput(input.riskFilters || {}));
  const filterValidation = validateRiskFilters(riskFilters);
  if (!filterValidation.ok) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_RISK_FILTER_INVALID',
      `Invalid risk filters: ${filterValidation.errors.join('; ')}`,
      400
    );
  }

  const seed = typeof input.seed === 'string'
    ? parseSeedRef(input.seed, repoRoot)
    : input.seed;
  const userConfig = loadUserConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw createContextPackRequestError('ERR_CONTEXT_PACK_NO_INDEX', `Code index not found at ${indexDir}.`, 404);
  }

  const graphInputs = await prepareGraphInputs({
    repoRoot,
    indexDir,
    strict: true,
    includeChunkMeta: true
  });
  const chunkMeta = graphInputs.chunkMeta;
  const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });

  const baseCaps = userConfig?.retrieval?.graph?.caps || {};
  const capOverrides = {
    maxDepth: normalizeOptionalNumber(input.maxDepth),
    maxFanoutPerNode: normalizeOptionalNumber(input.maxFanoutPerNode),
    maxNodes: normalizeOptionalNumber(input.maxNodes),
    maxEdges: normalizeOptionalNumber(input.maxEdges),
    maxPaths: normalizeOptionalNumber(input.maxPaths),
    maxCandidates: normalizeOptionalNumber(input.maxCandidates),
    maxWorkUnits: normalizeOptionalNumber(input.maxWorkUnits),
    maxWallClockMs: normalizeOptionalNumber(input.maxWallClockMs)
  };
  const caps = mergeCaps(baseCaps, capOverrides);

  const graphList = [];
  if (input.includeCallersCallees !== false) graphList.push('callGraph');
  if (input.includeUsages !== false) graphList.push('usageGraph');
  if (input.includeImports !== false) graphList.push('importGraph');
  const { graphIndex } = await prepareGraphIndex({
    repoRoot,
    indexDir,
    selection: graphList,
    strict: true,
    graphInputs,
    includeGraphIndex: input.includeGraph !== false
  });

  const payload = assembleCompositeContextPack({
    seed,
    chunkMeta,
    chunkIndex,
    repoRoot,
    graphIndex,
    includeGraph: input.includeGraph !== false,
    includeTypes: input.includeTypes === true,
    includeRisk: input.includeRisk === true,
    includeRiskPartialFlows: input.includeRiskPartialFlows === true,
    riskStrict: input.strictRisk === true,
    riskFilters,
    includeImports: input.includeImports !== false,
    includeUsages: input.includeUsages !== false,
    includeCallersCallees: input.includeCallersCallees !== false,
    includePaths: input.includePaths === true,
    depth: Math.max(0, Math.floor(Number(input.hops))),
    maxBytes: normalizeOptionalNumber(input.maxBytes),
    maxTokens: normalizeOptionalNumber(input.maxTokens),
    maxTypeEntries: normalizeOptionalNumber(input.maxTypeEntries),
    caps,
    indexCompatKey: graphInputs.indexCompatKey || null,
    indexSignature: graphInputs.indexSignature || null,
    repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
    indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
  });

  const validation = validateCompositeContextPack(payload);
  if (!validation.ok) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_SCHEMA',
      `CompositeContextPack schema validation failed: ${validation.errors.join('; ')}`,
      500
    );
  }

  return payload;
}

export async function buildFederatedCompositeContextPackPayload(input = {}, context = {}) {
  const workspaceConfig = resolveWorkspaceConfigForContextPack(input, context);
  if (input.workspaceId && input.workspaceId !== workspaceConfig.repoSetId) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_INVALID_REQUEST',
      'workspaceId does not match the provided workspacePath.',
      400
    );
  }
  const selection = selectWorkspaceRepos({
    workspaceConfig,
    ...resolveFederatedSelection(input)
  });
  if (!selection.selectedRepos.length) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_INVALID_REQUEST',
      'Federated context pack selection resolved to zero repositories.',
      400
    );
  }
  const maxRepos = normalizeFederatedRepoLimit(input.maxFederatedRepos);
  const boundedRepos = selection.selectedRepos.slice(0, maxRepos);
  const repoRootCanonical = input.repoRoot ? toRealPathSync(path.resolve(input.repoRoot)) : null;
  const baseRepo = repoRootCanonical
    ? boundedRepos.find((repo) => repo.repoRootCanonical === repoRootCanonical)
    : boundedRepos[0];
  if (repoRootCanonical && !baseRepo) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_INVALID_REQUEST',
      'repoRoot is not part of the selected workspace context-pack scope.',
      400
    );
  }

  const repoResults = [];
  for (const repo of boundedRepos) {
    const repoInfo = buildRepoProvenance({
      repoId: repo.repoId,
      alias: repo.alias,
      priority: repo.priority,
      workspaceId: workspaceConfig.repoSetId,
      base: repo.repoId === baseRepo.repoId
    });
    const repoPayload = await buildSingleRepoCompositeContextPackPayload({
      ...input,
      repoRoot: repo.repoRootCanonical
    });
    repoResults.push({
      repo,
      payload: {
        ...repoPayload,
        risk: annotateFederatedRisk(repoPayload.risk, repoInfo)
      }
    });
  }

  const baseResult = repoResults.find((entry) => entry.repo.repoId === baseRepo.repoId) || repoResults[0];
  const basePayload = cloneJson(baseResult.payload);
  if (!basePayload.risk || input.includeRisk !== true) {
    return basePayload;
  }

  return mergeFederatedRiskPayloads({
    basePayload: {
      ...basePayload,
      risk: {
        ...basePayload.risk,
        federation: {
          baseRepoId: baseRepo.repoId
        }
      }
    },
    repoResults,
    workspaceConfig,
    selection,
    maxRepos,
    includePaths: input.includePaths === true
  });
}

/**
 * Build a composite context-pack payload using the shared CLI/runtime assembly.
 *
 * This is the authoritative cross-surface path for CLI, API, and MCP so seed
 * parsing, risk-filter validation, graph preparation, and empty-result
 * behavior stay aligned.
 *
 * @param {{
 *   repoRoot?:string,
 *   workspacePath?:string,
 *   workspaceId?:string,
 *   workspaceConfig?:object|null,
 *   select?:string|string[]|object,
 *   tag?:string|string[],
 *   repoFilter?:string|string[],
 *   includeDisabled?:boolean,
 *   maxFederatedRepos?:number|null,
 *   seed:string|object,
 *   hops:number,
 *   includeGraph?:boolean,
 *   includeTypes?:boolean,
 *   includeRisk?:boolean,
 *   includeRiskPartialFlows?:boolean,
 *   strictRisk?:boolean,
 *   riskFilters?:object|null,
 *   includeImports?:boolean,
 *   includeUsages?:boolean,
 *   includeCallersCallees?:boolean,
 *   includePaths?:boolean,
 *   maxBytes?:number|null,
 *   maxTokens?:number|null,
 *   maxTypeEntries?:number|null,
 *   maxDepth?:number|null,
 *   maxFanoutPerNode?:number|null,
 *   maxNodes?:number|null,
 *   maxEdges?:number|null,
 *   maxPaths?:number|null,
 *   maxCandidates?:number|null,
 *   maxWorkUnits?:number|null,
 *   maxWallClockMs?:number|null
 * }} [input]
 * @param {{trustedWorkspaceConfig?:boolean}} [context]
 * @returns {Promise<object>}
 */
export async function buildCompositeContextPackPayload(input = {}, context = {}) {
  if (shouldUseFederatedContextPack(input)) {
    return await buildFederatedCompositeContextPackPayload(input, context);
  }
  return await buildSingleRepoCompositeContextPackPayload(input);
}

/**
 * CLI entrypoint for composite context-pack generation.
 *
 * Parses seed-centric context options, resolves graph/index dependencies, and
 * emits a contract-validated `CompositeContextPack` report.
 *
 * @param {string[]} [rawArgs]
 * @returns {Promise<{ok:boolean,code?:string,payload?:object,message?:string}>}
 */
export async function runContextPackCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'context-pack',
    argv: ['node', 'context-pack', ...rawArgs],
    options: {
      repo: { type: 'string' },
      seed: { type: 'string' },
      hops: { type: 'number' },
      maxTokens: { type: 'number' },
      maxBytes: { type: 'number' },
      includeGraph: { type: 'boolean', default: true },
      includeTypes: { type: 'boolean', default: false },
      includeRisk: { type: 'boolean', default: false },
      includeRiskPartialFlows: { type: 'boolean', default: false },
      strictRisk: { type: 'boolean', default: false },
      rule: { type: 'string' },
      category: { type: 'string' },
      severity: { type: 'string' },
      tag: { type: 'string' },
      source: { type: 'string' },
      sink: { type: 'string' },
      'flow-id': { type: 'string' },
      'source-rule': { type: 'string' },
      'sink-rule': { type: 'string' },
      includeImports: { type: 'boolean', default: true },
      includeUsages: { type: 'boolean', default: true },
      includeCallersCallees: { type: 'boolean', default: true },
      includePaths: { type: 'boolean', default: false },
      maxTypeEntries: { type: 'number' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      maxDepth: { type: 'number' },
      maxFanoutPerNode: { type: 'number' },
      maxNodes: { type: 'number' },
      maxEdges: { type: 'number' },
      maxPaths: { type: 'number' },
      maxCandidates: { type: 'number' },
      maxWorkUnits: { type: 'number' },
      maxWallClockMs: { type: 'number' },
      workspace: { type: 'string' },
      workspaceId: { type: 'string' },
      select: { type: 'string' },
      'repo-filter': { type: 'string' },
      includeDisabled: { type: 'boolean', default: false },
      maxFederatedRepos: { type: 'number' }
    }
  });
  const argv = cli.parse();

  const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const format = resolveFormat(argv);

  try {
    const payload = await buildCompositeContextPackPayload({
      repoRoot,
      seed: argv.seed,
      hops: argv.hops,
      includeGraph: argv.includeGraph,
      includeTypes: argv.includeTypes,
      includeRisk: argv.includeRisk,
      includeRiskPartialFlows: argv.includeRiskPartialFlows,
      strictRisk: argv.strictRisk,
      riskFilters: buildRiskFilterInput(argv),
      includeImports: argv.includeImports,
      includeUsages: argv.includeUsages,
      includeCallersCallees: argv.includeCallersCallees,
      includePaths: argv.includePaths,
      maxBytes: argv.maxBytes,
      maxTokens: argv.maxTokens,
      maxTypeEntries: argv.maxTypeEntries,
      maxDepth: argv.maxDepth,
      maxFanoutPerNode: argv.maxFanoutPerNode,
      maxNodes: argv.maxNodes,
      maxEdges: argv.maxEdges,
      maxPaths: argv.maxPaths,
      maxCandidates: argv.maxCandidates,
      maxWorkUnits: argv.maxWorkUnits,
      maxWallClockMs: argv.maxWallClockMs,
      workspacePath: argv.workspace,
      workspaceId: argv.workspaceId,
      select: argv.select,
      repoFilter: argv['repo-filter'],
      includeDisabled: argv.includeDisabled,
      maxFederatedRepos: argv.maxFederatedRepos
    });

    return emitCliOutput({
      format,
      payload,
      renderMarkdown: renderCompositeContextPack,
      renderJson: renderCompositeContextPackJson
    });
  } catch (err) {
    const message = err?.message || String(err);
    const details = err?.code === 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID'
      ? {
        canonicalCode: ERROR_CODES.INVALID_REQUEST,
        reason: 'invalid_risk_filters'
      }
      : null;
    return emitCliError({ format, code: err?.code || 'ERR_CONTEXT_PACK', message, details });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runContextPackCli()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
