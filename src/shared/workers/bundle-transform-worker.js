import { parentPort } from 'node:worker_threads';
import { MAX_BUNDLE_CHECKSUM_BYTES, BUNDLE_WORKER_MAX_PAYLOAD_BYTES } from '../bundle-contract.js';
import { checksumBundlePayloadLocal, normalizeBundlePayload, estimatePayloadBytes } from '../bundle-io-checksum.js';
import { buildBundlePatchPayload } from '../bundle-patch.js';
import { observeWorkerHeap } from './heap-contract.js';
let busy = false;
parentPort?.on('message', async message => {
  const id = message?.id;
  if (!Number.isSafeInteger(id) || busy) return;
  busy = true; let payload = message.payload, result = null;
  try {
    const heap = observeWorkerHeap();
    if (heap.resourceLimitAcknowledged !== true) throw Object.assign(new Error('Bundle transform worker heap bound was not acknowledged.'), { code: 'BUNDLE_WORKER_HEAP_UNACKNOWLEDGED' });
    if (message.operation === 'normalize-checksum' || message.operation === 'checksum-only') {
      const normalized = normalizeBundlePayload(payload?.bundle ?? null);
      const checksum = await checksumBundlePayloadLocal(normalized, { maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES });
      result = message.operation === 'checksum-only' ? { checksum } : { normalized, checksum };
    } else if (message.operation === 'build-patch') result = buildBundlePatchPayload({ previousBundle: payload?.previousBundle ?? null, nextBundle: payload?.nextBundle ?? null });
    else throw new Error(`Unsupported bundle worker operation: ${message.operation}`);
    const resultBytes = result === null ? 0 : estimatePayloadBytes(result);
    if (resultBytes > BUNDLE_WORKER_MAX_PAYLOAD_BYTES) throw new Error('Bundle transform result exceeds its byte allowance.');
    parentPort.postMessage({ id, ok: true, result, resultBytes });
  } catch (error) { parentPort.postMessage({ id, ok: false, error: error?.message || String(error), code: error?.code || null }); }
  finally { payload = null; result = null; busy = false; }
});
