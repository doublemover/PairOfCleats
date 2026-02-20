import fs from 'node:fs/promises';
import path from 'node:path';

const toManifestPath = (value) => String(value || '').replace(/\\/g, '/');

export const prepareArtifactIoTestDir = async (name, { root = process.cwd() } = {}) => {
  const testRoot = path.join(root, '.testCache', name);
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(testRoot, 'pieces'), { recursive: true });
  return testRoot;
};

export const writePiecesManifest = async (
  dir,
  pieces,
  { compatibilityKey = 'test-compat' } = {}
) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const normalizedPieces = Array.isArray(pieces)
    ? pieces.map((piece) => ({
      ...piece,
      path: toManifestPath(piece?.path)
    }))
    : [];
  const manifest = {
    compatibilityKey,
    pieces: normalizedPieces
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
};
