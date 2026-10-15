import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { assertCurrentIndexFormat } from '../../../contracts/index-format.js';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { canonicalBundleSourceKey } from '../../../shared/bundle-source-key.js';
import { canonicalizeBundlePayloadForChecksum } from '../../../shared/bundle-checksum.js';

export const INCREMENTAL_MANIFEST_VERSION = 6;
export const INCREMENTAL_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const capacity = () => Object.assign(new Error('Incremental manifest exceeds its 8 MiB publication allowance; prior snapshot retained.'),
  { code: 'ERR_INCREMENTAL_MANIFEST_CAPACITY' });

/** Compact repeated dependencies; construct at most one bounded serialized manifest. */
export const encodeIncrementalManifest = (manifest, { repoRoot = process.cwd(), indexPath = null } = {}) => {
  if (Object.hasOwn(manifest, 'artifactSurfaceVersion')) assertCurrentIndexFormat({ operation: 'write',
    component: 'incremental manifest', foundVersion: manifest.artifactSurfaceVersion, repoRoot, indexPath });
  const { files = {}, dependencyTable: unused, ...metadata } = manifest;
  void unused;
  const dependencies = [], dependencyIds = new Map(), encodedEntries = [];
  let bytes = 0;
  const append = part => {
    bytes += Buffer.byteLength(part);
    if (bytes > INCREMENTAL_MANIFEST_MAX_BYTES) throw capacity();
    encodedEntries.push(part);
  };
  for (const [rawKey, value] of Object.entries(files)) {
    const key = canonicalBundleSourceKey(rawKey);
    if (key !== rawKey) throw new TypeError('Manifest source keys must already be canonical.');
    const { dependencySignatures = null, ...entry } = value;
    const dependencyJson = JSON.stringify(canonicalizeBundlePayloadForChecksum(dependencySignatures));
    let id = dependencyIds.get(dependencyJson);
    if (id == null) {
      id = dependencies.length; dependencyIds.set(dependencyJson, id);
      dependencies.push(dependencySignatures);
    }
    append((encodedEntries.length ? ',' : '') + JSON.stringify(key) + ':' + JSON.stringify({ ...entry, dependencyId: id }));
  }
  const head = JSON.stringify({ ...metadata, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    version: INCREMENTAL_MANIFEST_VERSION, dependencyTable: dependencies });
  const prefix = head.slice(0, -1) + ',"files":{';
  if (bytes + Buffer.byteLength(prefix) + 2 > INCREMENTAL_MANIFEST_MAX_BYTES) throw capacity();
  return prefix + encodedEntries.join('') + '}}';
};

/** Explicit cutover: previous layouts are unsupported, never silently decoded. */
export const decodeIncrementalManifest = (raw, { repoRoot = process.cwd(), indexPath = null } = {}) => {
  assertCurrentIndexFormat({ operation: 'resume', component: 'incremental manifest', foundVersion: raw?.artifactSurfaceVersion, repoRoot, indexPath });
  assertCurrentIndexFormat({ operation: 'resume', component: 'incremental manifest schema',
    foundVersion: raw?.version, expectedVersion: INCREMENTAL_MANIFEST_VERSION, repoRoot, indexPath });
  if (!Array.isArray(raw.dependencyTable) || !raw.files || typeof raw.files !== 'object' || Array.isArray(raw.files)) {
    throw new TypeError('Invalid compact incremental manifest.');
  }
  const files = {};
  for (const [key, value] of Object.entries(raw.files)) {
    if (canonicalBundleSourceKey(key) !== key || !Number.isSafeInteger(value?.dependencyId)
      || value.dependencyId < 0 || value.dependencyId >= raw.dependencyTable.length) throw new TypeError('Invalid manifest dependency reference.');
    const { dependencyId, ...entry } = value;
    Object.defineProperty(files, key, { value: { ...entry, dependencySignatures: raw.dependencyTable[dependencyId] }, enumerable: true, configurable: true, writable: true });
  }
  const { dependencyTable, ...metadata } = raw;
  void dependencyTable;
  return { ...metadata, files };
};

export const persistIncrementalManifest = async (filename, manifest) => {
  const text = encodeIncrementalManifest(manifest, { indexPath: filename });
  await atomicWriteText(filename, text, { newline: false });
  return true;
};
