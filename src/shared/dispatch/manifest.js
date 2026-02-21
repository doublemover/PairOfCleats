import { DISPATCH_BY_ID, DISPATCH_BY_PATH, DISPATCH_REGISTRY, commandPathKey } from './registry.js';

const cloneEntry = (entry) => ({
  id: entry.id,
  commandPath: entry.commandPath.slice(),
  script: entry.script,
  description: entry.description,
  progressMode: entry.progressMode,
  expectedArtifacts: entry.expectedArtifacts.slice(),
  metadata: { ...entry.metadata }
});

export const listDispatchManifest = () => (
  DISPATCH_REGISTRY
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(cloneEntry)
);

export const describeDispatchCommand = (nameOrPath) => {
  const text = String(nameOrPath || '').trim();
  if (!text) return null;
  const byId = DISPATCH_BY_ID[text] || null;
  if (byId) return cloneEntry(byId);
  const byPath = DISPATCH_BY_PATH[commandPathKey(text.split(/\s+/))] || null;
  return byPath ? cloneEntry(byPath) : null;
};
