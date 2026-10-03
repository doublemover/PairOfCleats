import { Packr } from 'msgpackr';
import { writeJsonObjectFile } from '../json-stream/json-writers.js';
import { atomicWriteText } from '../io/atomic-write.js';
import { removePathWithRetry } from '../io/remove-path-with-retry.js';
import {
  BUNDLE_CHECKSUM_SCHEMA_VERSION,
  BUNDLE_FORMAT_TAG,
  BUNDLE_VERSION
} from '../bundle-io-constants.js';
import {
  estimatePayloadBytes,
  normalizeBundlePayload
} from '../bundle-io-checksum.js';
import {
  normalizeBundleFormat,
  resolveBundleJsonChecksumPath
} from '../bundle-io-paths.js';
import {
  clearBundlePatchFile,
  checksumBundlePayload,
  removeFileOrThrow,
  runBundleTransformWorker,
  shouldOffloadBundleTransform,
  writeBundleJsonChecksum
} from './support.js';

const packr = new Packr({ useRecords: false, structuredClone: true });

export async function removeBundleWriteArtifacts(bundlePath) {
  await removeFileOrThrow(bundlePath);
  await removeFileOrThrow(resolveBundleJsonChecksumPath(bundlePath));
  await clearBundlePatchFile(bundlePath);
}

export async function writeBundleFile({ bundlePath, bundle, format = 'json' }) {
  const resolvedFormat = normalizeBundleFormat(format);
  if (resolvedFormat === 'msgpack') {
    const bundleEstimate = estimatePayloadBytes(bundle);
    let normalized = null;
    let checksum = null;
    if (shouldOffloadBundleTransform(bundleEstimate)) {
      const workerResult = await runBundleTransformWorker({
        operation: 'normalize-checksum',
        payload: { bundle }
      });
      if (workerResult.ok && workerResult.result) {
        normalized = workerResult.result.normalized;
        checksum = workerResult.result.checksum || null;
      }
    }
    if (!normalized) {
      normalized = normalizeBundlePayload(bundle);
      checksum = await checksumBundlePayload(normalized);
    }
    const envelope = {
      format: BUNDLE_FORMAT_TAG,
      version: BUNDLE_VERSION,
      checksum: checksum
        ? {
          schemaVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
          algo: checksum.algo,
          value: checksum.value
        }
        : null,
      payload: normalized
    };
    const encoded = packr.pack(envelope);
    await atomicWriteText(bundlePath, Buffer.from(encoded), { newline: false });
    await clearBundlePatchFile(bundlePath);
    await removePathWithRetry(resolveBundleJsonChecksumPath(bundlePath), {
      recursive: false,
      force: true
    });
    return {
      format: resolvedFormat,
      checksum: checksum?.value ?? null,
      checksumAlgo: checksum?.algo ?? null
    };
  }
  await writeJsonObjectFile(bundlePath, {
    fields: bundle,
    trailingNewline: true,
    atomic: true
  });
  const checksumResult = await writeBundleJsonChecksum(bundlePath, bundle);
  await clearBundlePatchFile(bundlePath);
  return {
    format: resolvedFormat,
    checksum: checksumResult?.checksum ?? null,
    checksumAlgo: checksumResult?.checksumAlgo ?? null
  };
}
