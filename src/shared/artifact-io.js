import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { getHeapStatistics } from 'node:v8';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tryRequire } from './optional-deps.js';
import { getTestEnvConfig } from './env.js';

const DEFAULT_MAX_JSON_BYTES = (() => {
  const fallback = 128 * 1024 * 1024;
  try {
    const heapLimit = Number(getHeapStatistics()?.heap_size_limit);
    if (!Number.isFinite(heapLimit) || heapLimit <= 0) return fallback;
    const scaled = Math.floor(heapLimit * 0.1);
    const bounded = Math.min(fallback, scaled);
    return Math.max(32 * 1024 * 1024, bounded);
  } catch {
    return fallback;
  }
})();
const testEnv = getTestEnvConfig();
const MAX_JSON_BYTES_TEST_ENV = Number(testEnv?.maxJsonBytes);
export const MAX_JSON_BYTES = Number.isFinite(MAX_JSON_BYTES_TEST_ENV) && MAX_JSON_BYTES_TEST_ENV > 0
  ? Math.floor(MAX_JSON_BYTES_TEST_ENV)
  : DEFAULT_MAX_JSON_BYTES;

const toJsonTooLargeError = (filePath, size) => {
  const err = new Error(
    `JSON artifact too large to load (${size} bytes): ${filePath}`
  );
  err.code = 'ERR_JSON_TOO_LARGE';
  return err;
};

const getBakPath = (filePath) => `${filePath}.bak`;

const cleanupBak = (filePath) => {
  const bakPath = getBakPath(filePath);
  if (!fs.existsSync(bakPath)) return;
  try {
    fs.rmSync(bakPath, { force: true });
  } catch {}
};

const PIECE_CACHE_LIMIT = 8;
const pieceCache = new Map();

const buildCacheKey = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const readCache = (filePath) => {
  const key = buildCacheKey(filePath);
  if (!key) return null;
  const cached = pieceCache.get(key);
  if (!cached) return null;
  pieceCache.delete(key);
  pieceCache.set(key, cached);
  return cached;
};

const writeCache = (filePath, value) => {
  const key = buildCacheKey(filePath);
  if (!key) return;
  if (pieceCache.has(key)) pieceCache.delete(key);
  pieceCache.set(key, value);
  if (pieceCache.size > PIECE_CACHE_LIMIT) {
    const firstKey = pieceCache.keys().next().value;
    if (firstKey) pieceCache.delete(firstKey);
  }
};

const shouldTreatAsTooLarge = (err) => {
  if (!err) return false;
  if (err.code === 'ERR_STRING_TOO_LONG') return true;
  if (err.code === 'ERR_BUFFER_TOO_LARGE' || err.code === 'ERR_OUT_OF_RANGE') return true;
  const message = typeof err.message === 'string' ? err.message : '';
  return message.includes('Invalid string length');
};

const formatJsonlPreview = (value, limit = 160) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}...`;
};

const JSONL_REQUIRED_KEYS = Object.freeze({
  chunk_meta: ['id', 'start', 'end'],
  repo_map: ['file', 'name'],
  file_relations: ['file', 'relations'],
  graph_relations: ['graph', 'node']
});

export const resolveJsonlRequiredKeys = (baseName) => {
  const keys = JSONL_REQUIRED_KEYS[baseName];
  return Array.isArray(keys) && keys.length ? keys : null;
};

const GRAPH_RELATION_GRAPHS = Object.freeze(['callGraph', 'usageGraph', 'importGraph']);

const createGraphPayload = (meta) => ({
  nodeCount: Number.isFinite(meta?.nodeCount) ? meta.nodeCount : null,
  edgeCount: Number.isFinite(meta?.edgeCount) ? meta.edgeCount : null,
  nodes: []
});

const finalizeGraphPayload = (payload) => {
  if (!Number.isFinite(payload.nodeCount)) {
    payload.nodeCount = payload.nodes.length;
  }
  if (!Number.isFinite(payload.edgeCount)) {
    let edgeCount = 0;
    for (const node of payload.nodes) {
      if (Array.isArray(node?.out)) edgeCount += node.out.length;
    }
    payload.edgeCount = edgeCount;
  }
  return payload;
};

const createGraphRelationsShell = (meta) => {
  const extensions = meta && typeof meta.extensions === 'object' ? meta.extensions : {};
  const graphsMeta = extensions?.graphs || meta?.graphs || {};
  const generatedAt = typeof meta?.generatedAt === 'string'
    ? meta.generatedAt
    : new Date().toISOString();
  const version = Number.isFinite(extensions?.version)
    ? extensions.version
    : (Number.isFinite(meta?.version) ? meta.version : 1);
  const payload = {
    version,
    generatedAt,
    callGraph: createGraphPayload(graphsMeta.callGraph),
    usageGraph: createGraphPayload(graphsMeta.usageGraph),
    importGraph: createGraphPayload(graphsMeta.importGraph)
  };
  if (meta?.caps != null) payload.caps = meta.caps;
  return payload;
};

const appendGraphRelationsEntries = (payload, entries, sourceLabel) => {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (!entry) continue;
    const graphName = entry.graph;
    if (!GRAPH_RELATION_GRAPHS.includes(graphName)) {
      const err = new Error(
        `Invalid graph_relations entry in ${sourceLabel}: unknown graph "${graphName}"`
      );
      err.code = 'ERR_JSONL_INVALID';
      throw err;
    }
    const node = entry.node;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      const err = new Error(`Invalid graph_relations entry in ${sourceLabel}: node must be an object`);
      err.code = 'ERR_JSONL_INVALID';
      throw err;
    }
    payload[graphName].nodes.push(node);
  }
};

const finalizeGraphRelations = (payload) => {
  finalizeGraphPayload(payload.callGraph);
  finalizeGraphPayload(payload.usageGraph);
  finalizeGraphPayload(payload.importGraph);
  return payload;
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

const shouldAbortForHeap = (bytes) => {
  try {
    const stats = getHeapStatistics();
    const limit = Number(stats?.heap_size_limit);
    const used = Number(stats?.used_heap_size);
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0) return false;
    const remaining = limit - used;
    if (!Number.isFinite(remaining) || remaining <= 0) return false;
    return bytes * 3 > remaining;
  } catch {
    return false;
  }
};

let cachedZstdAvailable = null;

const hasZstd = () => {
  if (cachedZstdAvailable != null) return cachedZstdAvailable;
  cachedZstdAvailable = tryRequire('@mongodb-js/zstd').ok;
  return cachedZstdAvailable;
};

const zstdDecompressSync = (buffer, maxBytes, sourcePath) => {
  if (!hasZstd()) {
    throw new Error('zstd artifacts require @mongodb-js/zstd to be installed.');
  }
  const script = [
    'const zstd = require("@mongodb-js/zstd");',
    'const chunks = [];',
    'process.stdin.on("data", (d) => chunks.push(d));',
    'process.stdin.on("end", async () => {',
    '  try {',
    '    const input = Buffer.concat(chunks);',
    '    const out = await zstd.decompress(input);',
    '    process.stdout.write(out);',
    '  } catch (err) {',
    '    console.error(err && err.message ? err.message : String(err));',
    '    process.exit(2);',
    '  }',
    '});'
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    input: buffer,
    maxBuffer: maxBytes + 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString('utf8').trim() : '';
    throw new Error(`zstd decompress failed: ${detail || 'unknown error'}`);
  }
  const outBuffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
  if (outBuffer.length > maxBytes || shouldAbortForHeap(outBuffer.length)) {
    throw toJsonTooLargeError(sourcePath, outBuffer.length);
  }
  return outBuffer;
};

const gunzipWithLimit = (buffer, maxBytes, sourcePath) => {
  try {
    const limit = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
    const outputLimit = limit > 0 ? limit + 1024 : 0;
    return gunzipSync(buffer, outputLimit > 0 ? { maxOutputLength: outputLimit } : undefined);
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(sourcePath, maxBytes);
    }
    throw err;
  }
};

const stripBak = (filePath) => (filePath.endsWith('.bak') ? filePath.slice(0, -4) : filePath);

const detectCompression = (filePath) => {
  const target = stripBak(filePath);
  if (target.endsWith('.gz')) return 'gzip';
  if (target.endsWith('.zst')) return 'zstd';
  return null;
};

const decompressBuffer = (buffer, compression, maxBytes, sourcePath) => {
  if (compression === 'gzip') {
    return gunzipWithLimit(buffer, maxBytes, sourcePath);
  }
  if (compression === 'zstd') {
    return zstdDecompressSync(buffer, maxBytes, sourcePath);
  }
  return buffer;
};

const readBuffer = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat.size);
  }
  return fs.readFileSync(targetPath);
};

const collectCompressedCandidates = (filePath) => {
  const candidates = [];
  const addCandidate = (targetPath, compression, cleanup) => {
    if (!fs.existsSync(targetPath)) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
    candidates.push({ path: targetPath, compression, cleanup, mtimeMs });
  };
  const zstPath = `${filePath}.zst`;
  const gzPath = `${filePath}.gz`;
  addCandidate(zstPath, 'zstd', true);
  addCandidate(getBakPath(zstPath), 'zstd', false);
  addCandidate(gzPath, 'gzip', true);
  addCandidate(getBakPath(gzPath), 'gzip', false);
  candidates.sort((a, b) => {
    if (a.cleanup !== b.cleanup) return a.cleanup ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates;
};

const collectCompressedJsonlCandidates = (filePath) => {
  const candidates = [];
  const addCandidate = (targetPath, compression, cleanup) => {
    if (!fs.existsSync(targetPath)) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
    candidates.push({ path: targetPath, compression, cleanup, mtimeMs });
  };
  const zstPath = `${filePath}.zst`;
  const gzPath = `${filePath}.gz`;
  addCandidate(zstPath, 'zstd', true);
  addCandidate(getBakPath(zstPath), 'zstd', false);
  addCandidate(gzPath, 'gzip', true);
  addCandidate(getBakPath(gzPath), 'gzip', false);
  candidates.sort((a, b) => {
    if (a.cleanup !== b.cleanup) return a.cleanup ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates;
};

export const readJsonFile = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const parseBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    if (shouldAbortForHeap(buffer.length)) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    try {
      return JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    throw err;
  }
  };
  const tryRead = (targetPath, options = {}) => {
    const { compression = null, cleanup = false } = options;
    const buffer = readBuffer(targetPath, maxBytes);
    const parsed = parseBuffer(
      decompressBuffer(buffer, compression || detectCompression(targetPath), maxBytes, targetPath),
      targetPath
    );
    if (cleanup) cleanupBak(targetPath);
    return parsed;
  };
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, { cleanup: true });
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return tryRead(bakPath);
      }
      throw err;
    }
  }
  if (filePath.endsWith('.json')) {
    const candidates = collectCompressedCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, {
            compression: candidate.compression,
            cleanup: candidate.cleanup
          });
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  if (fs.existsSync(bakPath)) {
    return tryRead(bakPath);
  }
  throw new Error(`Missing JSON artifact: ${filePath}`);
};

const normalizeManifest = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  const pieces = Array.isArray(source.pieces) ? source.pieces : [];
  return { ...source, pieces };
};

const normalizeCompatibilityKey = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const isSafeManifestPath = (value) => {
  if (typeof value !== 'string') return false;
  if (!value) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = value.split('\\').join('/');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/')) return false;
  return true;
};

const resolveManifestPath = (dir, relPath, strict) => {
  if (!relPath) return null;
  if (strict && !isSafeManifestPath(relPath)) {
    const err = new Error(`Invalid manifest path: ${relPath}`);
    err.code = 'ERR_MANIFEST_PATH';
    throw err;
  }
  const resolved = path.resolve(dir, relPath.split('/').join(path.sep));
  if (strict) {
    const root = path.resolve(dir);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      const err = new Error(`Manifest path escapes index root: ${relPath}`);
      err.code = 'ERR_MANIFEST_PATH';
      throw err;
    }
  }
  return resolved;
};

export const loadPiecesManifest = (dir, { maxBytes = MAX_JSON_BYTES, strict = true } = {}) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  if (!existsOrBak(manifestPath)) {
    if (strict) {
      const err = new Error(`Missing pieces manifest: ${manifestPath}`);
      err.code = 'ERR_MANIFEST_MISSING';
      throw err;
    }
    return null;
  }
  const raw = readJsonFile(manifestPath, { maxBytes });
  const manifest = normalizeManifest(raw);
  if (!manifest && strict) {
    const err = new Error(`Invalid pieces manifest: ${manifestPath}`);
    err.code = 'ERR_MANIFEST_INVALID';
    throw err;
  }
  return manifest;
};

export const readCompatibilityKey = (dir, { maxBytes = MAX_JSON_BYTES, strict = true } = {}) => {
  let manifest = null;
  if (strict) {
    manifest = loadPiecesManifest(dir, { maxBytes, strict: true });
  } else {
    try {
      manifest = loadPiecesManifest(dir, { maxBytes, strict: false });
    } catch {}
  }
  const manifestKey = normalizeCompatibilityKey(manifest?.compatibilityKey);
  if (manifestKey) {
    return { key: manifestKey, source: 'manifest' };
  }
  if (manifest && strict) {
    const err = new Error(`Pieces manifest missing compatibilityKey: ${path.join(dir, 'pieces', 'manifest.json')}`);
    err.code = 'ERR_COMPATIBILITY_KEY_MISSING';
    throw err;
  }
  const statePath = path.join(dir, 'index_state.json');
  let state = null;
  try {
    state = readJsonFile(statePath, { maxBytes });
  } catch (err) {
    if (strict) {
      const error = new Error(`Missing compatibilityKey for index: ${dir}`);
      error.code = 'ERR_COMPATIBILITY_KEY_MISSING';
      throw error;
    }
    return { key: null, source: null };
  }
  const stateKey = normalizeCompatibilityKey(state?.compatibilityKey);
  if (stateKey) {
    return { key: stateKey, source: 'index_state' };
  }
  if (strict) {
    const err = new Error(`Missing compatibilityKey for index: ${dir}`);
    err.code = 'ERR_COMPATIBILITY_KEY_MISSING';
    throw err;
  }
  return { key: null, source: null };
};

const indexManifestPieces = (manifest) => {
  const map = new Map();
  const list = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  for (const entry of list) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(entry);
  }
  return map;
};

const resolveManifestEntries = (manifest, name) => {
  const map = indexManifestPieces(manifest);
  return map.get(name) || [];
};

const inferEntryFormat = (entry) => {
  if (entry && typeof entry.format === 'string' && entry.format) return entry.format;
  const pathValue = typeof entry?.path === 'string' ? entry.path : '';
  if (pathValue.endsWith('.jsonl') || pathValue.endsWith('.jsonl.gz') || pathValue.endsWith('.jsonl.zst')) {
    return 'jsonl';
  }
  return 'json';
};

const normalizeMetaParts = (parts) => {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof part.path === 'string') return part.path;
      return null;
    })
    .filter(Boolean);
};

const resolveMetaFormat = (meta, fallback) => {
  const raw = typeof meta?.format === 'string' ? meta.format : null;
  if (!raw) return fallback;
  if (raw === 'jsonl') return 'jsonl';
  if (raw === 'jsonl-sharded') return 'sharded';
  if (raw === 'sharded') return 'sharded';
  if (raw === 'json') return 'json';
  return raw;
};

const resolveManifestArtifactSources = ({ dir, manifest, name, strict, maxBytes = MAX_JSON_BYTES }) => {
  if (!manifest) return null;
  const entries = resolveManifestEntries(manifest, name);
  const metaEntries = resolveManifestEntries(manifest, `${name}_meta`);
  if (metaEntries.length > 1 && strict) {
    const err = new Error(`Multiple manifest entries for ${name}_meta`);
    err.code = 'ERR_MANIFEST_INVALID';
    throw err;
  }
  if (metaEntries.length === 1) {
    const metaEntry = metaEntries[0];
    const metaPath = resolveManifestPath(dir, metaEntry.path, strict);
    const metaRaw = readJsonFile(metaPath, { maxBytes });
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const parts = normalizeMetaParts(meta?.parts);
    if (!parts.length) {
      const err = new Error(`Manifest meta missing parts for ${name}`);
      err.code = 'ERR_MANIFEST_INVALID';
      throw err;
    }
    const partSet = new Set(entries.map((entry) => entry?.path));
    if (strict) {
      for (const part of parts) {
        if (!partSet.has(part)) {
          const err = new Error(`Manifest missing shard path for ${name}: ${part}`);
          err.code = 'ERR_MANIFEST_INCOMPLETE';
          throw err;
        }
      }
    }
    const paths = parts.map((part) => resolveManifestPath(dir, part, strict));
    return {
      format: resolveMetaFormat(meta, 'jsonl'),
      paths,
      meta,
      metaPath
    };
  }
  if (!entries.length) return null;
  if (entries.length > 1 && strict) {
    const err = new Error(`Ambiguous manifest entries for ${name}`);
    err.code = 'ERR_MANIFEST_INVALID';
    throw err;
  }
  const resolvedEntries = entries.slice().sort((a, b) => {
    const aPath = a?.path || '';
    const bPath = b?.path || '';
    return aPath < bPath ? -1 : (aPath > bPath ? 1 : 0);
  });
  const paths = resolvedEntries
    .map((entry) => resolveManifestPath(dir, entry?.path, strict))
    .filter(Boolean);
  return {
    format: inferEntryFormat(resolvedEntries[0]),
    paths
  };
};

export const resolveArtifactPresence = (
  dir,
  name,
  {
    manifest = null,
    maxBytes = MAX_JSON_BYTES,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  let sources = null;
  let error = null;
  try {
    sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name,
      strict,
      maxBytes
    });
  } catch (err) {
    error = err;
  }
  if (!sources) {
    return {
      name,
      format: 'missing',
      paths: [],
      metaPath: null,
      meta: null,
      missingPaths: [],
      missingMeta: false,
      error
    };
  }
  const paths = Array.isArray(sources.paths) ? sources.paths : [];
  const missingPaths = paths.filter((target) => !existsOrBak(target));
  const metaPath = sources.metaPath || null;
  const missingMeta = metaPath ? !existsOrBak(metaPath) : false;
  return {
    name,
    format: sources.format === 'sharded' ? 'sharded' : sources.format,
    paths,
    metaPath,
    meta: sources.meta || null,
    missingPaths,
    missingMeta,
    error
  };
};

export const readJsonLinesArray = async (
  filePath,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    const parsed = [];
    const raw = buffer.toString('utf8');
    if (!raw.trim()) return parsed;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const entry = parseJsonlLine(lines[i], sourcePath, i + 1, maxBytes, requiredKeys);
      if (entry !== null) parsed.push(entry);
    }
    return parsed;
  };
  const tryRead = async (targetPath, cleanup = false) => {
    const compression = detectCompression(targetPath);
    if (compression) {
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      return parsed;
    }
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const parsed = [];
    const stream = fs.createReadStream(targetPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of rl) {
        lineNumber += 1;
        const entry = parseJsonlLine(line, targetPath, lineNumber, maxBytes, requiredKeys);
        if (entry !== null) parsed.push(entry);
      }
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size);
      }
      throw err;
    } finally {
      rl.close();
      stream.destroy();
    }
    if (cleanup) cleanupBak(targetPath);
    return parsed;
  };
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      return await tryRead(filePath, true);
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return await tryRead(bakPath);
      }
      throw err;
    }
  }
  if (fs.existsSync(bakPath)) {
    return await tryRead(bakPath);
  }
  if (filePath.endsWith('.jsonl')) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return await tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

export const readJsonLinesArraySync = (
  filePath,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  const useCache = !requiredKeys;
  if (useCache) {
    const cached = readCache(filePath);
    if (cached) return cached;
  }
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    const parsed = [];
    const raw = buffer.toString('utf8');
    if (!raw.trim()) return parsed;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const entry = parseJsonlLine(lines[i], sourcePath, i + 1, maxBytes, requiredKeys);
      if (entry !== null) parsed.push(entry);
    }
    return parsed;
  };
  const tryRead = (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const compression = detectCompression(targetPath);
    if (compression) {
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (useCache) writeCache(targetPath, parsed);
      return parsed;
    }
    let raw = '';
    try {
      raw = fs.readFileSync(targetPath, 'utf8');
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size);
      }
      throw err;
    }
    if (!raw.trim()) return [];
    const parsed = [];
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const lineNumber = i + 1;
      const entry = parseJsonlLine(lines[i], targetPath, lineNumber, maxBytes, requiredKeys);
      if (entry !== null) parsed.push(entry);
    }
    if (cleanup) cleanupBak(targetPath);
    if (useCache) writeCache(targetPath, parsed);
    return parsed;
  };
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, true);
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return tryRead(bakPath);
      }
      throw err;
    }
  }
  if (fs.existsSync(bakPath)) {
    return tryRead(bakPath);
  }
  if (filePath.endsWith('.jsonl')) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

const readShardFiles = (dir, prefix) => {
  if (!fs.existsSync(dir)) return [];
  const isAllowed = (name) => (
    name.endsWith('.json')
    || name.endsWith('.jsonl')
    || name.endsWith('.json.gz')
    || name.endsWith('.json.zst')
    || name.endsWith('.jsonl.gz')
    || name.endsWith('.jsonl.zst')
  );
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && isAllowed(name))
    .sort()
    .map((name) => path.join(dir, name));
};

const existsOrBak = (filePath) => {
  if (fs.existsSync(filePath) || fs.existsSync(getBakPath(filePath))) return true;
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) {
    const gzPath = `${filePath}.gz`;
    const zstPath = `${filePath}.zst`;
    if (fs.existsSync(gzPath) || fs.existsSync(getBakPath(gzPath))) return true;
    if (fs.existsSync(zstPath) || fs.existsSync(getBakPath(zstPath))) return true;
  }
  return false;
};

const resolveArtifactMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {}
  try {
    return fs.statSync(getBakPath(filePath)).mtimeMs;
  } catch {}
  return 0;
};

const resolveDirMtime = (dirPath) => {
  try {
    return fs.statSync(dirPath).mtimeMs;
  } catch {}
  return 0;
};

const resolveJsonlArtifactSources = (dir, baseName) => {
  const metaPath = path.join(dir, `${baseName}.meta.json`);
  const partsDir = path.join(dir, `${baseName}.parts`);
  const jsonlPath = path.join(dir, `${baseName}.jsonl`);
  const hasJsonl = existsOrBak(jsonlPath);
  const hasShards = existsOrBak(metaPath) || fs.existsSync(partsDir);
  if (hasJsonl && hasShards) {
    const jsonlMtime = resolveArtifactMtime(jsonlPath);
    const shardMtime = existsOrBak(metaPath)
      ? resolveArtifactMtime(metaPath)
      : resolveDirMtime(partsDir);
    if (jsonlMtime >= shardMtime) {
      return { format: 'jsonl', paths: [jsonlPath] };
    }
  }
  if (hasShards) {
    let parts = [];
    if (existsOrBak(metaPath)) {
      try {
        const metaRaw = readJsonFile(metaPath, { maxBytes: MAX_JSON_BYTES });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        if (Array.isArray(meta?.parts) && meta.parts.length) {
          parts = meta.parts
            .map((part) => (typeof part === 'string' ? part : part?.path))
            .filter(Boolean)
            .map((name) => path.join(dir, name));
        }
      } catch {}
    }
    if (!parts.length) {
      parts = readShardFiles(partsDir, `${baseName}.part-`);
    }
    return parts.length ? { format: 'jsonl', paths: parts } : null;
  }
  if (hasJsonl) {
    return { format: 'jsonl', paths: [jsonlPath] };
  }
  return null;
};

export const loadJsonArrayArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous JSON sources for ${baseName}`);
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const out = [];
      for (const partPath of sources.paths) {
        const part = await readJsonLinesArray(partPath, { maxBytes, requiredKeys: resolvedKeys });
        for (const entry of part) out.push(entry);
      }
      return out;
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const out = [];
    for (const partPath of sources.paths) {
      const part = await readJsonLinesArray(partPath, { maxBytes, requiredKeys: resolvedKeys });
      for (const entry of part) out.push(entry);
    }
    return out;
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadJsonArrayArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous JSON sources for ${baseName}`);
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const out = [];
      for (const partPath of sources.paths) {
        const part = readJsonLinesArraySync(partPath, { maxBytes, requiredKeys: resolvedKeys });
        for (const entry of part) out.push(entry);
      }
      return out;
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const out = [];
    for (const partPath of sources.paths) {
      const part = readJsonLinesArraySync(partPath, { maxBytes, requiredKeys: resolvedKeys });
      for (const entry of part) out.push(entry);
    }
    return out;
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadGraphRelations = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'graph_relations',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for graph_relations');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const payload = createGraphRelationsShell(sources.meta || null);
      for (const partPath of sources.paths) {
        const entries = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
        appendGraphRelationsEntries(payload, entries, partPath);
      }
      return finalizeGraphRelations(payload);
    }
    throw new Error('Missing manifest entry for graph_relations');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations',
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for graph_relations');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const payload = createGraphRelationsShell(sources.meta || null);
    for (const partPath of sources.paths) {
      const entries = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
      appendGraphRelationsEntries(payload, entries, partPath);
    }
    return finalizeGraphRelations(payload);
  }

  const metaPath = path.join(dir, 'graph_relations.meta.json');
  const partsDir = path.join(dir, 'graph_relations.parts');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const metaRaw = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const partList = normalizeMetaParts(meta?.parts);
    const parts = partList.length
      ? partList.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'graph_relations.part-');
    if (!parts.length) {
      throw new Error(`Missing graph_relations shard files in ${partsDir}`);
    }
    const payload = createGraphRelationsShell(meta);
    for (const partPath of parts) {
      const entries = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
      appendGraphRelationsEntries(payload, entries, partPath);
    }
    return finalizeGraphRelations(payload);
  }
  const jsonlPath = path.join(dir, 'graph_relations.jsonl');
  if (existsOrBak(jsonlPath)) {
    const payload = createGraphRelationsShell(null);
    const entries = await readJsonLinesArray(jsonlPath, { maxBytes, requiredKeys });
    appendGraphRelationsEntries(payload, entries, jsonlPath);
    return finalizeGraphRelations(payload);
  }
  const jsonPath = path.join(dir, 'graph_relations.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: graph_relations.json');
};

export const loadGraphRelationsSync = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'graph_relations',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for graph_relations');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const payload = createGraphRelationsShell(sources.meta || null);
      for (const partPath of sources.paths) {
        const entries = readJsonLinesArraySync(partPath, { maxBytes, requiredKeys });
        appendGraphRelationsEntries(payload, entries, partPath);
      }
      return finalizeGraphRelations(payload);
    }
    throw new Error('Missing manifest entry for graph_relations');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations',
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for graph_relations');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const payload = createGraphRelationsShell(sources.meta || null);
    for (const partPath of sources.paths) {
      const entries = readJsonLinesArraySync(partPath, { maxBytes, requiredKeys });
      appendGraphRelationsEntries(payload, entries, partPath);
    }
    return finalizeGraphRelations(payload);
  }

  const metaPath = path.join(dir, 'graph_relations.meta.json');
  const partsDir = path.join(dir, 'graph_relations.parts');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const metaRaw = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const partList = normalizeMetaParts(meta?.parts);
    const parts = partList.length
      ? partList.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'graph_relations.part-');
    if (!parts.length) {
      throw new Error(`Missing graph_relations shard files in ${partsDir}`);
    }
    const payload = createGraphRelationsShell(meta);
    for (const partPath of parts) {
      const entries = readJsonLinesArraySync(partPath, { maxBytes, requiredKeys });
      appendGraphRelationsEntries(payload, entries, partPath);
    }
    return finalizeGraphRelations(payload);
  }
  const jsonlPath = path.join(dir, 'graph_relations.jsonl');
  if (existsOrBak(jsonlPath)) {
    const payload = createGraphRelationsShell(null);
    const entries = readJsonLinesArraySync(jsonlPath, { maxBytes, requiredKeys });
    appendGraphRelationsEntries(payload, entries, jsonlPath);
    return finalizeGraphRelations(payload);
  }
  const jsonPath = path.join(dir, 'graph_relations.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: graph_relations.json');
};

export const loadChunkMeta = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('chunk_meta');
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'chunk_meta',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for chunk_meta');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const out = [];
      for (const partPath of sources.paths) {
        const part = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
        for (const entry of part) out.push(entry);
      }
      return out;
    }
    throw new Error('Missing manifest entry for chunk_meta');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'chunk_meta',
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, 'chunk_meta');
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for chunk_meta');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const out = [];
    for (const partPath of sources.paths) {
      const part = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
      for (const entry of part) out.push(entry);
    }
    return out;
  }

  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: chunk_meta.json');
};

export const loadTokenPostings = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const loadSharded = (meta, shardPaths, shardsDir) => {
    if (!Array.isArray(shardPaths) || shardPaths.length === 0) {
      throw new Error(`Missing token_postings shard files in ${shardsDir}`);
    }
    const vocab = [];
    const postings = [];
    const pushChunked = (target, items) => {
      const CHUNK = 4096;
      for (let i = 0; i < items.length; i += CHUNK) {
        target.push(...items.slice(i, i + CHUNK));
      }
    };
    for (const shardPath of shardPaths) {
      const shard = readJsonFile(shardPath, { maxBytes });
      const shardVocab = Array.isArray(shard?.vocab)
        ? shard.vocab
        : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const shardPostings = Array.isArray(shard?.postings)
        ? shard.postings
        : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
      if (shardVocab.length) pushChunked(vocab, shardVocab);
      if (shardPostings.length) pushChunked(postings, shardPostings);
    }
    const docLengths = Array.isArray(meta?.docLengths)
      ? meta.docLengths
      : (Array.isArray(meta?.arrays?.docLengths) ? meta.arrays.docLengths : []);
    return {
      ...meta,
      vocab,
      postings,
      docLengths
    };
  };
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'token_postings',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for token_postings');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      if (sources.format === 'sharded') {
        return loadSharded(sources.meta || {}, sources.paths, path.join(dir, 'token_postings.shards'));
      }
      throw new Error(`Unsupported token_postings format: ${sources.format}`);
    }
    throw new Error('Missing manifest entry for token_postings');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'token_postings',
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for token_postings');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    if (sources.format === 'sharded') {
      return loadSharded(sources.meta || {}, sources.paths, path.join(dir, 'token_postings.shards'));
    }
    throw new Error(`Unsupported token_postings format: ${sources.format}`);
  }

  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (existsOrBak(metaPath) || fs.existsSync(shardsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : {};
    const partList = normalizeMetaParts(meta?.parts);
    const shards = partList.length
      ? partList.map((name) => path.join(dir, name))
      : readShardFiles(shardsDir, 'token_postings.part-');
    return loadSharded(meta, shards, shardsDir);
  }
  const jsonPath = path.join(dir, 'token_postings.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: token_postings.json');
};
