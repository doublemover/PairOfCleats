import { buildRiskFilterInput } from './risk-filters.js';

const CONTEXT_PACK_PAYLOAD_FIELDS = Object.freeze([
  'seed',
  'hops',
  'includeGraph',
  'includeTypes',
  'includeRisk',
  'includeRiskPartialFlows',
  'strictRisk',
  'strictEvidence',
  'includeImports',
  'includeUsages',
  'includeCallersCallees',
  'includePaths',
  'maxBytes',
  'maxTokens',
  'maxTypeEntries',
  'maxDepth',
  'maxFanoutPerNode',
  'maxNodes',
  'maxEdges',
  'maxPaths',
  'maxCandidates',
  'maxWorkUnits',
  'maxWallClockMs',
  'maxFederatedRepos'
]);

const pickOverride = (override, fallback) => (
  override === undefined ? fallback : override
);

const defaultRiskFilters = (source) => (
  source.riskFilters !== undefined ? source.riskFilters : (source.filters || null)
);

/**
 * Project API/MCP-style context-pack input into the composite payload builder
 * shape. This intentionally does not validate, normalize, resolve repos, or
 * enforce workspace trust; those are surface-specific contracts.
 *
 * @param {object} [source]
 * @param {object} [options]
 * @returns {object}
 */
export function buildContextPackRequestInput(source = {}, {
  repoRoot = undefined,
  workspacePath = undefined,
  workspaceId = undefined,
  workspaceConfig = undefined,
  select = undefined,
  includeDisabled = undefined,
  repoFilter = undefined,
  riskFilters = undefined
} = {}) {
  const request = {
    repoRoot: pickOverride(repoRoot, source.repoRoot),
    riskFilters: pickOverride(riskFilters, defaultRiskFilters(source)),
    workspacePath: pickOverride(workspacePath, source.workspacePath),
    workspaceId: pickOverride(workspaceId, source.workspaceId),
    select: pickOverride(select, source.select),
    includeDisabled: pickOverride(includeDisabled, source.includeDisabled)
  };

  if (workspaceConfig !== undefined) {
    request.workspaceConfig = workspaceConfig;
  }
  if (repoFilter !== undefined) {
    request.repoFilter = repoFilter;
  }

  for (const field of CONTEXT_PACK_PAYLOAD_FIELDS) {
    request[field] = source[field];
  }

  return request;
}

/**
 * Project CLI argv into context-pack builder input while preserving CLI-only
 * aliases such as --workspace and --repo-filter.
 *
 * @param {object} [argv]
 * @param {{repoRoot?:string|null}} [options]
 * @returns {object}
 */
export function buildCliContextPackRequestInput(argv = {}, { repoRoot = undefined } = {}) {
  return buildContextPackRequestInput(argv, {
    repoRoot,
    workspacePath: argv.workspace ?? argv.workspacePath,
    repoFilter: argv.repoFilter ?? argv['repo-filter'],
    riskFilters: buildRiskFilterInput(argv)
  });
}
