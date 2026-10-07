import {
  COMMAND_BY_ID,
  COMMAND_BY_PATH,
  COMMAND_HELP_GROUP_ORDER,
  COMMAND_REGISTRY,
  DEFAULT_HELP_SUPPORT_TIERS,
  cloneCommandRegistryEntry,
  commandPathKey
} from './command-registry-data.js';

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

const toDispatchEntry = (entry) => ({
  id: entry.id,
  commandPath: entry.commandPath.slice(),
  script: entry.script,
  description: entry.description,
  progressMode: entry.progressMode,
  expectedArtifacts: entry.expectedArtifacts.slice(),
  metadata: { ...entry.metadata }
});

const cloneDispatchEntry = (entry) => ({
  id: entry.id,
  commandPath: entry.commandPath.slice(),
  script: entry.script,
  description: entry.description,
  progressMode: entry.progressMode,
  expectedArtifacts: entry.expectedArtifacts.slice(),
  metadata: { ...entry.metadata }
});

const dispatchEntries = COMMAND_REGISTRY
  .filter((entry) => entry.dispatchListed !== false)
  .map(toDispatchEntry);

export const DISPATCH_REGISTRY = Object.freeze(dispatchEntries.map((entry) => Object.freeze({
  ...entry,
  commandPath: Object.freeze(entry.commandPath.slice()),
  expectedArtifacts: Object.freeze(entry.expectedArtifacts.slice()),
  metadata: Object.freeze({ ...entry.metadata })
})));

export const DISPATCH_BY_ID = Object.freeze(
  Object.fromEntries(
    DISPATCH_REGISTRY.map((entry) => [entry.id, entry])
  )
);

export const DISPATCH_BY_PATH = Object.freeze(
  Object.fromEntries(
    DISPATCH_REGISTRY.map((entry) => [commandPathKey(entry.commandPath), entry])
  )
);

export const listDispatchManifest = () => (
  DISPATCH_REGISTRY
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(cloneDispatchEntry)
);

export const describeDispatchCommand = (nameOrPath) => {
  const text = String(nameOrPath || '').trim();
  if (!text) return null;
  const byId = DISPATCH_BY_ID[text] || null;
  if (byId) return cloneDispatchEntry(byId);
  const byPath = DISPATCH_BY_PATH[commandPathKey(text.split(/\s+/))] || null;
  return byPath ? cloneDispatchEntry(byPath) : null;
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
