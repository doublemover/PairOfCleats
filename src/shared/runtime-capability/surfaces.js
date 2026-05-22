import { MCP_SCHEMA_VERSION } from '../../integrations/mcp/defs.js';
import {
  BENCH_OPTIONS,
  CACHE_GC_OPTIONS,
  COMPARE_MODELS_OPTIONS,
  INDEX_BUILD_OPTIONS,
  SERVICE_API_OPTIONS,
  SERVICE_INDEXER_OPTIONS
} from '../cli-option-sets.js';
import {
  API_ROUTE_SPECS,
  API_WORKFLOW_CAPABILITIES,
  TUI_SUPERVISOR_CAPABILITY_SPEC,
  cloneJson
} from '../runtime-capability-specs.js';
import {
  buildCliCommandManifest,
  buildEditorManifest,
  buildFlagSet,
  buildMcpToolManifest
} from './builders.js';

export const buildRuntimeCapabilityFlagSets = () => ({
  'index.build': buildFlagSet(INDEX_BUILD_OPTIONS),
  'service.api': buildFlagSet(SERVICE_API_OPTIONS),
  'service.indexer': buildFlagSet(SERVICE_INDEXER_OPTIONS),
  bench: buildFlagSet(BENCH_OPTIONS),
  'cache.gc': buildFlagSet(CACHE_GC_OPTIONS),
  'report.compare-models': buildFlagSet(COMPARE_MODELS_OPTIONS)
});

export const buildRuntimeCapabilitySurfaces = ({
  runtimeCapabilities,
  defaultModelId
} = {}) => ({
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
    tools: buildMcpToolManifest(defaultModelId)
  },
  tui: {
    supervisor: {
      protocol: 'poc.tui@1',
      capabilities: cloneJson(TUI_SUPERVISOR_CAPABILITY_SPEC)
    }
  },
  editor: buildEditorManifest()
});
