import { tryRequire } from './optional-deps.js';

let cached = null;

const check = (name, options, { allowEsm = false } = {}) => {
  const result = tryRequire(name, options);
  if (result.ok) return true;
  return allowEsm && result.reason === 'unsupported';
};

export function getCapabilities(options = {}) {
  if (cached && options.refresh !== true) return cached;
  const opts = {
    verbose: options.verbose === true,
    logger: options.logger
  };
  cached = {
    watcher: {
      chokidar: check('chokidar', opts),
      parcel: check('@parcel/watcher', opts)
    },
    regex: {
      re2: check('re2', opts),
      re2js: check('re2js', opts)
    },
    hash: {
      nodeRsXxhash: check('@node-rs/xxhash', opts),
      wasmXxhash: check('xxhash-wasm', opts)
    },
    compression: {
      gzip: true,
      zstd: check('@mongodb-js/zstd', opts)
    },
    extractors: {
      pdf: check('pdfjs-dist', opts),
      docx: check('mammoth', opts)
    },
    mcp: {
      sdk: check('@modelcontextprotocol/sdk', opts),
      legacy: true
    },
    externalBackends: {
      tantivy: check('tantivy', opts),
      lancedb: check('@lancedb/lancedb', opts, { allowEsm: true })
    }
  };
  return cached;
}
