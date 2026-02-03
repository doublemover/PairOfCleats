export const REQUIRED_ARTIFACTS = {
  FILTER_INDEX: 'filterIndex',
  FILE_RELATIONS: 'fileRelations',
  GRAPH_RELATIONS: 'graphRelations',
  REPO_MAP: 'repoMap',
  CONTEXT_INDEX: 'contextIndex',
  ANN: 'ann'
};

const ARTIFACT_DEPENDENCIES = new Map([
  [REQUIRED_ARTIFACTS.REPO_MAP, [REQUIRED_ARTIFACTS.GRAPH_RELATIONS]]
]);

const addDependencies = (required) => {
  const queue = Array.from(required);
  while (queue.length) {
    const current = queue.shift();
    const deps = ARTIFACT_DEPENDENCIES.get(current);
    if (!deps) continue;
    for (const dep of deps) {
      if (required.has(dep)) continue;
      required.add(dep);
      queue.push(dep);
    }
  }
  return required;
};

const resolveContextFlags = (options = {}) => ({
  includeCalls: options.includeCalls !== false,
  includeImports: options.includeImports !== false,
  includeExports: options.includeExports === true,
  includeUsages: options.includeUsages === true
});

export function resolveRequiredArtifacts({
  queryPlan,
  contextExpansionEnabled,
  contextExpansionOptions,
  contextExpansionRespectFilters,
  graphRankingEnabled,
  annActive
} = {}) {
  const required = new Set();
  const filtersActive = Boolean(queryPlan?.filtersActive);
  const filters = queryPlan?.filters || {};

  if (filtersActive) {
    required.add(REQUIRED_ARTIFACTS.FILTER_INDEX);
  }
  if (contextExpansionRespectFilters && filtersActive) {
    required.add(REQUIRED_ARTIFACTS.FILTER_INDEX);
  }

  if (filters?.importName || filters?.uses) {
    required.add(REQUIRED_ARTIFACTS.FILE_RELATIONS);
  }

  if (contextExpansionEnabled) {
    const contextFlags = resolveContextFlags(contextExpansionOptions);
    if (contextFlags.includeImports || contextFlags.includeExports || contextFlags.includeUsages) {
      required.add(REQUIRED_ARTIFACTS.FILE_RELATIONS);
    }
    if (contextFlags.includeCalls || contextFlags.includeImports || contextFlags.includeUsages) {
      required.add(REQUIRED_ARTIFACTS.GRAPH_RELATIONS);
    }
    required.add(REQUIRED_ARTIFACTS.REPO_MAP);
    required.add(REQUIRED_ARTIFACTS.CONTEXT_INDEX);
  }

  if (graphRankingEnabled) {
    required.add(REQUIRED_ARTIFACTS.GRAPH_RELATIONS);
  }

  if (annActive) {
    required.add(REQUIRED_ARTIFACTS.ANN);
  }

  return addDependencies(required);
}
