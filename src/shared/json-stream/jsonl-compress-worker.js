import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { gzipSync } from 'fflate';

if (!parentPort) {
  throw new Error('jsonl compress worker: missing parent port');
}

let compression = null;
let gzipOptions = null;
let zstdLevel = 3;
let zstd = null;
let initError = null;

const toBuffer = (value) => {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value);
};

const handleInit = (msg) => {
  compression = msg?.compression || null;
  gzipOptions = msg?.gzipOptions || null;
  const rawLevel = msg?.zstdLevel;
  zstdLevel = Number.isFinite(Number(rawLevel)) ? Math.floor(Number(rawLevel)) : 3;
  if (compression === 'zstd') {
    try {
      const require = createRequire(import.meta.url);
      zstd = require('@mongodb-js/zstd');
    } catch (err) {
      initError = err;
    }
  }
};

const compressPayload = async (payload) => {
  const buffer = toBuffer(payload);
  if (compression === 'zstd') {
    const compressed = await zstd.compress(buffer, zstdLevel);
    return compressed;
  }
  if (compression === 'gzip') {
    return gzipSync(buffer, gzipOptions || undefined);
  }
  return buffer;
};

parentPort.on('message', (msg) => {
  if (msg?.type === 'init') {
    handleInit(msg);
    return;
  }
  const id = msg?.id;
  if (!Number.isFinite(Number(id))) return;
  if (initError) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        message: initError.message || String(initError),
        code: initError.code,
        name: initError.name
      }
    });
    return;
  }
  Promise.resolve()
    .then(async () => compressPayload(msg.payload))
    .then((compressed) => {
      if (!compressed) {
        parentPort.postMessage({ id, ok: true, payload: new Uint8Array(0) });
        return;
      }
      const payload = compressed;
      parentPort.postMessage({ id, ok: true, payload }, [payload.buffer]);
    })
    .catch((err) => {
      parentPort.postMessage({
        id,
        ok: false,
        error: {
          message: err?.message || String(err),
          code: err?.code,
          name: err?.name
        }
      });
    });
});
