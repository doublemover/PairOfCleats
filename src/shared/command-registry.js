const entry = (id, commandPath, script, description, extras = {}) => Object.freeze({
  id,
  commandPath: Object.freeze(commandPath.slice()),
  script,
  description,
  supportTier: extras.supportTier || 'stable',
  helpGroup: extras.helpGroup || 'Other',
  progressMode: extras.progressMode || 'jsonl',
  extraArgs: Object.freeze(Array.isArray(extras.extraArgs) ? extras.extraArgs.slice() : []),
  expectedArtifacts: Object.freeze(Array.isArray(extras.expectedArtifacts) ? extras.expectedArtifacts.slice() : []),
  helpExamples: Object.freeze(Array.isArray(extras.helpExamples) ? extras.helpExamples.slice() : []),
  metadata: Object.freeze(extras.metadata && typeof extras.metadata === 'object' ? { ...extras.metadata } : {}),
  capability: extras.capability === false
    ? false
    : Object.freeze(extras.capability && typeof extras.capability === 'object' ? { ...extras.capability } : {}),
  dispatchListed: extras.dispatchListed !== false
});

export const COMMAND_HELP_GROUP_ORDER = Object.freeze([
  'Core',
  'CLI',
  'Config',
  'Index',
  'SQLite',
  'Search',
  'Workspace',
  'Service',
  'Bench',
  'Ingest',
  'TUI',
  'Dispatch',
  'Tooling',
  'Cache',
  'LMDB',
  'Report',
  'Graph',
  'Risk',
  'Other'
]);

export const COMMAND_SUPPORT_TIER_ORDER = Object.freeze([
  'stable',
  'operator',
  'internal',
  'experimental'
]);

export const COMMAND_SUPPORT_TIER_LABELS = Object.freeze({
  stable: 'Stable',
  operator: 'Operator',
  internal: 'Internal',
  experimental: 'Experimental'
});

export const DEFAULT_HELP_SUPPORT_TIERS = Object.freeze(['stable', 'operator']);

export const commandPathKey = (parts) => parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ');

export const cloneCommandRegistryEntry = (entry) => ({
  id: entry.id,
  commandPath: entry.commandPath.slice(),
  script: entry.script,
  description: entry.description,
  supportTier: entry.supportTier,
  helpGroup: entry.helpGroup,
  progressMode: entry.progressMode,
  extraArgs: entry.extraArgs.slice(),
  expectedArtifacts: entry.expectedArtifacts.slice(),
  helpExamples: entry.helpExamples.slice(),
  metadata: { ...entry.metadata },
  capability: entry.capability === false
    ? false
    : { ...entry.capability },
  dispatchListed: entry.dispatchListed !== false
});

export const COMMAND_REGISTRY = Object.freeze([
  entry('setup', ['setup'], 'tools/setup/setup.js', 'Guided setup flow.', {
    helpGroup: 'Core',
    expectedArtifacts: ['config:file', 'cache:dicts', 'cache:models']
  }),
  entry('bootstrap', ['bootstrap'], 'tools/setup/bootstrap.js', 'Fast bootstrap flow.', {
    helpGroup: 'Core',
    expectedArtifacts: ['config:file', 'cache:dicts', 'cache:models', 'index:code', 'index:prose', 'index:records'],
    helpExamples: ['pairofcleats bootstrap']
  }),
  entry('cli.completions', ['cli', 'completions'], 'tools/cli/completions.js', 'Generate shell completions for the canonical CLI surface.', {
    helpGroup: 'CLI',
    supportTier: 'operator',
    capability: false,
    helpExamples: ['pairofcleats cli completions --shell powershell']
  }),
  entry('cli.audit', ['cli', 'audit'], 'tools/ci/check-command-surface.js', 'Run the local command-surface self-audit.', {
    helpGroup: 'CLI',
    supportTier: 'operator',
    capability: false,
    helpExamples: ['pairofcleats cli audit --json']
  }),
  entry('config.dump', ['config', 'dump'], 'tools/config/dump.js', 'Dump effective config and derived runtime state.', {
    helpGroup: 'Config',
    capability: false
  }),
  entry('config.validate', ['config', 'validate'], 'tools/config/validate.js', 'Validate repo config against the schema.', {
    helpGroup: 'Config',
    capability: false
  }),
  entry('config.reset', ['config', 'reset'], 'tools/config/reset.js', 'Reset repo config back to the default template.', {
    helpGroup: 'Config',
    capability: false
  }),
  entry('index.build', ['index', 'build'], 'build_index.js', 'Build file-backed indexes.', {
    helpGroup: 'Index',
    expectedArtifacts: ['index:code', 'index:prose', 'index:records'],
    helpExamples: ['pairofcleats index build --repo .']
  }),
  entry('index.watch', ['index', 'watch'], 'build_index.js', 'Watch and rebuild indexes.', {
    helpGroup: 'Index',
    extraArgs: ['--watch'],
    expectedArtifacts: ['index:code', 'index:prose', 'index:records']
  }),
  entry('index.validate', ['index', 'validate'], 'tools/index/validate.js', 'Validate index artifacts.', {
    helpGroup: 'Index'
  }),
  entry('index.stats', ['index', 'stats'], 'tools/index/stats.js', 'Report per-mode index artifact stats.', {
    helpGroup: 'Index',
    capability: false,
    supportTier: 'operator'
  }),
  entry('index.snapshot', ['index', 'snapshot'], 'tools/index-snapshot.js', 'Manage index snapshots.', {
    helpGroup: 'Index',
    capability: false,
    supportTier: 'operator'
  }),
  entry('index.diff', ['index', 'diff'], 'tools/index-diff.js', 'Compute and inspect index diffs.', {
    helpGroup: 'Index',
    capability: false,
    supportTier: 'operator'
  }),
  entry('sqlite.compact', ['sqlite', 'compact'], 'tools/build/compact-sqlite-index.js', 'Compact SQLite indexes in place.', {
    helpGroup: 'SQLite',
    capability: false,
    supportTier: 'operator'
  }),
  entry('search', ['search'], 'search.js', 'Query indexed data.', {
    helpGroup: 'Search',
    expectedArtifacts: ['metrics:search'],
    helpExamples: ['pairofcleats search --repo . foo'],
    metadata: {
      backendEnum: ['auto', 'sqlite', 'sqlite-fts', 'fts', 'lmdb', 'tantivy', 'memory']
    }
  }),
  entry('workspace.manifest', ['workspace', 'manifest'], 'tools/workspace/manifest.js', 'Generate workspace manifest.', {
    helpGroup: 'Workspace'
  }),
  entry('workspace.status', ['workspace', 'status'], 'tools/workspace/status.js', 'Show workspace status.', {
    helpGroup: 'Workspace'
  }),
  entry('workspace.build', ['workspace', 'build'], 'tools/workspace/build.js', 'Build workspace indexes.', {
    helpGroup: 'Workspace'
  }),
  entry('workspace.catalog', ['workspace', 'catalog'], 'tools/workspace/catalog.js', 'Inspect workspace catalog.', {
    helpGroup: 'Workspace'
  }),
  entry('service.api', ['service', 'api'], 'tools/api/server.js', 'Run local API service.', {
    helpGroup: 'Service'
  }),
  entry('service.mcp', ['service', 'mcp'], 'tools/mcp/server.js', 'Run local MCP service.', {
    helpGroup: 'Service',
    capability: false,
    supportTier: 'operator'
  }),
  entry('service.indexer', ['service', 'indexer'], 'tools/service/indexer-service.js', 'Run indexer service.', {
    helpGroup: 'Service',
    supportTier: 'operator'
  }),
  entry('bench.language', ['bench', 'language'], 'tools/bench/language-repos.js', 'Run the bench-language corpus.', {
    helpGroup: 'Bench',
    capability: false,
    supportTier: 'experimental'
  }),
  entry('bench.matrix', ['bench', 'matrix'], 'tools/bench/language-matrix.js', 'Run the bench-language backend matrix.', {
    helpGroup: 'Bench',
    capability: false,
    supportTier: 'experimental'
  }),
  entry('bench.summarize', ['bench', 'summarize'], 'tools/bench/language-summarize.js', 'Summarize completed bench-language runs.', {
    helpGroup: 'Bench',
    capability: false,
    supportTier: 'experimental'
  }),
  entry('bench.micro', ['bench', 'micro'], 'tools/bench/micro/run.js', 'Run focused indexing/search microbenchmarks.', {
    helpGroup: 'Bench',
    capability: false,
    supportTier: 'experimental'
  }),
  entry('ingest.ctags', ['ingest', 'ctags'], 'tools/ingest/ctags.js', 'Ingest ctags symbols.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:ctags'],
    supportTier: 'operator'
  }),
  entry('ingest.gtags', ['ingest', 'gtags'], 'tools/ingest/gtags.js', 'Ingest GTAGS symbols.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:gtags'],
    supportTier: 'operator'
  }),
  entry('ingest.lsif', ['ingest', 'lsif'], 'tools/ingest/lsif.js', 'Ingest LSIF dump.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:lsif'],
    supportTier: 'operator'
  }),
  entry('ingest.scip', ['ingest', 'scip'], 'tools/ingest/scip.js', 'Ingest SCIP index.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:scip'],
    supportTier: 'operator'
  }),
  entry('tui.supervisor', ['tui', 'supervisor'], 'tools/tui/supervisor.js', 'Run Node supervisor process.', {
    helpGroup: 'TUI',
    supportTier: 'operator'
  }),
  entry('tui.build', ['tui', 'build'], 'tools/tui/build.js', 'Build TUI artifacts.', {
    helpGroup: 'TUI',
    supportTier: 'operator'
  }),
  entry('tui.install', ['tui', 'install'], 'tools/tui/install.js', 'Install TUI artifacts.', {
    helpGroup: 'TUI',
    supportTier: 'operator'
  }),
  entry('dispatch.list', ['dispatch', 'list'], 'tools/dispatch/manifest.js', 'List shared dispatch manifest entries.', {
    helpGroup: 'Dispatch',
    capability: false,
    supportTier: 'internal'
  }),
  entry('dispatch.describe', ['dispatch', 'describe'], 'tools/dispatch/manifest.js', 'Describe one shared dispatch command.', {
    helpGroup: 'Dispatch',
    capability: false,
    supportTier: 'internal'
  }),
  entry('tooling.doctor', ['tooling', 'doctor'], 'tools/tooling/doctor.js', 'Inspect tooling availability and configuration.', {
    helpGroup: 'Tooling',
    helpExamples: ['pairofcleats tooling doctor --repo . --json']
  }),
  entry('tooling.detect', ['tooling', 'detect'], 'tools/tooling/detect.js', 'Detect repo tooling and language coverage.', {
    helpGroup: 'Tooling',
    capability: false,
    supportTier: 'operator'
  }),
  entry('tooling.install', ['tooling', 'install'], 'tools/tooling/install.js', 'Install or plan external tooling dependencies.', {
    helpGroup: 'Tooling',
    capability: false,
    supportTier: 'operator'
  }),
  entry('tooling.navigate', ['tooling', 'navigate'], 'tools/tooling/navigation.js', 'Query indexed definitions, references, and document symbols.', {
    helpGroup: 'Tooling',
    capability: false,
    supportTier: 'operator'
  }),
  entry('tooling.uninstall', ['tooling', 'uninstall'], 'tools/tooling/uninstall.js', 'Remove installed PairOfCleats caches and tooling payloads.', {
    helpGroup: 'Tooling',
    capability: false,
    supportTier: 'operator'
  }),
  entry('cache.clear', ['cache', 'clear'], 'tools/cache/clear-cache.js', 'Clear shared caches.', {
    helpGroup: 'Cache',
    supportTier: 'operator'
  }),
  entry('cache.gc', ['cache', 'gc'], 'tools/index/cache-gc.js', 'Run shared cache GC.', {
    helpGroup: 'Cache',
    supportTier: 'operator',
    capability: {
      flagSetId: 'bench'
    }
  }),
  entry('lmdb.build', ['lmdb', 'build'], 'tools/build/lmdb-index.js', 'Build LMDB indexes.', {
    helpGroup: 'LMDB',
    capability: false,
    supportTier: 'experimental'
  }),
  entry('report.map', ['report', 'map'], 'tools/reports/report-code-map.js', 'Generate the code map report.', {
    helpGroup: 'Report',
    supportTier: 'operator'
  }),
  entry('report.eval', ['report', 'eval'], 'tools/eval/run.js', 'Run retrieval evaluation.', {
    helpGroup: 'Report',
    supportTier: 'operator'
  }),
  entry('report.compare-models', ['report', 'compare-models'], 'tools/reports/compare-models.js', 'Compare embedding model results.', {
    helpGroup: 'Report',
    supportTier: 'experimental',
    capability: {
      flagSetId: 'bench'
    }
  }),
  entry('report.throughput', ['report', 'throughput'], 'tools/reports/show-throughput.js', 'Render benchmark throughput overviews.', {
    helpGroup: 'Report',
    capability: false,
    supportTier: 'operator',
    helpExamples: ['pairofcleats report throughput']
  }),
  entry('report.summary', ['report', 'summary'], 'tools/reports/combined-summary.js', 'Build the combined summary report.', {
    helpGroup: 'Report',
    capability: false,
    supportTier: 'operator'
  }),
  entry('report.parity', ['report', 'parity'], 'tools/reports/parity-matrix.js', 'Run the retrieval parity matrix harness.', {
    helpGroup: 'Report',
    capability: false,
    supportTier: 'experimental'
  }),
  entry('report.metrics', ['report', 'metrics'], 'tools/reports/metrics-dashboard.js', 'Render metrics dashboard artifacts.', {
    helpGroup: 'Report',
    supportTier: 'operator'
  }),
  entry('graph-context', ['graph-context'], 'tools/analysis/graph-context.js', 'Build a graph context pack for a seed.', {
    helpGroup: 'Graph',
    supportTier: 'operator'
  }),
  entry('context-pack', ['context-pack'], 'tools/analysis/context-pack.js', 'Build a composite context pack for a seed.', {
    helpGroup: 'Graph',
    helpExamples: ['pairofcleats context-pack --repo . --seed path:src/index.js']
  }),
  entry('api-contracts', ['api-contracts'], 'tools/api/contracts.js', 'Report cross-file API contracts.', {
    helpGroup: 'Graph'
  }),
  entry('architecture-check', ['architecture-check'], 'tools/analysis/architecture-check.js', 'Evaluate architecture rules over graphs.', {
    helpGroup: 'Graph'
  }),
  entry('suggest-tests', ['suggest-tests'], 'tools/analysis/suggest-tests.js', 'Suggest tests impacted by a change list.', {
    helpGroup: 'Graph'
  }),
  entry('impact', ['impact'], 'tools/analysis/impact.js', 'Analyze change impact over the graph.', {
    helpGroup: 'Graph',
    helpExamples: ['pairofcleats impact --repo . --changed src/index.js']
  }),
  entry('risk.explain', ['risk', 'explain'], 'tools/analysis/explain-risk.js', 'Explain interprocedural risk flows.', {
    helpGroup: 'Risk',
    helpExamples: ['pairofcleats risk explain --index .poc/index --format md']
  }),
  entry('risk.delta', ['risk', 'delta'], 'tools/analysis/delta-risk.js', 'Compare risk flows across two refs.', {
    helpGroup: 'Risk',
    helpExamples: ['pairofcleats risk delta --repo . --from HEAD~1 --to HEAD']
  })
]);

export const COMMAND_BY_ID = Object.freeze(Object.fromEntries(COMMAND_REGISTRY.map((item) => [item.id, item])));

export const COMMAND_BY_PATH = Object.freeze(
  Object.fromEntries(COMMAND_REGISTRY.map((item) => [commandPathKey(item.commandPath), item]))
);

export const listCommandRegistry = ({
  capabilityOnly = false,
  dispatchOnly = false,
  supportTiers = null
} = {}) => COMMAND_REGISTRY
  .filter((entry) => !capabilityOnly || entry.capability !== false)
  .filter((entry) => !dispatchOnly || entry.dispatchListed !== false)
  .filter((entry) => {
    if (!supportTiers) return true;
    return supportTiers.includes(entry.supportTier);
  })
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(cloneCommandRegistryEntry);

export const describeCommandRegistryEntry = (nameOrPath) => {
  const text = String(nameOrPath || '').trim();
  if (!text) return null;
  const byId = COMMAND_BY_ID[text] || null;
  if (byId) return cloneCommandRegistryEntry(byId);
  const byPath = COMMAND_BY_PATH[commandPathKey(text.split(/\s+/))] || null;
  return byPath ? cloneCommandRegistryEntry(byPath) : null;
};

export const listHelpSections = ({ supportTiers = DEFAULT_HELP_SUPPORT_TIERS } = {}) => COMMAND_HELP_GROUP_ORDER.map((group) => ({
  group,
  commands: COMMAND_REGISTRY
    .filter((entry) => entry.helpGroup === group && supportTiers.includes(entry.supportTier))
    .slice()
    .sort((a, b) => commandPathKey(a.commandPath).localeCompare(commandPathKey(b.commandPath)))
    .map(cloneCommandRegistryEntry)
})).filter((section) => section.commands.length > 0);

export const listCommonWorkflowExamples = ({ supportTiers = DEFAULT_HELP_SUPPORT_TIERS } = {}) => (
  listCommandRegistry({ supportTiers })
    .flatMap((entry) => entry.helpExamples.map((example) => ({
      id: entry.id,
      supportTier: entry.supportTier,
      example
    })))
);
