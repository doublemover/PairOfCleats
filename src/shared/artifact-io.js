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
  const graphsMeta = meta?.graphs || {};
  const generatedAt = typeof meta?.generatedAt === 'string'
    ? meta.generatedAt
    : new Date().toISOString();
  const version = Number.isFinite(meta?.version) ? meta.version : 1;
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
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
        const meta = readJsonFile(metaPath, { maxBytes: MAX_JSON_BYTES });
        if (Array.isArray(meta?.parts) && meta.parts.length) {
          parts = meta.parts.map((name) => path.join(dir, name));
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
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  const sources = resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
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
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  const sources = resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
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

export const loadGraphRelations = async (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'graph_relations.meta.json');
  const partsDir = path.join(dir, 'graph_relations.parts');
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const parts = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
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

export const loadGraphRelationsSync = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'graph_relations.meta.json');
  const partsDir = path.join(dir, 'graph_relations.parts');
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const parts = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
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

export const loadChunkMeta = async (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  const requiredKeys = resolveJsonlRequiredKeys('chunk_meta');
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const hasJsonl = existsOrBak(jsonlPath);
  const hasShards = existsOrBak(metaPath) || fs.existsSync(partsDir);
  if (hasJsonl && hasShards) {
    const jsonlMtime = resolveArtifactMtime(jsonlPath);
    const shardMtime = existsOrBak(metaPath)
      ? resolveArtifactMtime(metaPath)
      : resolveDirMtime(partsDir);
    if (jsonlMtime >= shardMtime) {
      return readJsonLinesArray(jsonlPath, { maxBytes, requiredKeys });
    }
  }
  if (hasShards) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const parts = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'chunk_meta.part-');
    if (!parts.length) {
      throw new Error(`Missing chunk_meta shard files in ${partsDir}`);
    }
    const out = [];
    for (const partPath of parts) {
      const part = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
      for (const entry of part) out.push(entry);
    }
    return out;
  }
  if (hasJsonl) {
    return readJsonLinesArray(jsonlPath, { maxBytes, requiredKeys });
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: chunk_meta.json`);
};

export const loadTokenPostings = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (existsOrBak(metaPath) || fs.existsSync(shardsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : {};
    const shards = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
      : readShardFiles(shardsDir, 'token_postings.part-');
    if (!shards.length) {
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
    for (const shardPath of shards) {
      const shard = readJsonFile(shardPath, { maxBytes });
      const shardVocab = Array.isArray(shard?.vocab) ? shard.vocab : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const shardPostings = Array.isArray(shard?.postings) ? shard.postings : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
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
  }
  const jsonPath = path.join(dir, 'token_postings.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: token_postings.json`);
};
