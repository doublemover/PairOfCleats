import { tryRequire } from './optional-deps.js';
import { getNativeAccelCapabilities } from './native-accel.js';

let cached = null;

/**
 * Stable defaults used when capability providers are missing or when we skip probing.
 * Fields remain frozen so downstream code can rely on referential equality while merging.
 */
export const CAPABILITY_DEFAULTS = Object.freeze({
  watcher: Object.freeze({
    chokidar: false,
    parcel: false
  }),
  regex: Object.freeze({
    re2: false,
    re2js: false
  }),
  hash: Object.freeze({
    nodeRsXxhash: false,
    wasmXxhash: false
  }),
  compression: Object.freeze({
    gzip: true,
    zstd: false
  }),
  extractors: Object.freeze({
    pdf: false,
    docx: false
  }),
  mcp: Object.freeze({
    sdk: false,
    legacy: true
  }),
  externalBackends: Object.freeze({
    tantivy: false,
    lancedb: false
  }),
  nativeAccel: Object.freeze({
    enabled: false,
    runtimeKind: 'js',
    abiVersion: 1,
    featureBits: 0
  })
});

const check = (name, options, { allowEsm = false } = {}) => {
  const result = tryRequire(name, options);
  if (result.ok) return true;
  return allowEsm && result.reason === 'unsupported';
};

const checkCandidates = (candidates, options, {
  allowEsm = false,
  validate = null
} = {}) => {
  for (const name of candidates || []) {
    const result = tryRequire(name, options);
    if (result.ok) {
      if (typeof validate === 'function') {
        const mod = result.mod?.default || result.mod;
        if (validate(mod)) return true;
        continue;
      }
      return true;
    }
    if (allowEsm && result.reason === 'unsupported') return true;
  }
  return false;
};

/**
 * Probe optional runtime capabilities once and cache the result unless `refresh` is requested.
 * @param {{refresh?:boolean,verbose?:boolean,logger?:object}} [options]
 * @returns {object}
 */
export function getCapabilities(options = {}) {
  if (cached && options.refresh !== true) return cached;
  const opts = {
    verbose: options.verbose === true,
    logger: options.logger
  };
  const defaults = CAPABILITY_DEFAULTS;
  cached = {
    watcher: {
      chokidar: defaults.watcher.chokidar,
      parcel: defaults.watcher.parcel
    },
    regex: {
      re2: defaults.regex.re2,
      re2js: defaults.regex.re2js
    },
    hash: {
      nodeRsXxhash: defaults.hash.nodeRsXxhash,
      wasmXxhash: defaults.hash.wasmXxhash
    },
    compression: {
      gzip: defaults.compression.gzip,
      zstd: defaults.compression.zstd
    },
    extractors: {
      pdf: defaults.extractors.pdf,
      docx: defaults.extractors.docx
    },
    mcp: {
      sdk: defaults.mcp.sdk,
      legacy: defaults.mcp.legacy
    },
    externalBackends: {
      tantivy: defaults.externalBackends.tantivy,
      lancedb: defaults.externalBackends.lancedb
    },
    nativeAccel: {
      enabled: defaults.nativeAccel.enabled,
      runtimeKind: defaults.nativeAccel.runtimeKind,
      abiVersion: defaults.nativeAccel.abiVersion,
      featureBits: defaults.nativeAccel.featureBits
    }
  };
  cached.watcher.chokidar = check('chokidar', opts);
  cached.watcher.parcel = check('@parcel/watcher', opts);
  cached.regex.re2 = check('re2', opts);
  cached.regex.re2js = check('re2js', opts);
  cached.hash.nodeRsXxhash = check('@node-rs/xxhash', opts);
  cached.hash.wasmXxhash = check('xxhash-wasm', opts);
  cached.compression.zstd = check('@mongodb-js/zstd', opts);
  cached.extractors.pdf = checkCandidates(
    [
      'pdfjs-dist/legacy/build/pdf.js',
      'pdfjs-dist/legacy/build/pdf.mjs',
      'pdfjs-dist/build/pdf.js',
      'pdfjs-dist'
    ],
    opts,
    {
      allowEsm: true,
      validate: (mod) => typeof mod?.getDocument === 'function'
    }
  );
  cached.extractors.docx = checkCandidates(
    ['mammoth', 'docx'],
    opts,
    { allowEsm: true }
  );
  cached.mcp.sdk = check('@modelcontextprotocol/sdk', opts, { allowEsm: true });
  cached.externalBackends.tantivy = check('tantivy', opts);
  cached.externalBackends.lancedb = check('@lancedb/lancedb', opts, { allowEsm: true });
  const nativeAccel = getNativeAccelCapabilities();
  cached.nativeAccel.enabled = nativeAccel.enabled === true;
  cached.nativeAccel.runtimeKind = String(nativeAccel.runtimeKind || 'js');
  cached.nativeAccel.abiVersion = Number.isFinite(nativeAccel.abiVersion)
    ? nativeAccel.abiVersion
    : defaults.nativeAccel.abiVersion;
  cached.nativeAccel.featureBits = Number.isFinite(nativeAccel.featureBits)
    ? nativeAccel.featureBits
    : defaults.nativeAccel.featureBits;
  return cached;
}
