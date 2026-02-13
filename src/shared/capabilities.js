import { tryRequire } from './optional-deps.js';

let cached = null;

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
      pdf: checkCandidates(
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
      ),
      docx: checkCandidates(
        ['mammoth', 'docx'],
        opts,
        { allowEsm: true }
      )
    },
    mcp: {
      sdk: check('@modelcontextprotocol/sdk', opts, { allowEsm: true }),
      legacy: true
    },
    externalBackends: {
      tantivy: check('tantivy', opts),
      lancedb: check('@lancedb/lancedb', opts, { allowEsm: true })
    }
  };
  return cached;
}
