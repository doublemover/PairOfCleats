import fs from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { toPosix } from '../../shared/files.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';

export const ARTIFACT_PUBLICATION_SCHEMA_VERSION = 1;

export const resolveArtifactPublicationPath = (buildRoot, mode) => (
  path.join(buildRoot, `artifact-publication.${String(mode || 'unknown')}.json`)
);

const ensureCommittedPieceEntries = (pieceEntries) => (
  Array.isArray(pieceEntries)
    ? pieceEntries.filter((entry) => typeof entry?.path === 'string' && entry.path.trim())
    : []
);

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
  identityReconciliation = null
}) => {
  if (!buildRoot || !outDir || !mode) {
    throw new Error('writeArtifactPublicationRecord requires buildRoot, outDir, and mode.');
  }
  const committedPieceEntries = ensureCommittedPieceEntries(pieceEntries);
  const resolvedManifestPath = manifestPath || path.join(outDir, 'pieces', 'manifest.json');
  const requiredPaths = [resolvedManifestPath];
  for (const entry of committedPieceEntries) {
    requiredPaths.push(path.join(outDir, entry.path));
  }
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
    status: 'published',
    buildId: buildId || null,
    buildRoot: path.resolve(buildRoot),
    indexDir: path.resolve(outDir),
    manifestPath: path.resolve(resolvedManifestPath),
    artifactSurfaceVersion,
    compatibilityKey: compatibilityKey || null,
    identityReconciliation: identityReconciliation
      ? {
        ok: identityReconciliation.ok !== false,
        totalIssues: Number(identityReconciliation.totalIssues || 0),
        counts: identityReconciliation.counts || null,
        summary: identityReconciliation.summary || null
      }
      : null,
    pieceCount: committedPieceEntries.length,
    publishedAt: new Date().toISOString()
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
