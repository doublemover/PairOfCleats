import { getToolDefs } from '../integrations/mcp/defs.js';
import { listCommandRegistry } from './command-registry.js';
import { resolveCliOptionFlagSets } from './cli-options.js';
import { EDITOR_COMMAND_SPECS } from './runtime-capability-specs.js';

export const buildFlagSet = (options) => {
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

export const buildCliCommandManifest = () => {
  return listCommandRegistry({ capabilityOnly: true }).map((entry) => ({
    id: entry.id,
    commandPath: entry.commandPath.slice(),
    description: entry.description,
    supportTier: entry.supportTier,
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

export const buildMcpToolManifest = (defaultModelId = 'default') => (
  getToolDefs(defaultModelId)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required.slice() : [],
      properties: Object.keys(tool.inputSchema?.properties || {}).sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
);

export const buildEditorManifest = () => ({
  vscode: {
    commands: EDITOR_COMMAND_SPECS.map((entry) => ({ ...entry })),
    activationEvents: EDITOR_COMMAND_SPECS.map((entry) => `onCommand:${entry.id}`)
  }
});
