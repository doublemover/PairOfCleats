const entry = (id, commandPath, script, description, extras = {}) => Object.freeze({
  id,
  commandPath: Object.freeze(commandPath.slice()),
  script,
  description,
  helpGroup: extras.helpGroup || 'Other',
  progressMode: extras.progressMode || 'jsonl',
  extraArgs: Object.freeze(Array.isArray(extras.extraArgs) ? extras.extraArgs.slice() : []),
  expectedArtifacts: Object.freeze(Array.isArray(extras.expectedArtifacts) ? extras.expectedArtifacts.slice() : []),
  metadata: Object.freeze(extras.metadata && typeof extras.metadata === 'object' ? { ...extras.metadata } : {}),
  capability: extras.capability === false
    ? false
    : Object.freeze(extras.capability && typeof extras.capability === 'object' ? { ...extras.capability } : {}),
  dispatchListed: extras.dispatchListed !== false
});

export const COMMAND_HELP_GROUP_ORDER = Object.freeze([
  'Core',
  'Index',
  'Search',
  'Workspace',
  'Service',
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

export const commandPathKey = (parts) => parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ');

export const cloneCommandRegistryEntry = (entry) => ({
  id: entry.id,
  commandPath: entry.commandPath.slice(),
  script: entry.script,
  description: entry.description,
  helpGroup: entry.helpGroup,
  progressMode: entry.progressMode,
  extraArgs: entry.extraArgs.slice(),
  expectedArtifacts: entry.expectedArtifacts.slice(),
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
    expectedArtifacts: ['config:file', 'cache:dicts', 'cache:models', 'index:code', 'index:prose', 'index:records']
  }),
  entry('index.build', ['index', 'build'], 'build_index.js', 'Build file-backed indexes.', {
    helpGroup: 'Index',
    expectedArtifacts: ['index:code', 'index:prose', 'index:records']
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
    capability: false
  }),
  entry('index.snapshot', ['index', 'snapshot'], 'tools/index-snapshot.js', 'Manage index snapshots.', {
    helpGroup: 'Index',
    capability: false
  }),
  entry('index.diff', ['index', 'diff'], 'tools/index-diff.js', 'Compute and inspect index diffs.', {
    helpGroup: 'Index',
    capability: false
  }),
  entry('search', ['search'], 'search.js', 'Query indexed data.', {
    helpGroup: 'Search',
    expectedArtifacts: ['metrics:search'],
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
  entry('service.indexer', ['service', 'indexer'], 'tools/service/indexer-service.js', 'Run indexer service.', {
    helpGroup: 'Service'
  }),
  entry('ingest.ctags', ['ingest', 'ctags'], 'tools/ingest/ctags.js', 'Ingest ctags symbols.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:ctags']
  }),
  entry('ingest.gtags', ['ingest', 'gtags'], 'tools/ingest/gtags.js', 'Ingest GTAGS symbols.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:gtags']
  }),
  entry('ingest.lsif', ['ingest', 'lsif'], 'tools/ingest/lsif.js', 'Ingest LSIF dump.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:lsif']
  }),
  entry('ingest.scip', ['ingest', 'scip'], 'tools/ingest/scip.js', 'Ingest SCIP index.', {
    helpGroup: 'Ingest',
    expectedArtifacts: ['ingest:scip']
  }),
  entry('tui.supervisor', ['tui', 'supervisor'], 'tools/tui/supervisor.js', 'Run Node supervisor process.', {
    helpGroup: 'TUI'
  }),
  entry('tui.build', ['tui', 'build'], 'tools/tui/build.js', 'Build TUI artifacts.', {
    helpGroup: 'TUI'
  }),
  entry('tui.install', ['tui', 'install'], 'tools/tui/install.js', 'Install TUI artifacts.', {
    helpGroup: 'TUI'
  }),
  entry('dispatch.list', ['dispatch', 'list'], 'tools/dispatch/manifest.js', 'List shared dispatch manifest entries.', {
    helpGroup: 'Dispatch',
    capability: false
  }),
  entry('dispatch.describe', ['dispatch', 'describe'], 'tools/dispatch/manifest.js', 'Describe one shared dispatch command.', {
    helpGroup: 'Dispatch',
    capability: false
  }),
  entry('tooling.doctor', ['tooling', 'doctor'], 'tools/tooling/doctor.js', 'Inspect tooling availability and configuration.', {
    helpGroup: 'Tooling'
  }),
  entry('tooling.navigate', ['tooling', 'navigate'], 'tools/tooling/navigation.js', 'Query indexed definitions, references, and document symbols.', {
    helpGroup: 'Tooling',
    capability: false
  }),
  entry('cache.clear', ['cache', 'clear'], 'tools/cache/clear-cache.js', 'Clear shared caches.', {
    helpGroup: 'Cache'
  }),
  entry('cache.gc', ['cache', 'gc'], 'tools/index/cache-gc.js', 'Run shared cache GC.', {
    helpGroup: 'Cache',
    capability: {
      flagSetId: 'bench'
    }
  }),
  entry('lmdb.build', ['lmdb', 'build'], 'tools/build/lmdb-index.js', 'Build LMDB indexes.', {
    helpGroup: 'LMDB',
    capability: false
  }),
  entry('report.map', ['report', 'map'], 'tools/reports/report-code-map.js', 'Generate the code map report.', {
    helpGroup: 'Report'
  }),
  entry('report.eval', ['report', 'eval'], 'tools/eval/run.js', 'Run retrieval evaluation.', {
    helpGroup: 'Report'
  }),
  entry('report.compare-models', ['report', 'compare-models'], 'tools/reports/compare-models.js', 'Compare embedding model results.', {
    helpGroup: 'Report',
    capability: {
      flagSetId: 'bench'
    }
  }),
  entry('report.metrics', ['report', 'metrics'], 'tools/reports/metrics-dashboard.js', 'Render metrics dashboard artifacts.', {
    helpGroup: 'Report'
  }),
  entry('graph-context', ['graph-context'], 'tools/analysis/graph-context.js', 'Build a graph context pack for a seed.', {
    helpGroup: 'Graph'
  }),
  entry('context-pack', ['context-pack'], 'tools/analysis/context-pack.js', 'Build a composite context pack for a seed.', {
    helpGroup: 'Graph'
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
    helpGroup: 'Graph'
  }),
  entry('risk.explain', ['risk', 'explain'], 'tools/analysis/explain-risk.js', 'Explain interprocedural risk flows.', {
    helpGroup: 'Risk'
  }),
  entry('risk.delta', ['risk', 'delta'], 'tools/analysis/delta-risk.js', 'Compare risk flows across two refs.', {
    helpGroup: 'Risk'
  })
]);

export const COMMAND_BY_ID = Object.freeze(Object.fromEntries(COMMAND_REGISTRY.map((item) => [item.id, item])));

export const COMMAND_BY_PATH = Object.freeze(
  Object.fromEntries(COMMAND_REGISTRY.map((item) => [commandPathKey(item.commandPath), item]))
);

export const listCommandRegistry = ({
  capabilityOnly = false,
  dispatchOnly = false
} = {}) => COMMAND_REGISTRY
  .filter((entry) => !capabilityOnly || entry.capability !== false)
  .filter((entry) => !dispatchOnly || entry.dispatchListed !== false)
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

export const listHelpSections = () => COMMAND_HELP_GROUP_ORDER.map((group) => ({
  group,
  commands: COMMAND_REGISTRY
    .filter((entry) => entry.helpGroup === group)
    .slice()
    .sort((a, b) => commandPathKey(a.commandPath).localeCompare(commandPathKey(b.commandPath)))
    .map(cloneCommandRegistryEntry)
})).filter((section) => section.commands.length > 0);
