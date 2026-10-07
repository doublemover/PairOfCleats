import fs from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { toPosix } from '../../shared/file-paths.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';

export const ARTIFACT_PUBLICATION_SCHEMA_VERSION = 1;
export const ARTIFACT_PUBLICATION_FAMILY_CONTRACTS_VERSION = 1;
export const ARTIFACT_PUBLICATION_STATUSES = Object.freeze({
  VALIDATED: 'validated',
  PUBLISHED: 'published'
});

export const resolveArtifactPublicationPath = (buildRoot, mode) => (
  path.join(buildRoot, `artifact-publication.${String(mode || 'unknown')}.json`)
);

export const resolveArtifactPublicationValidationPath = (buildRoot, mode) => (
  path.join(buildRoot, `artifact-publication.${String(mode || 'unknown')}.validation.json`)
);

const ensureCommittedPieceEntries = (pieceEntries) => (
  Array.isArray(pieceEntries)
    ? pieceEntries.filter((entry) => typeof entry?.path === 'string' && entry.path.trim())
    : []
);

export const resolveCommittedArtifactPaths = ({
  buildRoot,
  outDir,
  pieceEntries = [],
  manifestPath = null
} = {}) => {
  if (!buildRoot || !outDir) return [];
  const resolvedManifestPath = manifestPath || path.join(outDir, 'pieces', 'manifest.json');
  const committedPieceEntries = ensureCommittedPieceEntries(pieceEntries);
  const requiredPaths = [resolvedManifestPath];
  for (const entry of committedPieceEntries) {
    requiredPaths.push(path.join(outDir, entry.path));
  }
  return Array.from(new Set(requiredPaths.map((targetPath) => path.resolve(targetPath))));
};

const normalizeFamilyMembers = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
)).sort((a, b) => a.localeCompare(b));

const resolveGenerationId = ({ buildId, buildRoot, mode }) => (
  String(buildId || path.basename(buildRoot) || mode || 'generation').trim()
);

const normalizeCleanupSummary = (cleanup) => {
  if (!cleanup || typeof cleanup !== 'object') return null;
  const plannedActions = Number(cleanup.plannedActions);
  const completedActions = Number(cleanup.completedActions);
  const failedActions = Number(cleanup.failedActions);
  return {
    schemaVersion: Number.isFinite(Number(cleanup.schemaVersion))
      ? Number(cleanup.schemaVersion)
      : 1,
    status: typeof cleanup.status === 'string' && cleanup.status.trim()
      ? cleanup.status.trim()
      : 'unknown',
    plannedActions: Number.isFinite(plannedActions) && plannedActions >= 0 ? plannedActions : 0,
    completedActions: Number.isFinite(completedActions) && completedActions >= 0 ? completedActions : 0,
    failedActions: Number.isFinite(failedActions) && failedActions >= 0 ? failedActions : 0,
    failures: Array.isArray(cleanup.failures)
      ? cleanup.failures
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          message: typeof entry.message === 'string' ? entry.message : String(entry.message || '')
        }))
      : []
  };
};

export const validateArtifactPublicationGeneration = async ({
  buildRoot,
  outDir,
  mode,
  buildId = null,
  pieceEntries = [],
  manifestPath = null,
  familyDeclarations = []
} = {}) => {
  if (!buildRoot || !outDir || !mode) {
    throw new Error('validateArtifactPublicationGeneration requires buildRoot, outDir, and mode.');
  }
  const resolvedManifestPath = manifestPath || path.join(outDir, 'pieces', 'manifest.json');
  const committedPieceEntries = ensureCommittedPieceEntries(pieceEntries);
  const generationId = resolveGenerationId({ buildId, buildRoot, mode });
  let manifest = null;
  try {
    manifest = JSON.parse(await fs.readFile(resolvedManifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `[artifact-publication] cannot validate ${mode}: manifest unreadable ${resolvedManifestPath} `
      + `(${error?.message || error})`
    );
  }
  const manifestEntries = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  const committedByName = new Map();
  const committedByPath = new Map();
  const manifestByName = new Map();
  const manifestByPath = new Map();
  for (const entry of committedPieceEntries) {
    committedByPath.set(entry.path, entry);
    if (!committedByName.has(entry.name)) committedByName.set(entry.name, []);
    committedByName.get(entry.name).push(entry);
  }
  for (const entry of manifestEntries) {
    if (typeof entry?.path !== 'string' || !entry.path.trim()) continue;
    manifestByPath.set(entry.path, entry);
    if (typeof entry?.name === 'string' && entry.name.trim()) {
      if (!manifestByName.has(entry.name)) manifestByName.set(entry.name, []);
      manifestByName.get(entry.name).push(entry);
    }
  }
  const missingCommittedPaths = [];
  for (const entry of committedPieceEntries) {
    const resolvedPath = path.join(outDir, entry.path);
    try {
      await fs.stat(resolvedPath);
    } catch (error) {
      missingCommittedPaths.push({
        path: entry.path,
        message: error?.message || String(error)
      });
    }
  }
  const missingManifestEntries = committedPieceEntries
    .filter((entry) => !manifestByPath.has(entry.path))
    .map((entry) => entry.path);
  const extraManifestEntries = manifestEntries
    .filter((entry) => typeof entry?.path === 'string' && !committedByPath.has(entry.path))
    .map((entry) => entry.path);

  const families = (Array.isArray(familyDeclarations) ? familyDeclarations : []).map((family) => {
    const requiredMembers = normalizeFamilyMembers(family?.requiredMembers);
    const optionalMembers = normalizeFamilyMembers(family?.optionalMembers);
    const presentCommittedMembers = requiredMembers
      .filter((name) => committedByName.has(name));
    const presentManifestMembers = requiredMembers
      .filter((name) => manifestByName.has(name));
    const missingRequiredMembers = requiredMembers.filter((name) => (
      !committedByName.has(name) || !manifestByName.has(name)
    ));
    return {
      family: typeof family?.family === 'string' ? family.family : 'unnamed-family',
      owner: typeof family?.owner === 'string' ? family.owner : null,
      requiredMembers,
      optionalMembers,
      presentCommittedMembers,
      presentManifestMembers,
      missingRequiredMembers,
      ok: missingRequiredMembers.length === 0
    };
  });
  const failedFamilies = families.filter((family) => !family.ok);
  return {
    schemaVersion: 1,
    familyContractsVersion: ARTIFACT_PUBLICATION_FAMILY_CONTRACTS_VERSION,
    mode,
    buildId: buildId || null,
    generationId,
    buildRoot: path.resolve(buildRoot),
    indexDir: path.resolve(outDir),
    manifestPath: path.resolve(resolvedManifestPath),
    validatedAt: new Date().toISOString(),
    ok: (
      missingCommittedPaths.length === 0
      && missingManifestEntries.length === 0
      && extraManifestEntries.length === 0
      && failedFamilies.length === 0
    ),
    counts: {
      committedPieces: committedPieceEntries.length,
      manifestPieces: manifestEntries.length,
      declaredFamilies: families.length,
      failedFamilies: failedFamilies.length
    },
    checks: {
      missingCommittedPaths,
      missingManifestEntries,
      extraManifestEntries
    },
    families
  };
};

export const writeArtifactPublicationValidationReport = async (input = {}) => {
  const payload = await validateArtifactPublicationGeneration(input);
  const validationPath = resolveArtifactPublicationValidationPath(input.buildRoot, input.mode);
  await atomicWriteJson(validationPath, payload, { spaces: 2, newline: true });
  return { validationPath, payload };
};

export const writeArtifactPublicationRecord = async ({
  buildRoot,
  outDir,
  mode,
  stage = null,
  buildId = null,
  artifactSurfaceVersion = ARTIFACT_SURFACE_VERSION,
  compatibilityKey = null,
  pieceEntries = [],
  manifestPath = null,
  identityReconciliation = null,
  publicationValidation = null,
  cleanup = null,
  status = ARTIFACT_PUBLICATION_STATUSES.PUBLISHED,
  publishedAt = null
}) => {
  if (!buildRoot || !outDir || !mode) {
    throw new Error('writeArtifactPublicationRecord requires buildRoot, outDir, and mode.');
  }
  const committedPieceEntries = ensureCommittedPieceEntries(pieceEntries);
  const resolvedManifestPath = manifestPath || path.join(outDir, 'pieces', 'manifest.json');
  const normalizedStatus = Object.values(ARTIFACT_PUBLICATION_STATUSES).includes(status)
    ? status
    : ARTIFACT_PUBLICATION_STATUSES.PUBLISHED;
  const requiredPaths = resolveCommittedArtifactPaths({
    buildRoot,
    outDir,
    pieceEntries: committedPieceEntries,
    manifestPath: resolvedManifestPath
  });
  for (const requiredPath of requiredPaths) {
    try {
      await fs.stat(requiredPath);
    } catch (error) {
      const rel = toPosix(path.relative(buildRoot, requiredPath));
      throw new Error(
        `[artifact-publication] cannot publish ${mode}: missing committed artifact ${rel} `
        + `(${error?.message || error})`
      );
    }
  }
  const payload = {
    schemaVersion: ARTIFACT_PUBLICATION_SCHEMA_VERSION,
    mode,
    stage,
    status: normalizedStatus,
    buildId: buildId || null,
    generationId: resolveGenerationId({ buildId, buildRoot, mode }),
    buildRoot: path.resolve(buildRoot),
    indexDir: path.resolve(outDir),
    manifestPath: path.resolve(resolvedManifestPath),
    artifactSurfaceVersion,
    compatibilityKey: compatibilityKey || null,
    publicationValidation: publicationValidation
      ? {
        ok: publicationValidation.ok !== false,
        validationPath: publicationValidation.validationPath || null,
        familyContractsVersion: Number(
          publicationValidation.payload?.familyContractsVersion
            || ARTIFACT_PUBLICATION_FAMILY_CONTRACTS_VERSION
        ),
        failedFamilies: Number(publicationValidation.payload?.counts?.failedFamilies || 0),
        counts: publicationValidation.payload?.counts || null,
        families: Array.isArray(publicationValidation.payload?.families)
          ? publicationValidation.payload.families.map((family) => ({
            family: typeof family?.family === 'string' ? family.family : 'unnamed-family',
            owner: typeof family?.owner === 'string' ? family.owner : null,
            ok: family?.ok !== false,
            missingRequiredMembers: Array.isArray(family?.missingRequiredMembers)
              ? family.missingRequiredMembers
              : []
          }))
          : []
      }
      : null,
    cleanup: normalizeCleanupSummary(cleanup),
    identityReconciliation: identityReconciliation
      ? {
        ok: identityReconciliation.ok !== false,
        totalIssues: Number(identityReconciliation.totalIssues || 0),
        counts: identityReconciliation.counts || null,
        summary: identityReconciliation.summary || null
      }
      : null,
    pieceCount: committedPieceEntries.length,
    publishedAt: normalizedStatus === ARTIFACT_PUBLICATION_STATUSES.PUBLISHED
      ? (publishedAt || new Date().toISOString())
      : null
  };
  const publicationPath = resolveArtifactPublicationPath(buildRoot, mode);
  await atomicWriteJson(publicationPath, payload, { spaces: 2, newline: true });
  return { publicationPath, payload };
};

export const readArtifactPublicationRecord = async (buildRoot, mode) => {
  const publicationPath = resolveArtifactPublicationPath(buildRoot, mode);
  const raw = await fs.readFile(publicationPath, 'utf8');
  return JSON.parse(raw);
};

export const assertArtifactPublicationReady = async ({
  buildRoot,
  modes = []
}) => {
  if (!buildRoot) {
    throw new Error('assertArtifactPublicationReady requires buildRoot.');
  }
  const normalizedModes = Array.from(new Set(
    (Array.isArray(modes) ? modes : [])
      .filter((mode) => typeof mode === 'string' && mode.trim())
      .map((mode) => mode.trim())
  ));
  for (const mode of normalizedModes) {
    const publicationPath = resolveArtifactPublicationPath(buildRoot, mode);
    let payload = null;
    try {
      payload = JSON.parse(await fs.readFile(publicationPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `[artifact-publication] missing publication record for ${mode}: ${publicationPath} `
        + `(${error?.message || error})`
      );
    }
    if (payload?.status !== 'published') {
      throw new Error(
        `[artifact-publication] ${mode} publication is not marked published in ${publicationPath}.`
      );
    }
    if (typeof payload?.manifestPath !== 'string' || !payload.manifestPath) {
      throw new Error(
        `[artifact-publication] ${mode} publication is missing manifestPath in ${publicationPath}.`
      );
    }
    if (payload?.publicationValidation && payload.publicationValidation.ok === false) {
      throw new Error(
        `[artifact-publication] ${mode} publication validation failed in ${publicationPath}.`
      );
    }
    if (payload?.identityReconciliation && payload.identityReconciliation.ok === false) {
      throw new Error(
        `[artifact-publication] ${mode} identity reconciliation failed in ${publicationPath}.`
      );
    }
    try {
      await fs.stat(payload.manifestPath);
    } catch (error) {
      throw new Error(
        `[artifact-publication] ${mode} manifest missing for published generation: ${payload.manifestPath} `
        + `(${error?.message || error})`
      );
    }
  }
};
