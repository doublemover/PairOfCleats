import { MCP_SCHEMA_VERSION, getToolDefs } from '../integrations/mcp/defs.js';
import {
  BENCH_OPTIONS,
  INDEX_BUILD_OPTIONS,
  SERVICE_API_OPTIONS,
  SERVICE_INDEXER_OPTIONS,
  resolveCliOptionFlagSets
} from './cli-options.js';
import { PROGRESS_PROTOCOL } from './cli/progress-events.js';
import { listCommandRegistry } from './command-registry.js';
import { getCapabilities } from './capabilities.js';

export const RUNTIME_CAPABILITY_MANIFEST_VERSION = '1.0.0';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const freezeArray = (items) => Object.freeze(items.map((item) => Object.freeze({ ...item })));

const EDITOR_COMMAND_SPECS = freezeArray([
  { id: 'pairofcleats.search', title: 'PairOfCleats: Search', workflow: 'search' },
  { id: 'pairofcleats.searchSelection', title: 'PairOfCleats: Search Selection', workflow: 'search' },
  { id: 'pairofcleats.searchSymbolUnderCursor', title: 'PairOfCleats: Search Symbol Under Cursor', workflow: 'search-symbol' },
  { id: 'pairofcleats.selectRepo', title: 'PairOfCleats: Select Repository', workflow: 'repo-selection' },
  { id: 'pairofcleats.clearSelectedRepo', title: 'PairOfCleats: Clear Selected Repository', workflow: 'repo-selection' },
  { id: 'pairofcleats.repeatLastSearch', title: 'PairOfCleats: Repeat Last Search', workflow: 'search' },
  { id: 'pairofcleats.explainSearch', title: 'PairOfCleats: Explain Search', workflow: 'search-explain' },
  { id: 'pairofcleats.openIndexDirectory', title: 'PairOfCleats: Open Index Directory', workflow: 'index-directory' },
  { id: 'pairofcleats.indexBuild', title: 'PairOfCleats: Index Build', workflow: 'index-build' },
  { id: 'pairofcleats.indexWatchStart', title: 'PairOfCleats: Start Index Watch', workflow: 'index-watch' },
  { id: 'pairofcleats.indexWatchStop', title: 'PairOfCleats: Stop Index Watch', workflow: 'index-watch' },
  { id: 'pairofcleats.indexValidate', title: 'PairOfCleats: Index Validate', workflow: 'index-validate' },
  { id: 'pairofcleats.serviceApiStart', title: 'PairOfCleats: Start Service API', workflow: 'service-api' },
  { id: 'pairofcleats.serviceApiStop', title: 'PairOfCleats: Stop Service API', workflow: 'service-api' },
  { id: 'pairofcleats.serviceIndexerStart', title: 'PairOfCleats: Start Service Indexer', workflow: 'service-indexer' },
  { id: 'pairofcleats.serviceIndexerStop', title: 'PairOfCleats: Stop Service Indexer', workflow: 'service-indexer' },
  { id: 'pairofcleats.setup', title: 'PairOfCleats: Setup', workflow: 'setup' },
  { id: 'pairofcleats.bootstrap', title: 'PairOfCleats: Bootstrap', workflow: 'bootstrap' },
  { id: 'pairofcleats.doctor', title: 'PairOfCleats: Tooling Doctor', workflow: 'tooling-doctor' },
  { id: 'pairofcleats.configDump', title: 'PairOfCleats: Config Dump', workflow: 'config-dump' },
  { id: 'pairofcleats.indexHealth', title: 'PairOfCleats: Index Health', workflow: 'index-health' },
  { id: 'pairofcleats.codeMap', title: 'PairOfCleats: Code Map', workflow: 'code-map' },
  { id: 'pairofcleats.architectureCheck', title: 'PairOfCleats: Architecture Check', workflow: 'architecture-check' },
  { id: 'pairofcleats.impact', title: 'PairOfCleats: Impact Analysis', workflow: 'impact' },
  { id: 'pairofcleats.suggestTests', title: 'PairOfCleats: Suggest Tests', workflow: 'suggest-tests' },
  { id: 'pairofcleats.contextPack', title: 'PairOfCleats: Context Pack', workflow: 'context-pack' },
  { id: 'pairofcleats.riskExplain', title: 'PairOfCleats: Risk Explain', workflow: 'risk-explain' },
  { id: 'pairofcleats.workspaceManifest', title: 'PairOfCleats: Workspace Manifest', workflow: 'workspace-manifest' },
  { id: 'pairofcleats.workspaceStatus', title: 'PairOfCleats: Workspace Status', workflow: 'workspace-status' },
  { id: 'pairofcleats.workspaceBuild', title: 'PairOfCleats: Workspace Build', workflow: 'workspace-build' },
  { id: 'pairofcleats.workspaceCatalog', title: 'PairOfCleats: Workspace Catalog', workflow: 'workspace-catalog' },
  { id: 'pairofcleats.showWorkflowStatus', title: 'PairOfCleats: Workflow Status', workflow: 'workflow-history' },
  { id: 'pairofcleats.rerunLastWorkflow', title: 'PairOfCleats: Rerun Last Workflow', workflow: 'workflow-history' },
  { id: 'pairofcleats.showRecentWorkflows', title: 'PairOfCleats: Recent Workflows', workflow: 'workflow-history' },
  { id: 'pairofcleats.reopenLastResults', title: 'PairOfCleats: Reopen Last Results', workflow: 'search-history' },
  { id: 'pairofcleats.showSearchHistory', title: 'PairOfCleats: Search History', workflow: 'search-history' },
  { id: 'pairofcleats.groupResultsBySection', title: 'PairOfCleats: Group Results by Section', workflow: 'results-explorer' },
  { id: 'pairofcleats.groupResultsByFile', title: 'PairOfCleats: Group Results by File', workflow: 'results-explorer' },
  { id: 'pairofcleats.groupResultsByQuery', title: 'PairOfCleats: Group Results by Query', workflow: 'results-explorer' },
  { id: 'pairofcleats.openResultHit', title: 'PairOfCleats: Open Result Hit', workflow: 'results-explorer' },
  { id: 'pairofcleats.revealResultHit', title: 'PairOfCleats: Reveal Result Hit', workflow: 'results-explorer' },
  { id: 'pairofcleats.copyResultPath', title: 'PairOfCleats: Copy Result Path', workflow: 'results-explorer' },
  { id: 'pairofcleats.rerunResultSet', title: 'PairOfCleats: Rerun Result Set', workflow: 'results-explorer' }
]);

const API_WORKFLOW_CAPABILITIES = Object.freeze({
  search: true,
  'search-symbol': true,
  'index-health': true,
  'context-pack': true,
  'risk-delta': true,
  'risk-explain': true,
  'search-workspace': true
});

const API_ROUTE_SPECS = freezeArray([
  { id: 'health', method: 'GET', path: '/health' },
  { id: 'capabilities', method: 'GET', path: '/capabilities' },
  { id: 'metrics', method: 'GET', path: '/metrics' },
  { id: 'status', method: 'GET', path: '/status', workflow: 'index-health' },
  { id: 'status.stream', method: 'GET', path: '/status/stream', workflow: 'index-health' },
  { id: 'search', method: 'POST', path: '/search', workflow: 'search' },
  { id: 'search.stream', method: 'POST', path: '/search/stream', workflow: 'search' },
  { id: 'search.workspace', method: 'POST', path: '/search/federated', workflow: 'search-workspace' },
  { id: 'analysis.context-pack', method: 'POST', path: '/analysis/context-pack', workflow: 'context-pack' },
  { id: 'analysis.risk-delta', method: 'POST', path: '/analysis/risk-delta', workflow: 'risk-delta' },
  { id: 'analysis.risk-explain', method: 'POST', path: '/analysis/risk-explain', workflow: 'risk-explain' },
  { id: 'index.diffs', method: 'GET', path: '/index/diffs', workflow: 'index-diffs' },
  { id: 'index.snapshots', method: 'GET', path: '/index/snapshots', workflow: 'index-snapshots' }
]);

const TUI_SUPERVISOR_CAPABILITY_SPEC = Object.freeze({
  protocolVersion: PROGRESS_PROTOCOL,
  supportsCancel: true,
  supportsResultCapture: true,
  supportsFlowControl: true,
  supportsChunking: true
});

const RISK_FEATURES = Object.freeze({
  searchFilters: Object.freeze({
    risk: true,
    riskTag: true,
    riskSource: true,
    riskSink: true,
    riskCategory: true,
    riskFlow: true
  }),
  analysis: Object.freeze({
    contextPack: true,
    riskDelta: true,
    riskExplain: true,
    partialFlows: true,
    strictRiskContext: true,
    graphContext: true,
    architectureCheck: true,
    impact: true,
    suggestTests: true
  })
});

const buildFlagSet = (options) => {
  const { valueOptionNames } = resolveCliOptionFlagSets(options);
  const flags = Object.entries(options)
    .map(([name, value]) => ({
      name,
      type: value?.type || 'string',
      alias: value?.alias ?? null,
      description: value?.describe || ''
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    flags,
    valueFlags: valueOptionNames.slice().sort((left, right) => left.localeCompare(right))
  };
};

const buildCliCommandManifest = () => {
  return listCommandRegistry({ capabilityOnly: true }).map((entry) => ({
    id: entry.id,
    commandPath: entry.commandPath.slice(),
    description: entry.description,
    script: entry.script,
    progressMode: entry.progressMode,
    expectedArtifacts: entry.expectedArtifacts.slice(),
    metadata: { ...entry.metadata },
    helpGroup: entry.helpGroup,
    flagSetId: entry.capability && typeof entry.capability === 'object'
      ? entry.capability.flagSetId || null
      : null
  }));
};

const buildMcpToolManifest = (defaultModelId = 'default') => (
  getToolDefs(defaultModelId)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required.slice() : [],
      properties: Object.keys(tool.inputSchema?.properties || {}).sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
);

const buildEditorManifest = () => ({
  vscode: {
    commands: EDITOR_COMMAND_SPECS.map((entry) => ({ ...entry })),
    activationEvents: EDITOR_COMMAND_SPECS.map((entry) => `onCommand:${entry.id}`)
  }
});

export function getRuntimeCapabilityManifest(options = {}) {
  const runtimeCapabilities = options.runtimeCapabilities && typeof options.runtimeCapabilities === 'object'
    ? options.runtimeCapabilities
    : getCapabilities({ refresh: options.refreshCapabilities === true });
  return {
    manifestVersion: RUNTIME_CAPABILITY_MANIFEST_VERSION,
    runtimeCapabilities: cloneJson(runtimeCapabilities),
    riskFeatures: cloneJson(RISK_FEATURES),
    flags: {
      'index.build': buildFlagSet(INDEX_BUILD_OPTIONS),
      'service.api': buildFlagSet(SERVICE_API_OPTIONS),
      'service.indexer': buildFlagSet(SERVICE_INDEXER_OPTIONS),
      bench: buildFlagSet(BENCH_OPTIONS)
    },
    surfaces: {
      cli: {
        commands: buildCliCommandManifest()
      },
      api: {
        workflowCapabilities: cloneJson(API_WORKFLOW_CAPABILITIES),
        routes: API_ROUTE_SPECS.map((entry) => ({ ...entry }))
      },
      mcp: {
        schemaVersion: MCP_SCHEMA_VERSION,
        modes: {
          legacy: true,
          sdk: runtimeCapabilities?.mcp?.sdk === true,
          auto: true
        },
        tools: buildMcpToolManifest(options.defaultModelId)
      },
      tui: {
        supervisor: {
          protocol: 'poc.tui@1',
          capabilities: cloneJson(TUI_SUPERVISOR_CAPABILITY_SPEC)
        }
      },
      editor: buildEditorManifest()
    }
  };
}

export function getApiWorkflowCapabilities(options = {}) {
  return getRuntimeCapabilityManifest(options).surfaces.api.workflowCapabilities;
}

export function getTuiSupervisorCapabilities() {
  return cloneJson(TUI_SUPERVISOR_CAPABILITY_SPEC);
}

export function getEditorCommandSpecs() {
  return EDITOR_COMMAND_SPECS.map((entry) => ({ ...entry }));
}
