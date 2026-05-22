import { parentPort, workerData } from 'node:worker_threads';
import { MAX_BUNDLE_CHECKSUM_BYTES } from '../bundle-contract.js';
import {
  checksumBundlePayloadLocal,
  normalizeBundlePayload
} from '../bundle-io-checksum.js';
import { buildBundlePatchPayload } from '../bundle-patch.js';

const runNormalizeChecksum = async (payload) => {
  const normalized = normalizeBundlePayload(payload?.bundle ?? null);
  const checksum = await checksumBundlePayloadLocal(normalized, {
    maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES
  });
  return { normalized, checksum };
};

const runBuildPatch = (payload) => buildBundlePatchPayload({
  previousBundle: payload?.previousBundle ?? null,
  nextBundle: payload?.nextBundle ?? null
});

const main = async () => {
  try {
    const operation = typeof workerData?.operation === 'string'
      ? workerData.operation
      : '';
    let result = null;
    if (operation === 'normalize-checksum') {
      result = await runNormalizeChecksum(workerData.payload || {});
    } else if (operation === 'build-patch') {
      result = runBuildPatch(workerData.payload || {});
    } else {
      throw new Error(`unsupported bundle worker operation: ${operation || 'unknown'}`);
    }
    parentPort?.postMessage({ ok: true, result });
  } catch (err) {
    parentPort?.postMessage({
      ok: false,
      error: err?.message || String(err)
    });
  }
};

await main();
