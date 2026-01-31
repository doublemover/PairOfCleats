import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from './constants.js';
import { existsOrBak, readShardFiles, resolveArtifactMtime, resolveDirMtime } from './fs.js';
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
