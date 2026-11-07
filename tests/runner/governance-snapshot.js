import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverTests } from './run-discovery.js';
import { loadRunRules } from './run-config.js';
import { loadLaneManifestConfig } from './lane-manifests.js';

const freeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || value instanceof RegExp) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
};
/** Fresh per refresh; never retained across source/rule/order mutations. */
export const createGovernanceSnapshot = async ({ root = process.cwd() } = {}) => {
  const resolvedRoot = path.resolve(root), texts = new Map(), orders = new Map(), generated = new Map();
  const runRules = loadRunRules({ root: resolvedRoot });
  const laneConfig = await loadLaneManifestConfig({ root: resolvedRoot });
  const discovered = freeze(await discoverTests({ testsDir: path.join(resolvedRoot, 'tests'), excludedDirs: runRules.excludedDirs, excludedFiles: runRules.excludedFiles }));
  const readText = file => {
    const key = path.resolve(file);
    if (!texts.has(key)) texts.set(key, fs.readFile(key, 'utf8'));
    return texts.get(key);
  };
  return Object.freeze({
    root: resolvedRoot, runRules, laneConfig, discovered, readText,
    assertRoot(value) { if (path.resolve(value) !== resolvedRoot) throw new Error('Governance snapshot root mismatch.'); },
    readOrderIds(file) {
      const key = path.resolve(file);
      if (!orders.has(key)) orders.set(key, readText(key).then(raw => freeze(raw.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#')))));
      return orders.get(key);
    },
    acceptGeneratedManifests(manifests) {
      for (const [lane, manifest] of manifests) generated.set(lane, freeze(structuredClone(manifest)));
    },
    async manifest(lane) {
      if (generated.has(lane)) return generated.get(lane);
      const config = laneConfig.orderedLanes.get(lane);
      if (!config) return null;
      return freeze({ ...JSON.parse(await readText(config.manifestPath)), manifestPath: config.manifestPath });
    }
  });
};
