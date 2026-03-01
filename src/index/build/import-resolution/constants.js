export const DEFAULT_IMPORT_EXTS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.d.ts'
];

export const MAX_IMPORT_WARNINGS = 200;
export const MAX_GRAPH_EDGES = 200000;
export const MAX_GRAPH_NODES = 100000;
export const NEGATIVE_CACHE_TTL_MS = 60000;
export const EPHEMERAL_EXTERNAL_CACHE_TTL_MS = 15000;
export const IMPORT_LOOKUP_CACHE_SCHEMA_VERSION = 1;
export const FS_META_PREFETCH_CONCURRENCY = 32;
export const FS_META_TRANSIENT_ERROR_CODES = new Set(['EAGAIN', 'EMFILE', 'ENFILE']);
export const MAX_RESOLUTION_CACHE_ENTRIES = 200000;
