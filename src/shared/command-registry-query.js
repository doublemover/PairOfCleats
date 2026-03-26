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
