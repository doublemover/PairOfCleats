import {
  COMMAND_BY_ID,
  COMMAND_BY_PATH,
  COMMAND_REGISTRY,
  cloneCommandRegistryEntry,
  commandPathKey
} from '../command-registry.js';

const toDispatchEntry = (entry) => ({
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
  .map((entry) => toDispatchEntry(cloneCommandRegistryEntry(entry)));

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

export {
  COMMAND_BY_ID,
  COMMAND_BY_PATH,
  commandPathKey
};
