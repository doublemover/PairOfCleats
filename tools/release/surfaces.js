import fs from 'node:fs';
import path from 'node:path';
import { resolveToolRoot } from '../shared/dict-utils.js';

export const SHIPPED_SURFACES_REGISTRY_PATH = 'docs/tooling/shipped-surfaces.json';

const COMMAND_TOKENS = Object.freeze({
  '$NODE': () => process.execPath
});

const normalizeString = (value) => String(value || '').trim();

const normalizeStringArray = (value) => (Array.isArray(value) ? value : [])
  .map((entry) => normalizeString(entry))
  .filter(Boolean);

const resolveCommandToken = (part) => {
  const text = normalizeString(part);
  if (!text) {
    return '';
  }
  const resolver = COMMAND_TOKENS[text];
  return typeof resolver === 'function' ? resolver() : text;
};

const normalizeReleaseCheckStep = (surfaceId, step, index) => {
  const id = normalizeString(step?.id);
  const label = normalizeString(step?.label);
  const command = normalizeStringArray(step?.command).map((part) => resolveCommandToken(part));
  const artifacts = normalizeStringArray(step?.artifacts);
  if (!id || !label || command.length === 0) {
    throw new Error(`invalid releaseCheck step for ${surfaceId} at index ${index}`);
  }
  return {
    id,
    label,
    command,
    artifacts
  };
};

const normalizeSurface = (surface, index) => {
  const id = normalizeString(surface?.id);
  const name = normalizeString(surface?.name);
  const owner = normalizeString(surface?.owner);
  const supportLevel = normalizeString(surface?.supportLevel);
  const packagingBoundary = normalizeString(surface?.packagingBoundary);
  const publishBoundary = normalizeString(surface?.publishBoundary);
  const versionSource = normalizeString(surface?.versionSource);
  const runtimeTargets = normalizeStringArray(surface?.runtimeTargets);
  const platforms = normalizeStringArray(surface?.platforms);
  const build = surface?.build && typeof surface.build === 'object' ? {
    kind: normalizeString(surface.build.kind),
    sourcePaths: normalizeStringArray(surface.build.sourcePaths),
    outputs: normalizeStringArray(surface.build.outputs)
  } : {
    kind: '',
    sourcePaths: [],
    outputs: []
  };
  const install = surface?.install && typeof surface.install === 'object' ? {
    kind: normalizeString(surface.install.kind),
    summary: normalizeString(surface.install.summary)
  } : { kind: '', summary: '' };
  const smoke = surface?.smoke && typeof surface.smoke === 'object' ? {
    summary: normalizeString(surface.smoke.summary)
  } : { summary: '' };
  const releaseCheckConfig = surface?.releaseCheck && typeof surface.releaseCheck === 'object'
    ? surface.releaseCheck
    : {};
  const releaseCheck = {
    enabled: releaseCheckConfig.enabled === true,
    steps: (Array.isArray(releaseCheckConfig.steps) ? releaseCheckConfig.steps : [])
      .map((step, stepIndex) => normalizeReleaseCheckStep(id || `surface-${index}`, step, stepIndex))
  };
  if (!id || !name || !owner || !supportLevel || !packagingBoundary || !publishBoundary || !versionSource) {
    throw new Error(`invalid shipped surface metadata at index ${index}`);
  }
  if (!build.kind || !install.kind || !install.summary || !smoke.summary) {
    throw new Error(`surface ${id} is missing build/install/smoke contract metadata`);
  }
  return {
    id,
    name,
    owner,
    supportLevel,
    packagingBoundary,
    publishBoundary,
    versionSource,
    runtimeTargets,
    platforms,
    build,
    install,
    smoke,
    releaseCheck
  };
};

export const getShippedSurfacesRegistryPath = (root = resolveToolRoot()) =>
  path.join(root, SHIPPED_SURFACES_REGISTRY_PATH);

export const loadShippedSurfaces = (root = resolveToolRoot()) => {
  const registryPath = getShippedSurfacesRegistryPath(root);
  const payload = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const surfaces = (Array.isArray(payload?.surfaces) ? payload.surfaces : [])
    .map((surface, index) => normalizeSurface(surface, index));
  const ids = new Set();
  const stepIds = new Set();
  for (const surface of surfaces) {
    if (ids.has(surface.id)) {
      throw new Error(`duplicate shipped surface id: ${surface.id}`);
    }
    ids.add(surface.id);
    for (const step of surface.releaseCheck.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`duplicate shipped surface release-check step id: ${step.id}`);
      }
      stepIds.add(step.id);
    }
  }
  return {
    schemaVersion: normalizeString(payload?.schemaVersion),
    registryPath,
    surfaces
  };
};

export const getReleaseCheckSurfaceSteps = (root = resolveToolRoot()) => {
  const registry = loadShippedSurfaces(root);
  return registry.surfaces.flatMap((surface) =>
    surface.releaseCheck.enabled
      ? surface.releaseCheck.steps.map((step) => ({
        ...step,
        phase: 'smoke',
        surfaceId: surface.id,
        surfaceName: surface.name,
        owner: surface.owner
      }))
      : []
  );
};
