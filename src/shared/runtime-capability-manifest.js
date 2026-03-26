import { MCP_SCHEMA_VERSION } from '../integrations/mcp/defs.js';
import {
  BENCH_OPTIONS,
  CACHE_GC_OPTIONS,
  COMPARE_MODELS_OPTIONS,
  INDEX_BUILD_OPTIONS,
  SERVICE_API_OPTIONS,
  SERVICE_INDEXER_OPTIONS
} from './cli-option-sets.js';
import { getCapabilities } from './capabilities.js';
import {
  API_ROUTE_SPECS,
  API_WORKFLOW_CAPABILITIES,
  EDITOR_COMMAND_SPECS,
  RISK_FEATURES,
  RUNTIME_CAPABILITY_MANIFEST_VERSION,
  TUI_SUPERVISOR_CAPABILITY_SPEC,
  cloneJson
} from './runtime-capability-specs.js';
import {
  buildCliCommandManifest,
  buildEditorManifest,
  buildFlagSet,
  buildMcpToolManifest
} from './runtime-capability-builders.js';

export { RUNTIME_CAPABILITY_MANIFEST_VERSION } from './runtime-capability-specs.js';

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
      bench: buildFlagSet(BENCH_OPTIONS),
      'cache.gc': buildFlagSet(CACHE_GC_OPTIONS),
      'report.compare-models': buildFlagSet(COMPARE_MODELS_OPTIONS)
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
