import { writeParseCheckpointDescriptor } from './parse-checkpoint-descriptor.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { readBundleFile } from '../../../shared/bundle-io.js';
import { normalizeBundleFormat, resolveManifestBundleNames } from '../../../shared/bundle-io-paths.js';
import { canonicalizeBundlePayloadForChecksum } from '../../../shared/bundle-checksum.js';
import { canonicalBundleSourceKey, normalizeBundleSourceKeys } from '../../../shared/bundle-source-key.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { writeAccountedBundle } from './accounted-bundle.js';
import { admitDocumentExtractionReceipt } from '../../extractors/receipt.js';

const digest = (bundle, format) => createHash('sha256').update(JSON.stringify(
  canonicalizeBundlePayloadForChecksum(bundle, { typedArraysBeforeToJSON: format === 'json' })
)).digest('hex');
const same = (left, right) => JSON.stringify(canonicalizeBundlePayloadForChecksum(left ?? null))
  === JSON.stringify(canonicalizeBundlePayloadForChecksum(right ?? null));
const snapshotPattern = /^(resume|snapshot)-([a-f0-9]{64})\.(json|mpk)$/;

/** Shared per-shard authority check for index replay and ordered SQLite decode.
 * A shard's own checksum cannot substitute for its selected manifest identity. */
export const validateIncrementalBundleShardAuthority = ({ relKey, sourceHash, sourceSize,
  dependencySignatures, bundleName, part, index, count, format, bundle }) => {
  const match = snapshotPattern.exec(bundleName || '');
  const resolved = normalizeBundleFormat(format);
  if (!match || path.basename(bundleName) !== bundleName || part?.name !== bundleName
    || part.index !== index || part.count !== count || part.hash !== match[2]
    || (resolved === 'json' ? 'json' : 'mpk') !== match[3]) return false;
  return canonicalBundleSourceKey(bundle?.file) === canonicalBundleSourceKey(relKey)
    && bundle.hash === sourceHash && bundle.size === sourceSize
    && same(bundle.dependencySignatures, dependencySignatures)
    && bundle.bundleShardIndex === index && bundle.bundleShardCount === count
    && digest(bundle, resolved) === part.hash;
};

/** Admit all shards against one selected manifest entry, never just their own checksum. */
export const readIncrementalBundleSnapshot = async ({ repoRoot = process.cwd(), bundleDir,
  relKey, entry, fallbackFormat = 'json', signal = null }) => {
  throwIfAborted(signal);
  try {
    const file = canonicalBundleSourceKey(relKey);
    const names = resolveManifestBundleNames(entry);
    const inventory = entry?.bundleInventory;
    if (!names.length || !Array.isArray(inventory) || inventory.length !== names.length
      || new Set(names).size !== names.length) return null;
    const shards = [];
    for (let index = 0; index < names.length; index++) {
      throwIfAborted(signal);
      const name = names[index], part = inventory[index], match = snapshotPattern.exec(name);
      if (!match || path.basename(name) !== name || part?.name !== name || part.index !== index
        || part.count !== names.length || part.hash !== match[2]) return null;
      const format = normalizeBundleFormat(entry.bundleFormat || fallbackFormat);
      if ((format === 'json' ? 'json' : 'mpk') !== match[3]) return null;
      const filename = path.join(bundleDir, name);
      const result = await readBundleFile(filename, { format, repoRoot });
      if (!result.ok) return null;
      const bundle = result.bundle;
      if (!validateIncrementalBundleShardAuthority({ relKey: file, sourceHash: entry.hash, sourceSize: entry.size,
        dependencySignatures: entry.dependencySignatures, bundleName: name, part, index,
        count: names.length, format, bundle })) return null;
      if (bundle.documentExtraction && (index !== 0 || !admitDocumentExtractionReceipt({
        receipt: bundle.documentExtraction, sourceHash: entry.hash, sourceSize: entry.size
      }))) return null;
      shards.push({ bundleName: name, bundlePath: filename, bundleFormat: format, bundle });
    }
    const first = shards[0].bundle;
    return { bundle: { ...first, chunks: shards.flatMap(shard => shard.bundle.chunks) }, shards };
  } catch (error) {
    throwIfAborted(signal);
    if (error.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    return null;
  }
};

/** Write a complete immutable replacement; the caller publishes its manifest last. */
export const writeIncrementalBundleSnapshot = async ({ repoRoot = process.cwd(), bundleDir,
  relKey, entry = null, bundles, format = 'json', diskAccount = null, signal = null, stage1 = false }) => {
  const resolvedFormat = normalizeBundleFormat(format);
  const file = canonicalBundleSourceKey(relKey);
  if (!Array.isArray(bundles) || !bundles.length) throw new TypeError('Complete bundle shards required.');
  await fs.mkdir(bundleDir, { recursive: true });
  const names = [], inventory = [];
  let checksum = null;
  for (let index = 0; index < bundles.length; index++) {
    throwIfAborted(signal);
    const bundle = normalizeBundleSourceKeys({ ...bundles[index], file,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleShardIndex: index, bundleShardCount: bundles.length });
    if (bundle.documentExtraction && (index !== 0 || !admitDocumentExtractionReceipt({
      receipt: bundle.documentExtraction, sourceHash: bundle.hash, sourceSize: bundle.size
    }))) throw new TypeError('Invalid document extraction receipt in bundle publication.');
    if (entry && (bundle.hash !== entry.hash || !same(bundle.dependencySignatures, entry.dependencySignatures))) {
      throw new TypeError('Replacement bundle differs from its selected source/dependency snapshot.');
    }
    const hash = digest(bundle, resolvedFormat);
    const name = (stage1 ? 'resume-' : 'snapshot-') + hash + (resolvedFormat === 'json' ? '.json' : '.mpk');
    const filename = path.join(bundleDir, name);
    let exists = false;
    try {
      await fs.access(filename);
      const result = await readBundleFile(filename, { format: resolvedFormat, repoRoot });
      if (!result.ok || digest(result.bundle, resolvedFormat) !== hash) {
        throw Object.assign(new Error('Immutable bundle snapshot differs from its content identity.'), { code: 'ERR_INCREMENTAL_BUNDLE_INTEGRITY' });
      }
      exists = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) {
      const result = await writeAccountedBundle({ bundlePath: filename, bundle, format: resolvedFormat, diskAccount });
      if (index === 0 && result?.checksum) checksum = (result.checksumAlgo ? result.checksumAlgo + ':' : '') + result.checksum;
    }
    names.push(name); inventory.push({ name, hash, index, count: bundles.length });
  }
  const snapshot = { bundles: names, bundleInventory: inventory, bundleFormat: resolvedFormat,
    bundleChecksum: checksum || 'sha256:' + inventory[0].hash };
  const parseCheckpointDescriptor = await writeParseCheckpointDescriptor({ bundleDir, relKey,
    entry: { ...snapshot, hash: bundles[0].hash, dependencySignatures: bundles[0].dependencySignatures },
    checkpoint: bundles[0].parseCheckpoint, diskAccount, signal });
  return { ...snapshot, ...(parseCheckpointDescriptor ? { parseCheckpointDescriptor } : {}) };
};
