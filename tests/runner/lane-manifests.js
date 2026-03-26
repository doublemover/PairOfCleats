import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import {
  buildSuiteCategorySummary,
  inferSuiteCategory
} from './suite-taxonomy.js';

const DEFAULT_ORDERED_LANE_TARGETS = {
  gate: 15,
  'ci-lite': 15,
  ci: 60,
  'ci-long': 180
};

const toRepoRelativePosix = (root, targetPath) => path.relative(root, targetPath).replace(/\\/g, '/');

const resolvePath = (root, filePath) => (
  isAbsolutePathNative(filePath) ? filePath : path.resolve(root, filePath)
);

const readJsonc = async (filePath, fallback = {}) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    const parsed = parseJsonc(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const parseOrderFile = async (filePath) => {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

const parseLogTimesArtifact = async (filePath) => {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)ms\t(.+)$/);
    if (!match) continue;
    map.set(match[2], Number(match[1]));
  }
  return map;
};

const parseTimingsArtifact = async (filePath) => {
  const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  const tests = Array.isArray(parsed?.tests) ? parsed.tests : [];
  const map = new Map();
  for (const test of tests) {
    const id = typeof test?.id === 'string' ? test.id.trim() : '';
    const durationMs = Number(test?.durationMs);
    if (!id || !Number.isFinite(durationMs) || durationMs < 0) continue;
    map.set(id, durationMs);
  }
  return map;
};

const loadTimingMaps = async ({ root, timingArtifactPaths = [] }) => {
  const resolvedPaths = [];
  const maps = [];
  for (const rawPath of timingArtifactPaths) {
    const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!trimmed) continue;
    const absolutePath = resolvePath(root, trimmed);
    try {
      await fsPromises.access(absolutePath);
    } catch {
      continue;
    }
    const parser = absolutePath.endsWith('.json')
      ? parseTimingsArtifact
      : parseLogTimesArtifact;
    try {
      maps.push(await parser(absolutePath));
      resolvedPaths.push(absolutePath);
    } catch {}
  }
  return { maps, resolvedPaths };
};

const mergeTimingMaps = (maps) => {
  const merged = new Map();
  for (const map of maps) {
    for (const [id, durationMs] of map.entries()) {
      if (!merged.has(id)) {
        merged.set(id, durationMs);
      }
    }
  }
  return merged;
};

const compileOrderedLaneConfig = ({ root, configPath, raw }) => {
  const entries = new Map();
  const orderedLanes = raw?.orderedLanes && typeof raw.orderedLanes === 'object'
    ? raw.orderedLanes
    : {};
  for (const [lane, value] of Object.entries(orderedLanes)) {
    if (!value || typeof value !== 'object') continue;
    const orderFile = typeof value.orderFile === 'string' ? value.orderFile.trim() : '';
    const manifestFile = typeof value.manifestFile === 'string' ? value.manifestFile.trim() : '';
    if (!lane || !orderFile || !manifestFile) continue;
    entries.set(lane, {
      lane,
      durationBucket: typeof value.durationBucket === 'string' && value.durationBucket.trim()
        ? value.durationBucket.trim()
        : lane,
      targetMaxDurationSeconds: Number.isFinite(Number(value.targetMaxDurationSeconds))
        ? Number(value.targetMaxDurationSeconds)
        : (DEFAULT_ORDERED_LANE_TARGETS[lane] || null),
      orderFilePath: resolvePath(root, orderFile),
      manifestPath: resolvePath(root, manifestFile),
      timingArtifactPaths: Array.isArray(value.timingArtifactPaths)
        ? value.timingArtifactPaths.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      notes: typeof value.notes === 'string' ? value.notes.trim() : '',
      configPath
    });
  }
  return {
    configPath,
    orderedLanes: entries
  };
};

export const loadLaneManifestConfig = async ({ root, configPath } = {}) => {
  const resolvedConfigPath = configPath
    ? resolvePath(root || process.cwd(), configPath)
    : path.join(root || process.cwd(), 'tests', 'runner', 'lane-manifests.jsonc');
  const raw = await readJsonc(resolvedConfigPath, {});
  return compileOrderedLaneConfig({
    root: root || process.cwd(),
    configPath: resolvedConfigPath,
    raw
  });
};

export const buildOrderedLaneManifest = async ({ root, laneConfig }) => {
  const orderIds = await parseOrderFile(laneConfig.orderFilePath);
  const { maps, resolvedPaths } = await loadTimingMaps({
    root,
    timingArtifactPaths: laneConfig.timingArtifactPaths
  });
  const mergedTimings = mergeTimingMaps(maps);
  const tests = orderIds.map((id, index) => {
    const durationMs = mergedTimings.get(id);
    const suiteCategory = inferSuiteCategory({ id, lane: laneConfig.lane });
    return {
      id,
      order: index + 1,
      suiteCategory: suiteCategory.category,
      suiteCategoryReason: suiteCategory.reason,
      ...(Number.isFinite(durationMs) ? { durationMs } : {})
    };
  });
  return {
    schemaVersion: 1,
    lane: laneConfig.lane,
    selectionMode: 'ordered-manifest',
    durationBucket: laneConfig.durationBucket,
    targetMaxDurationSeconds: laneConfig.targetMaxDurationSeconds,
    notes: laneConfig.notes || '',
    sourceOrderFile: toRepoRelativePosix(root, laneConfig.orderFilePath),
    sourceConfigFile: toRepoRelativePosix(root, laneConfig.configPath),
    timingArtifactPaths: resolvedPaths.map((item) => toRepoRelativePosix(root, item)),
    suiteCategorySummary: buildSuiteCategorySummary(tests),
    tests
  };
};

export const writeOrderedLaneManifest = async ({ manifest, outputPath }) => {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await fsPromises.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

export const generateLaneManifests = async ({ root, configPath } = {}) => {
  const resolvedRoot = root || process.cwd();
  const config = await loadLaneManifestConfig({ root: resolvedRoot, configPath });
  const manifests = new Map();
  for (const laneConfig of config.orderedLanes.values()) {
    const manifest = await buildOrderedLaneManifest({
      root: resolvedRoot,
      laneConfig
    });
    await writeOrderedLaneManifest({
      manifest,
      outputPath: laneConfig.manifestPath
    });
    manifests.set(laneConfig.lane, {
      ...manifest,
      manifestPath: laneConfig.manifestPath
    });
  }
  return {
    config,
    manifests
  };
};

export const loadOrderedLaneManifest = async ({ root, lane, config }) => {
  const resolvedRoot = root || process.cwd();
  const manifestConfig = config || await loadLaneManifestConfig({ root: resolvedRoot });
  const laneConfig = manifestConfig.orderedLanes.get(lane);
  if (!laneConfig) return null;
  const parsed = JSON.parse(await fsPromises.readFile(laneConfig.manifestPath, 'utf8'));
  return {
    ...parsed,
    manifestPath: laneConfig.manifestPath
  };
};

export const loadOrderedLaneManifests = async ({ root, config } = {}) => {
  const resolvedRoot = root || process.cwd();
  const manifestConfig = config || await loadLaneManifestConfig({ root: resolvedRoot });
  const manifests = new Map();
  for (const lane of manifestConfig.orderedLanes.keys()) {
    const manifest = await loadOrderedLaneManifest({
      root: resolvedRoot,
      lane,
      config: manifestConfig
    });
    if (manifest) manifests.set(lane, manifest);
  }
  return manifests;
};
