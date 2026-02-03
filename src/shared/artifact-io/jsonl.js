import { toJsonTooLargeError } from './limits.js';

const formatJsonlPreview = (value, limit = 160) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}...`;
};

const JSONL_REQUIRED_KEYS = Object.freeze({
  chunk_meta: ['id', 'start', 'end'],
  vfs_manifest: [
    'schemaVersion',
    'virtualPath',
    'docHash',
    'containerPath',
    'containerExt',
    'containerLanguageId',
    'languageId',
    'effectiveExt',
    'segmentUid',
    'segmentStart',
    'segmentEnd'
  ],
  vfs_path_map: [
    'schemaVersion',
    'virtualPath',
    'hashVirtualPath',
    'containerPath',
    'segmentUid',
    'segmentStart',
    'segmentEnd',
    'effectiveExt',
    'languageId',
    'docHash'
  ],
  vfs_manifest_index: [
    'schemaVersion',
    'virtualPath',
    'offset',
    'bytes'
  ],
  repo_map: ['file', 'name'],
  file_relations: ['file', 'relations'],
  symbols: ['v', 'symbolId', 'scopedId', 'symbolKey', 'qualifiedName', 'kindGroup', 'file', 'virtualPath', 'chunkUid'],
  symbol_occurrences: ['v', 'host', 'role', 'ref'],
  symbol_edges: ['v', 'type', 'from', 'to'],
  call_sites: ['callSiteId', 'callerChunkUid', 'file', 'startLine', 'startCol', 'endLine', 'endCol', 'calleeRaw', 'calleeNormalized', 'args'],
  risk_summaries: ['schemaVersion', 'chunkUid', 'file', 'signals'],
  risk_flows: ['schemaVersion', 'flowId', 'source', 'sink', 'path', 'confidence', 'notes'],
  graph_relations: ['graph', 'node']
});

export const resolveJsonlRequiredKeys = (baseName) => {
  const keys = JSONL_REQUIRED_KEYS[baseName];
  return Array.isArray(keys) && keys.length ? keys : null;
};

const toJsonlError = (filePath, lineNumber, line, detail) => {
  const preview = formatJsonlPreview(line);
  const suffix = preview ? ` Preview: ${preview}` : '';
  const err = new Error(
    `Invalid JSONL at ${filePath}:${lineNumber}: ${detail}.${suffix}`
  );
  err.code = 'ERR_JSONL_INVALID';
  return err;
};

export const parseJsonlLine = (line, targetPath, lineNumber, maxBytes, requiredKeys = null) => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const byteLength = Buffer.byteLength(trimmed, 'utf8');
  if (byteLength > maxBytes) {
    throw toJsonTooLargeError(targetPath, byteLength);
  }
  const firstChar = trimmed[0];
  if (firstChar === '[' || firstChar === ']') {
    throw toJsonlError(targetPath, lineNumber, trimmed, 'JSON array fragments are not valid JSONL entries');
  }
  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw toJsonlError(targetPath, lineNumber, trimmed, err?.message || 'JSON parse error');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw toJsonlError(targetPath, lineNumber, trimmed, 'JSONL entries must be objects');
  }
  if (Array.isArray(requiredKeys) && requiredKeys.length) {
    const missingKeys = requiredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(parsed, key));
    if (missingKeys.length) {
      throw toJsonlError(
        targetPath,
        lineNumber,
        trimmed,
        `Missing required keys: ${missingKeys.join(', ')}`
      );
    }
  }
  return parsed;
};
