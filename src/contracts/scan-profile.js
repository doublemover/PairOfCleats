export const SCAN_PROFILE_SCHEMA_VERSION = 2;
export const SCAN_PROFILE_COVERAGE_VERSION = 1;
export const SCAN_PROFILE_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);
export const SCAN_PROFILE_COUNTER_KEYS = Object.freeze(['files.candidates', 'files.scanned', 'files.skipped',
  'chunks', 'tokens', 'lines', 'bytes.source', 'bytes.artifact', 'durationMs']);
export const SCAN_PROFILE_RATE_KEYS = Object.freeze(['filesPerSec', 'chunksPerSec', 'tokensPerSec', 'bytesPerSec', 'linesPerSec']);
export const isSupportedScanProfileVersion = version => version === 1 || version === SCAN_PROFILE_SCHEMA_VERSION;
