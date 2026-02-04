import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from './constants.js';
import { existsOrBak, readShardFiles, resolveArtifactMtime, resolveDirMtime } from './fs.js';
import { fromPosix } from '../files.js';
import { readJsonlRowAt, readOffsetAt, resolveOffsetsCount } from './offsets.js';
import { readVarintDeltasAt } from './varint.js';
import { readJsonFile, readJsonLinesArray, readJsonLinesArraySync } from './json.js';
import { resolveJsonlRequiredKeys } from './jsonl.js';
import { createGraphRelationsShell, appendGraphRelationsEntries, finalizeGraphRelations } from './graph.js';
import { loadPiecesManifest, resolveManifestArtifactSources, normalizeMetaParts } from './manifest.js';

const warnedNonStrictJsonFallback = new Set();
const warnNonStrictJsonFallback = (dir, name) => {
  const key = `${dir}:${name}`;
  if (warnedNonStrictJsonFallback.has(key)) return;
  warnedNonStrictJsonFallback.add(key);
  console.warn(
    `[manifest] Non-strict mode: ${name} missing from manifest; using legacy JSON path (${dir}).`
  );
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

const inflateColumnarRows = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  if (!columns.length) return [];
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = Array.isArray(values) ? (values[i] ?? null) : null;
      const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
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
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous columnar sources for ${baseName}`);
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
        return inflated;
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
  const manifestSources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  const sources = manifestSources || resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
    if (!manifestSources) warnNonStrictJsonFallback(dir, baseName);
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous columnar sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
      return inflated;
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
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadJsonObjectArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    fallbackPath = null
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
    if (sources?.paths?.length) {
      if (sources.format !== 'json') {
        throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
      }
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error(`Ambiguous JSON sources for ${baseName}`);
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (fallbackPath && existsOrBak(fallbackPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(fallbackPath, { maxBytes });
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadJsonObjectArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    fallbackPath = null
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
    if (sources?.paths?.length) {
      if (sources.format !== 'json') {
        throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
      }
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error(`Ambiguous JSON sources for ${baseName}`);
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (fallbackPath && existsOrBak(fallbackPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(fallbackPath, { maxBytes });
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
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
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous columnar sources for ${baseName}`);
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
        return inflated;
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
  const manifestSources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  const sources = manifestSources || resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
    if (!manifestSources) warnNonStrictJsonFallback(dir, baseName);
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous columnar sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
      return inflated;
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
    warnNonStrictJsonFallback(dir, baseName);
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
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous columnar sources for chunk_meta');
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
        return inflated;
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
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous columnar sources for chunk_meta');
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
      return inflated;
    }
    const out = [];
    for (const partPath of sources.paths) {
      const part = await readJsonLinesArray(partPath, { maxBytes, requiredKeys });
      for (const entry of part) out.push(entry);
    }
    return out;
  }

  const columnarPath = path.join(dir, 'chunk_meta.columnar.json');
  if (existsOrBak(columnarPath)) {
    warnNonStrictJsonFallback(dir, 'chunk_meta');
    const payload = readJsonFile(columnarPath, { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
    return inflated;
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

const resolvePerFileMetaPath = (dir, baseName, { manifest, strict, maxBytes }) => {
  const metaName = `${baseName}_by_file_meta`;
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name: metaName,
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    return sources.paths[0];
  }
  if (!strict) {
    const fallback = path.join(dir, `${baseName}.by-file.meta.json`);
    return existsOrBak(fallback) ? fallback : null;
  }
  return null;
};

const loadPerFileIndexMeta = (dir, baseName, { manifest, strict, maxBytes }) => {
  const metaPath = resolvePerFileMetaPath(dir, baseName, { manifest, strict, maxBytes });
  if (!metaPath) return null;
  const metaRaw = readJsonFile(metaPath, { maxBytes });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  if (!meta || typeof meta !== 'object') return null;
  return { meta, metaPath };
};

const resolveRowSourcesFromPerFileMeta = (dir, meta) => {
  const jsonl = meta?.jsonl && typeof meta.jsonl === 'object' ? meta.jsonl : null;
  const parts = Array.isArray(jsonl?.parts) ? jsonl.parts : [];
  const counts = Array.isArray(jsonl?.counts) ? jsonl.counts : [];
  const offsets = Array.isArray(jsonl?.offsets) ? jsonl.offsets : [];
  if (!parts.length || parts.length !== counts.length || offsets.length !== parts.length) {
    return null;
  }
  const resolvedParts = parts.map((rel) => path.join(dir, fromPosix(rel)));
  const resolvedOffsets = offsets.map((rel) => path.join(dir, fromPosix(rel)));
  return { parts: resolvedParts, offsets: resolvedOffsets, counts };
};

const resolvePartIndex = (counts, index) => {
  let cursor = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const count = Number.isFinite(counts[i]) ? counts[i] : 0;
    if (index < cursor + count) {
      return { partIndex: i, localIndex: index - cursor };
    }
    cursor += count;
  }
  return null;
};

const loadSymbolRowsForFile = async (
  dir,
  baseName,
  {
    fileId,
    filePath,
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  let resolvedFileId = Number.isFinite(fileId) ? fileId : null;
  if (!Number.isFinite(resolvedFileId) && filePath) {
    try {
      const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', {
        maxBytes,
        manifest: resolvedManifest,
        strict
      });
      if (Array.isArray(fileMeta)) {
        const match = fileMeta.find((entry) => entry?.file === filePath);
        if (match && Number.isFinite(match.id)) {
          resolvedFileId = match.id;
        }
      }
    } catch {}
  }
  let resolvedFilePath = filePath || null;
  if (!resolvedFilePath && Number.isFinite(resolvedFileId)) {
    try {
      const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', {
        maxBytes,
        manifest: resolvedManifest,
        strict
      });
      if (Array.isArray(fileMeta)) {
        const match = fileMeta.find((entry) => entry?.id === resolvedFileId);
        if (match?.file) {
          resolvedFilePath = match.file;
        }
      }
    } catch {}
  }
  if (!Number.isFinite(resolvedFileId)) {
    return [];
  }

  const perFileMeta = loadPerFileIndexMeta(dir, baseName, {
    manifest: resolvedManifest,
    strict,
    maxBytes
  });
  if (!perFileMeta?.meta) {
    const full = await loadJsonArrayArtifact(dir, baseName, {
      maxBytes,
      manifest: resolvedManifest,
      strict
    });
    const filterField = baseName === 'symbol_edges' ? 'from' : 'host';
    return Array.isArray(full)
      ? full.filter((row) => row?.[filterField]?.file === resolvedFilePath)
      : [];
  }

  const meta = perFileMeta.meta;
  const offsetsInfo = meta?.offsets && typeof meta.offsets === 'object' ? meta.offsets : null;
  if (!offsetsInfo?.path || !meta?.data) {
    return [];
  }
  const dataPath = path.join(dir, fromPosix(meta.data));
  const offsetsPath = path.join(dir, fromPosix(offsetsInfo.path));
  const offsetsCount = await resolveOffsetsCount(offsetsPath);
  if (resolvedFileId + 1 >= offsetsCount) return [];
  const [start, end] = await Promise.all([
    readOffsetAt(offsetsPath, resolvedFileId),
    readOffsetAt(offsetsPath, resolvedFileId + 1)
  ]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const rowIndexes = await readVarintDeltasAt(dataPath, start, end);
  if (!rowIndexes.length) return [];
  const sources = resolveRowSourcesFromPerFileMeta(dir, meta);
  if (!sources) return [];
  const requiredKeys = resolveJsonlRequiredKeys(baseName);
  const rows = [];
  for (const rowIndex of rowIndexes) {
    const resolved = resolvePartIndex(sources.counts, rowIndex);
    if (!resolved) continue;
    const row = await readJsonlRowAt(
      sources.parts[resolved.partIndex],
      sources.offsets[resolved.partIndex],
      resolved.localIndex,
      { maxBytes, requiredKeys }
    );
    if (row) rows.push(row);
  }
  return rows;
};

export const loadSymbolOccurrencesByFile = async (dir, options = {}) => (
  loadSymbolRowsForFile(dir, 'symbol_occurrences', options)
);

export const loadSymbolEdgesByFile = async (dir, options = {}) => (
  loadSymbolRowsForFile(dir, 'symbol_edges', options)
);
