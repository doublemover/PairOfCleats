export const BUNDLE_FORMAT_TAG = 'pairofcleats.bundle';
export const BUNDLE_VERSION = 1;
export const MSGPACK_EXTENSIONS = new Set(['.mpk', '.msgpack', '.msgpackr']);
export const BUNDLE_PATCH_FORMAT_TAG = 'pairofcleats.bundle.patch';
export const BUNDLE_PATCH_VERSION = 1;
export const BUNDLE_PATCH_FIELD_KEYS = [
  'file',
  'hash',
  'mtimeMs',
  'size',
  'fileRelations',
  'vfsManifestRows',
  'encoding',
  'encodingFallback',
  'encodingConfidence'
];
export const BUNDLE_PATCH_SUFFIX = '.patch.jsonl';
export const BUNDLE_PATCH_LOCK_SUFFIX = '.lock';
export const BUNDLE_PATCH_META_SUFFIX = '.meta.json';
export const BUNDLE_JSON_CHECKSUM_SUFFIX = '.checksum.json';
export const BUNDLE_CHECKSUM_SCHEMA_VERSION = 2;
export const BUNDLE_WORKER_TIMEOUT_MS = 15000;
export const BUNDLE_WORKER_TERMINATE_TIMEOUT_MS = 5000;
export const BUNDLE_WORKER_MAX_TERMINATE_FAILURES = 3;
