import fs from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { toPosix } from '../../shared/file-paths.js';
import { assertArtifactFilePath, resolveArtifactPath, resolveArtifactIdentityPath } from '../../shared/artifact-io/contained-path.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { assertNoSymlinkPath } from '../../shared/contained-file.js';
import { observePublicationIntegrity, assertPublicationIntegrity, publicationInventoryDigest } from './publication-integrity.js';
import { stableStringify } from '../../shared/stable-json.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';

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

const ensureCommittedPieceEntries = (pieceEntries) => {
  if (!Array.isArray(pieceEntries) || pieceEntries.some(entry => (
    typeof entry?.path !== 'string' || !entry.path || typeof entry?.name !== 'string' || !entry.name
  ))) throw new Error('[artifact-publication] invalid committed piece identity.');
  return pieceEntries;
};

/** Each small batch drains before yielding ordered observations. Consumer
 * diagnostics may fail without stranding native work or admitting another
 * batch. Only four queue entries exist, even for a large piece inventory.
 */
const statCommittedArtifacts = async function* (values, resolvePath) {
  if (!values.length) return;
  // Read-only path/status consumers need not eagerly load the queue runtime.
  const { runWithSettledConcurrency } = await import('../../shared/concurrency/run-with-queue.js');
  for (let start = 0; start < values.length; start += 4) {
    yield await runWithSettledConcurrency(values.slice(start, start + 4), 4, async value => {
      const filename = resolvePath(value);
      try { await fs.stat(filename); return { value, failed: false }; }
      catch (error) {
        observeStorageResource(error, { phase: 'artifact-publication-stat' }).requireSettled();
        return { value, failed: true, error };
      }
    }, { collectResults: true });
  }
};

export const resolveCommittedArtifactPaths = ({
  buildRoot,
  outDir,
  pieceEntries = [],
  manifestPath = null
} = {}) => {
  if (!buildRoot || !outDir) return [];
  const resolvedManifestPath = assertArtifactFilePath(outDir, manifestPath || path.join(outDir, 'pieces', 'manifest.json'));
  const committedPieceEntries = ensureCommittedPieceEntries(pieceEntries);
  const requiredPaths = [resolvedManifestPath];
  for (const entry of committedPieceEntries) {
    requiredPaths.push(resolveArtifactPath(outDir, entry.path));
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

const samePublicationDirectory = async (recorded, expected) => {
  if (typeof recorded !== 'string' || !path.isAbsolute(recorded)) return false;
  if (path.relative(path.resolve(recorded), path.resolve(expected)) === '') return true;
  if (process.platform !== 'win32') return false;
  // Windows short names and extended-length paths can name the same directory
  // with different lexical prefixes. Admit only the identical existing object;
  // junctions/symlinks and an unavailable filesystem identity cannot grant it.
  try {
    for (const directory of [recorded, expected]) {
      const volume = path.parse(directory).root;
      const first = path.relative(volume, directory).split(path.sep).filter(Boolean)[0];
      if (!first) return false;
      // lstat cannot inspect the extended-length volume root on Node/Windows.
      // Start at its first component, still checking every directory component.
      assertNoSymlinkPath(path.join(volume, first), directory);
    }
    const [left, right] = await Promise.all([fs.stat(recorded, { bigint: true }), fs.stat(expected, { bigint: true })]);
    return left.isDirectory() && right.isDirectory() && left.ino !== 0n
      && left.dev === right.dev && left.ino === right.ino;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

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
  familyDeclarations = [],
  producerPolicy = null
} = {}) => {
  if (!buildRoot || !outDir || !mode) {
    throw new Error('validateArtifactPublicationGeneration requires buildRoot, outDir, and mode.');
  }
  const resolvedManifestPath = assertArtifactFilePath(outDir, manifestPath || path.join(outDir, 'pieces', 'manifest.json'));
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
  const identityErrors = [];
  const addIdentity = (entry, byPath, source) => {
    if (typeof entry?.name !== 'string' || !entry.name || typeof entry?.path !== 'string' || !entry.path) {
      identityErrors.push({ source, path: entry?.path ?? null, message: 'invalid piece identity' });
      return false;
    }
    // These synchronous loops compare labels, not file bytes. Every committed
    // target is physically admitted immediately before its stat below. Keep
    // physical admission for unmatched manifest members too; no path is cached
    // across asynchronous work or borrowed from a prior validation.
    resolveArtifactIdentityPath(outDir, entry.path);
    if (source === 'manifest' && !committedByPath.has(entry.path)) resolveArtifactPath(outDir, entry.path);
    if (byPath.has(entry.path)) {
      identityErrors.push({ source, path: entry.path, message: 'duplicate piece path' });
      return false;
    }
    byPath.set(entry.path, entry);
    return true;
  };
  for (const entry of committedPieceEntries) {
    if (!addIdentity(entry, committedByPath, 'committed')) continue;
    if (!committedByName.has(entry.name)) committedByName.set(entry.name, []);
    committedByName.get(entry.name).push(entry);
  }
  for (const entry of manifestEntries) {
    if (!addIdentity(entry, manifestByPath, 'manifest')) continue;
    if (typeof entry?.name === 'string' && entry.name.trim()) {
      if (!manifestByName.has(entry.name)) manifestByName.set(entry.name, []);
      manifestByName.get(entry.name).push(entry);
    }
  }
  for (const entry of committedPieceEntries) {
    const selected = manifestByPath.get(entry.path);
    if (!selected) continue;
    const fields = ['name', 'format', 'count', 'bytes', 'checksum'];
    const mismatches = fields.filter(field => (
      (field === 'name' || entry[field] != null) && selected[field] !== entry[field]
    ));
    if (mismatches.length) identityErrors.push({
      source: 'manifest', path: entry.path, message: `piece identity mismatch: ${mismatches.join(', ')}`
    });
  }
  const missingCommittedPaths = [];
  for await (const batch of statCommittedArtifacts(committedPieceEntries, entry => resolveArtifactPath(outDir, entry.path))) {
    for (const { value: entry, failed, error } of batch) if (failed) missingCommittedPaths.push({
      path: entry.path,
      message: error?.message || String(error)
    });
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
  if (producerPolicy) {
    const stateRead = await readVerifiedContainedFile(outDir, resolveArtifactPath(outDir, 'index_state.json'), { maxBytes: 8 * 1024 * 1024 });
    const state = JSON.parse(stateRead.buffer.toString('utf8'));
    if (stableStringify({ profile: state.profile, artifacts: state.artifacts }) !== stableStringify(producerPolicy)) {
      identityErrors.push({ source: 'producer-policy', message: 'captured producer plan differs from persisted policy' });
    }
  }
  const integrityBinding = identityErrors.length || missingCommittedPaths.length || missingManifestEntries.length
    || extraManifestEntries.length || failedFamilies.length ? null
    : await observePublicationIntegrity({ outDir, manifestPath: resolvedManifestPath });
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
    integrityBinding,
    committedInventoryHash: publicationInventoryDigest(committedPieceEntries),
    producerPolicy: producerPolicy ? structuredClone(producerPolicy) : null,
    ok: (
      identityErrors.length === 0
      && missingCommittedPaths.length === 0
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
      identityErrors,
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
  const resolvedManifestPath = assertArtifactFilePath(outDir, manifestPath || path.join(outDir, 'pieces', 'manifest.json'));
  if (!Object.values(ARTIFACT_PUBLICATION_STATUSES).includes(status)) {
    throw new Error(`[artifact-publication] unknown publication status: ${status}`);
  }
  const normalizedStatus = status;
  const validationPayload = publicationValidation?.payload || publicationValidation;
  if (normalizedStatus === ARTIFACT_PUBLICATION_STATUSES.PUBLISHED && validationPayload?.ok !== true) {
    throw new Error('[artifact-publication] publishing requires successful generation validation.');
  }
  if (normalizedStatus === ARTIFACT_PUBLICATION_STATUSES.PUBLISHED && (
    validationPayload.mode !== mode || path.resolve(validationPayload.buildRoot || '.') !== path.resolve(buildRoot)
    || path.resolve(validationPayload.indexDir || '.') !== path.resolve(outDir)
    || path.resolve(validationPayload.manifestPath || '.') !== resolvedManifestPath
    || validationPayload.generationId !== resolveGenerationId({ buildId, buildRoot, mode })
  )) throw new Error('[artifact-publication] generation validation belongs to another publication authority.');
  if (normalizedStatus === ARTIFACT_PUBLICATION_STATUSES.PUBLISHED) {
    if (validationPayload.committedInventoryHash !== publicationInventoryDigest(committedPieceEntries)) {
      throw new Error('[artifact-publication] committed inventory differs from generation validation.');
    }
    await assertPublicationIntegrity({ outDir, manifestPath: resolvedManifestPath, binding: validationPayload.integrityBinding });
  }
  const requiredPaths = resolveCommittedArtifactPaths({
    buildRoot,
    outDir,
    pieceEntries: committedPieceEntries,
    manifestPath: resolvedManifestPath
  });
  for await (const batch of statCommittedArtifacts(requiredPaths, filename => filename)) {
    let failure = null;
    for (const { value: requiredPath, failed, error } of batch) if (failed) {
      const rel = toPosix(path.relative(buildRoot, requiredPath));
      const current = new Error(
        `[artifact-publication] cannot publish ${mode}: missing committed artifact ${rel} `
        + `(${error?.message || error})`, { cause: error }
      );
      failure = failure ? addStorageFailureContext(failure, {}, current, { secondaryPresent: true }) : current;
    }
    if (failure) throw failure;
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
        ok: validationPayload?.ok === true,
        integrityBinding: validationPayload?.integrityBinding || null,
        producerPolicy: validationPayload?.producerPolicy || null,
        validationPath: publicationValidation.validationPath || null,
        familyContractsVersion: Number(
          validationPayload?.familyContractsVersion
            || ARTIFACT_PUBLICATION_FAMILY_CONTRACTS_VERSION
        ),
        failedFamilies: Number(validationPayload?.counts?.failedFamilies || 0),
        counts: validationPayload?.counts || null,
        families: Array.isArray(validationPayload?.families)
          ? validationPayload.families.map((family) => ({
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
      payload = JSON.parse(await fs.readFile(assertArtifactFilePath(buildRoot, publicationPath), 'utf8'));
    } catch (error) {
      throw new Error(
        `[artifact-publication] missing publication record for ${mode}: ${publicationPath} `
        + `(${error?.message || error})`, { cause: error }
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
    const expectedIndexDir = path.resolve(buildRoot, `index-${mode}`);
    if (payload.schemaVersion !== ARTIFACT_PUBLICATION_SCHEMA_VERSION || payload.mode !== mode
      || !await samePublicationDirectory(payload.buildRoot, buildRoot)
      || !await samePublicationDirectory(payload.indexDir, expectedIndexDir)
      || payload.generationId !== resolveGenerationId({ buildId: payload.buildId, buildRoot: payload.buildRoot, mode })
      || payload.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION) {
      throw new Error(`[artifact-publication] ${mode} record does not belong to the requested generation.`);
    }
    const containedManifest = assertArtifactFilePath(expectedIndexDir, payload.manifestPath);
    const manifest = JSON.parse(await fs.readFile(containedManifest, 'utf8'));
    if (manifest.mode !== mode || (payload.buildId != null && manifest.buildId !== payload.buildId)
      || manifest.artifactSurfaceVersion !== payload.artifactSurfaceVersion
      || !Array.isArray(manifest.pieces) || payload.pieceCount !== manifest.pieces.length) {
      throw new Error(`[artifact-publication] ${mode} manifest identity differs from publication authority.`);
    }
    if (payload?.publicationValidation?.ok !== true) {
      throw new Error(
        `[artifact-publication] ${mode} publication validation failed in ${publicationPath}.`
      );
    }
    await assertPublicationIntegrity({ outDir: expectedIndexDir, manifestPath: containedManifest,
      binding: payload.publicationValidation.integrityBinding });
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
        + `(${error?.message || error})`, { cause: error }
      );
    }
  }
};
