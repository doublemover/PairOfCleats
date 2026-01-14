import fs from 'node:fs';
import xxhashWasm from 'xxhash-wasm';
import { tryRequire } from '../optional-deps.js';

const XXHASH_HEX_WIDTH = 16;
let wasmStatePromise = null;
let wasmBackendPromise = null;

const loadWasmState = async () => {
  if (!wasmStatePromise) {
    wasmStatePromise = xxhashWasm();
  }
  return wasmStatePromise;
};

export const formatXxhashHex = (value) => {
  if (typeof value === 'bigint') {
    return value.toString(16).padStart(XXHASH_HEX_WIDTH, '0');
  }
  if (typeof value === 'number') {
    return Math.floor(value).toString(16).padStart(XXHASH_HEX_WIDTH, '0');
  }
  if (typeof value === 'string') {
    const trimmed = value.startsWith('0x') ? value.slice(2) : value;
    return trimmed.padStart(XXHASH_HEX_WIDTH, '0');
  }
  return '';
};

const createWasmBackend = async () => {
  if (wasmBackendPromise) return wasmBackendPromise;
  wasmBackendPromise = (async () => {
    const { h64ToString, create64 } = await loadWasmState();
    return {
      name: 'wasm',
      hash64: async (input) => formatXxhashHex(h64ToString(input)),
      hash64Stream: async (stream) => new Promise((resolve, reject) => {
        const hasher = create64();
        stream.on('error', reject);
        stream.on('data', (chunk) => hasher.update(chunk));
        stream.on('end', () => resolve(formatXxhashHex(hasher.digest())));
      })
    };
  })();
  return wasmBackendPromise;
};

const resolveNativeFns = (mod) => {
  const hash64 = mod?.xxh64 || mod?.xxhash64 || mod?.hash64 || mod?.xxh64Raw;
  const create64 = mod?.createXXHash64 || mod?.createXxh64 || mod?.createHash64 || mod?.create64;
  return { hash64, create64 };
};

const createNativeBackend = async (options = {}) => {
  const result = tryRequire('@node-rs/xxhash', options);
  if (!result.ok || !result.mod) return null;
  const { hash64, create64 } = resolveNativeFns(result.mod);
  if (typeof hash64 !== 'function') return null;
  const base = {
    name: 'native',
    hash64: async (input) => formatXxhashHex(hash64(input))
  };
  if (typeof create64 === 'function') {
    return {
      ...base,
      hash64Stream: async (stream) => new Promise((resolve, reject) => {
        const hasher = create64();
        stream.on('error', reject);
        stream.on('data', (chunk) => hasher.update(chunk));
        stream.on('end', () => resolve(formatXxhashHex(hasher.digest())));
      })
    };
  }
  const wasmBackend = await createWasmBackend();
  return {
    ...base,
    hash64Stream: wasmBackend.hash64Stream
  };
};

const maybeLogFallback = (message, options = {}) => {
  if (!options?.verbose && options?.verbose !== true) return;
  const logger = typeof options.logger === 'function' ? options.logger : console.warn;
  logger(`[hash] ${message}`);
};

export const resolveXxhashBackend = async ({ backend = 'auto', logger, verbose } = {}) => {
  const normalized = typeof backend === 'string' ? backend.trim().toLowerCase() : 'auto';
  const options = { logger, verbose };
  if (normalized === 'native') {
    const nativeBackend = await createNativeBackend(options);
    if (nativeBackend) return nativeBackend;
    maybeLogFallback('Native xxhash unavailable; falling back to wasm.', options);
    return createWasmBackend();
  }
  if (normalized === 'wasm') {
    return createWasmBackend();
  }
  const nativeBackend = await createNativeBackend(options);
  if (nativeBackend) return nativeBackend;
  return createWasmBackend();
};

export const hash64Stream = (stream, backend) => backend.hash64Stream(stream);

export const hashFileStream = (filePath) => fs.createReadStream(filePath);
