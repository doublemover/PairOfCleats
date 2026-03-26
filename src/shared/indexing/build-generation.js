import fs from 'node:fs';
import { resolveCurrentBuildRoots } from './build-pointer-roots.js';

export const buildGenerationKey = ({
  buildId = null,
  buildRoot = null,
  activeRoot = null,
  buildRoots = null
} = {}) => {
  const normalizedBuildRoots = buildRoots && typeof buildRoots === 'object'
    ? Object.fromEntries(
      Object.entries(buildRoots)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .sort(([left], [right]) => left.localeCompare(right))
    )
    : {};
  return JSON.stringify({
    buildId: typeof buildId === 'string' && buildId.trim() ? buildId : null,
    buildRoot: typeof buildRoot === 'string' && buildRoot.trim() ? buildRoot : null,
    activeRoot: typeof activeRoot === 'string' && activeRoot.trim() ? activeRoot : null,
    buildRoots: normalizedBuildRoots
  });
};

export const resolveCurrentBuildGeneration = (data, options = {}) => {
  const currentRoots = resolveCurrentBuildRoots(data, options);
  return {
    ...currentRoots,
    generationKey: buildGenerationKey(currentRoots)
  };
};

export const readCurrentBuildGeneration = ({
  currentJsonPath,
  repoCacheRoot,
  buildsRoot,
  preferredMode = null
} = {}) => {
  const empty = {
    currentJsonPath: currentJsonPath || null,
    currentJsonExists: false,
    currentJsonMtimeMs: null,
    parseOk: false,
    buildId: null,
    buildRoot: null,
    activeRoot: null,
    buildRoots: {},
    generationKey: null
  };
  if (!currentJsonPath || !repoCacheRoot || !buildsRoot) return empty;
  let stat = null;
  try {
    stat = fs.statSync(currentJsonPath);
  } catch {
    return empty;
  }
  try {
    const raw = fs.readFileSync(currentJsonPath, 'utf8');
    const data = JSON.parse(raw) || {};
    const generation = resolveCurrentBuildGeneration(data, {
      repoCacheRoot,
      buildsRoot,
      preferredMode
    });
    return {
      currentJsonPath,
      currentJsonExists: true,
      currentJsonMtimeMs: Number(stat.mtimeMs) || null,
      parseOk: true,
      buildId: generation.buildId || null,
      buildRoot: generation.buildRoot || null,
      activeRoot: generation.activeRoot || null,
      buildRoots: generation.buildRoots || {},
      generationKey: generation.generationKey || null
    };
  } catch {
    return {
      ...empty,
      currentJsonExists: true,
      currentJsonMtimeMs: Number(stat?.mtimeMs) || null
    };
  }
};
