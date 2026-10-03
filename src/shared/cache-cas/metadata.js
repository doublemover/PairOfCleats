import { atomicWriteText } from '../io/atomic-write.js';
import { stableStringify } from '../stable-json.js';
import { getCasMetaPath, normalizeCasHash } from './paths.js';
import { readJsonIfExists } from './support.js';

export const readCasMetadata = async (cacheRoot, hashValue) => {
  const hash = normalizeCasHash(hashValue);
  if (!hash) return null;
  return readJsonIfExists(getCasMetaPath(cacheRoot, hash));
};

export const writeCasMetadata = async (cacheRoot, hashValue, metadata) => {
  const hash = normalizeCasHash(hashValue);
  if (!hash) throw new Error(`Invalid CAS hash: ${hashValue}`);
  const metadataPath = getCasMetaPath(cacheRoot, hash);
  await atomicWriteText(metadataPath, stableStringify({ ...metadata, hash }), { newline: true });
  return metadataPath;
};
