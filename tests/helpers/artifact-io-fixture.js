import { checksumFile } from '../../src/shared/hash.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { prepareTestCacheDir } from './test-cache.js';

const toManifestPath = (value) => String(value || '').replace(/\\/g, '/');

export const prepareArtifactIoTestDir = async (name, { root = process.cwd() } = {}) => {
  const { dir: testRoot } = await prepareTestCacheDir(name, { root });
  await fs.mkdir(path.join(testRoot, 'pieces'), { recursive: true });
  return testRoot;
};

export const writePiecesManifest = async (
  dir,
  pieces,
  { compatibilityKey = 'test-compat', semantic = false, buildId = 'artifact-fixture' } = {}
) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const normalizedPieces = Array.isArray(pieces)
    ? pieces.map((piece) => ({
      ...piece,
      path: toManifestPath(piece?.path)
    }))
    : [];
  if (semantic) normalizedPieces.push(...await writeSemanticFixtureFamily(dir, { buildId }));
  const manifest = {
    ...(semantic ? { buildId } : {}),
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    pieces: normalizedPieces
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
};

/** Produce a valid disabled semantic family, including indexes and checksums. */
export const writeSemanticFixtureFamily = async (dir, { buildId = 'artifact-fixture' } = {}) => {
  const { enqueueSemanticArtifacts } = await import('../../src/index/build/artifacts/writers/semantic/family.js');
  const jobs = [], registered = [];
  enqueueSemanticArtifacts({ state: {}, root: dir, outDir: dir, indexState: { buildId }, enabled: false,
    enqueueWrite: (_label, job) => jobs.push(job), declareArtifactFamily: () => {},
    addPieceFile: (piece, file) => registered.push({ piece, file }) });
  for (const job of jobs) await job();
  return Promise.all(registered.map(async ({ piece, file }) => {
    const checksum = await checksumFile(file);
    return { ...piece, path: toManifestPath(path.relative(dir, file)), checksum: `${checksum.algo}:${checksum.value}` };
  }));
};

/** SQLite code imports require the complete registered semantic family. */
export const writeSqliteArtifactManifest = (dir, pieces, options = {}) =>
  writePiecesManifest(dir, pieces, { ...options, semantic: true });
