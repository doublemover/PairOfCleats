import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { atomicWriteJson } from '../io/atomic-write.js';
import { removePathWithRetry } from '../io/remove-path-with-retry.js';
import { createTimeoutError, runWithTimeout } from '../promise-timeout.js';
import {
  BUNDLE_CHECKSUM_SCHEMA_VERSION,
  BUNDLE_FORMAT_TAG,
  BUNDLE_VERSION,
  BUNDLE_WORKER_MAX_TERMINATE_FAILURES,
  BUNDLE_WORKER_TERMINATE_TIMEOUT_MS,
  BUNDLE_WORKER_TIMEOUT_MS
} from '../bundle-io-constants.js';
import {
  checksumBundlePayloadLocal,
  estimatePayloadBytes,
  normalizeBundlePayload
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

const bundleTransformWorkerUrl = new URL('../workers/bundle-transform-worker.js', import.meta.url);
let bundleTransformWorkerTerminateFailures = 0;
let bundleTransformWorkerDisabled = false;

export const isPlainObject = (value) => !!value && typeof value === 'object' && value.constructor === Object;

export const shouldOffloadBundleTransform = (payloadBytes) => Number.isFinite(payloadBytes)
  && !bundleTransformWorkerDisabled
  && payloadBytes >= BUNDLE_WORKER_OFFLOAD_THRESHOLD_BYTES
  && payloadBytes <= BUNDLE_WORKER_MAX_PAYLOAD_BYTES;

export const runBundleTransformWorker = ({ operation, payload, timeoutMs = BUNDLE_WORKER_TIMEOUT_MS }) => (
  new Promise((resolve) => {
    const worker = new Worker(bundleTransformWorkerUrl, {
      workerData: { operation, payload },
      type: 'module'
    });
    let settled = false;
    const terminateWorker = async () => {
      try {
        await runWithTimeout(
          () => Promise.resolve(worker.terminate()),
          {
            timeoutMs: BUNDLE_WORKER_TERMINATE_TIMEOUT_MS,
            errorFactory: () => createTimeoutError({
              message: `bundle worker terminate timed out after ${BUNDLE_WORKER_TERMINATE_TIMEOUT_MS}ms`,
              code: 'BUNDLE_WORKER_TERMINATE_TIMEOUT',
              retryable: false
            })
          }
        );
        bundleTransformWorkerTerminateFailures = 0;
      } catch {
        bundleTransformWorkerTerminateFailures += 1;
        if (bundleTransformWorkerTerminateFailures >= BUNDLE_WORKER_MAX_TERMINATE_FAILURES) {
          bundleTransformWorkerDisabled = true;
        }
      }
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      void terminateWorker();
    };
    const timer = setTimeout(() => {
      settle({ ok: false, reason: 'timeout' });
    }, Math.max(500, Math.floor(Number(timeoutMs) || BUNDLE_WORKER_TIMEOUT_MS)));
    timer.unref?.();
    worker.once('message', (message) => {
      if (message?.ok === true) {
        settle({ ok: true, result: message.result });
        return;
      }
      settle({ ok: false, reason: message?.error || 'worker-error' });
    });
    worker.once('error', (err) => {
      settle({ ok: false, reason: err?.message || String(err) });
    });
    worker.once('exit', (code) => {
      if (settled) return;
      if (code === 0) {
        settle({ ok: false, reason: 'missing-worker-result' });
        return;
      }
      settle({ ok: false, reason: `worker-exit-${code}` });
    });
  })
);

export const checksumBundlePayload = async (payload) => {
  const estimate = estimatePayloadBytes(payload);
  if (estimate && estimate > MAX_BUNDLE_CHECKSUM_BYTES) return null;
  if (shouldOffloadBundleTransform(estimate)) {
    const workerResult = await runBundleTransformWorker({
      operation: 'normalize-checksum',
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
  const normalized = normalizeBundlePayload(bundle);
  const checksum = await checksumBundlePayload(normalized);
  if (!checksum || !checksum.value || !checksum.algo) {
    try {
      await fs.rm(resolveBundleJsonChecksumPath(bundlePath), { force: true });
    } catch {}
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
