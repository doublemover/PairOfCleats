import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { normalizeBundleSourceKeys } from '../bundle-source-key.js';
import { runOwnedBundleTransform } from './transform-owner.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { removePathWithRetry } from '../io/remove-path-with-retry.js';
import { canonicalizeBundlePayloadForChecksum } from '../bundle-checksum.js';
import {
  BUNDLE_CHECKSUM_SCHEMA_VERSION,
  BUNDLE_FORMAT_TAG,
  BUNDLE_VERSION
} from '../bundle-io-constants.js';
import {
  checksumBundlePayloadLocal,
  estimatePayloadBytes
} from '../bundle-io-checksum.js';
import {
  resolveBundleJsonChecksumPath,
  resolveBundlePatchMetaPath,
  resolveBundlePatchPath
} from '../bundle-io-paths.js';
import {
  MAX_BUNDLE_CHECKSUM_BYTES,
  BUNDLE_WORKER_OFFLOAD_THRESHOLD_BYTES,
  BUNDLE_WORKER_MAX_PAYLOAD_BYTES
} from '../bundle-contract.js';

export const isPlainObject = (value) => !!value && typeof value === 'object' && value.constructor === Object;
export const shouldOffloadBundleTransform = payloadBytes => Number.isFinite(payloadBytes)
  && payloadBytes >= BUNDLE_WORKER_OFFLOAD_THRESHOLD_BYTES && payloadBytes <= BUNDLE_WORKER_MAX_PAYLOAD_BYTES;
export const runBundleTransformWorker = runOwnedBundleTransform;

export const checksumBundlePayload = async (payload) => {
  const estimate = estimatePayloadBytes(payload);
  if (estimate && estimate > MAX_BUNDLE_CHECKSUM_BYTES) return null;
  if (shouldOffloadBundleTransform(estimate)) {
    const workerResult = await runBundleTransformWorker({
      operation: 'checksum-only',
      payload: { bundle: payload }
    });
    if (workerResult.ok) {
      const checksum = workerResult.result?.checksum;
      if (checksum && typeof checksum === 'object') return checksum;
    }
  }
  return checksumBundlePayloadLocal(payload, {
    maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES
  });
};

export const removeFileOrThrow = async (targetPath) => {
  const removed = await removePathWithRetry(targetPath, {
    recursive: false,
    force: true
  });
  if (removed.ok) return;
  throw removed.error || new Error(`Failed to remove path: ${targetPath}`);
};

export const clearBundlePatchFile = async (bundlePath) => {
  await removeFileOrThrow(resolveBundlePatchPath(bundlePath));
  await removeFileOrThrow(resolveBundlePatchMetaPath(bundlePath));
};

export const writeBundleJsonChecksum = async (bundlePath, bundle) => {
  const normalized = canonicalizeBundlePayloadForChecksum(bundle, { typedArraysBeforeToJSON: true });
  const checksum = await checksumBundlePayload(normalized);
  if (!checksum || !checksum.value || !checksum.algo) {
    await removeFileOrThrow(resolveBundleJsonChecksumPath(bundlePath));
    return { checksum: null, checksumAlgo: null };
  }
  await atomicWriteJson(resolveBundleJsonChecksumPath(bundlePath), {
    format: BUNDLE_FORMAT_TAG,
    version: BUNDLE_VERSION,
    checksumSchemaVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
    checksum: {
      schemaVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
      algo: checksum.algo,
      value: checksum.value
    }
  }, {
    spaces: 0,
    newline: false
  });
  return {
    checksum: checksum.value,
    checksumAlgo: checksum.algo
  };
};

/** Stamp new payloads consistently before serialization, patching and checksumming. */
export const normalizeBundleWriteIdentity = (bundle, bundlePath) => {
  if (Object.hasOwn(bundle, 'artifactSurfaceVersion')) assertCurrentIndexFormat({
    operation: 'write', component: 'bundle payload', foundVersion: bundle.artifactSurfaceVersion,
    repoRoot: process.cwd(), indexPath: bundlePath
  });
  return normalizeBundleSourceKeys({ ...bundle, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
};
