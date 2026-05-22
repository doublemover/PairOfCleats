import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCasObjectsRoot, normalizeCasHash } from './paths.js';
import { CAS_ENUM_CONCURRENCY, fileExists, runWithConcurrency } from './support.js';

export const listCasObjectHashes = async (cacheRoot) => {
  const objectsRoot = getCasObjectsRoot(cacheRoot);
  if (!fileExists(objectsRoot)) return [];
  const out = [];
  const levelOne = await fsPromises.readdir(objectsRoot, { withFileTypes: true });
  const levelOneDirs = levelOne.filter((entry) => entry.isDirectory());
  const nestedHashes = await runWithConcurrency(levelOneDirs, CAS_ENUM_CONCURRENCY, async (one) => {
    const onePath = path.join(objectsRoot, one.name);
    let levelTwo = [];
    try {
      levelTwo = await fsPromises.readdir(onePath, { withFileTypes: true });
    } catch {
      return [];
    }
    const levelTwoDirs = levelTwo.filter((entry) => entry.isDirectory());
    const perDir = await runWithConcurrency(levelTwoDirs, CAS_ENUM_CONCURRENCY, async (two) => {
      const twoPath = path.join(onePath, two.name);
      let objects = [];
      try {
        objects = await fsPromises.readdir(twoPath, { withFileTypes: true });
      } catch {
        return [];
      }
      const hashes = [];
      for (const objectEntry of objects) {
        if (!objectEntry.isFile()) continue;
        const hash = normalizeCasHash(objectEntry.name);
        if (!hash) continue;
        hashes.push(hash);
      }
      return hashes;
    });
    return perDir.flat();
  });
  for (const hashes of nestedHashes) {
    if (!Array.isArray(hashes) || !hashes.length) continue;
    out.push(...hashes);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
};
