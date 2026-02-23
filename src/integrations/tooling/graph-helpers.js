import { buildGraphIndexCacheKey, createGraphStore } from '../../graph/store.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const normalizeSelection = (selection) => {
  if (selection == null) return null;
  const list = Array.isArray(selection) ? selection : [selection];
  const normalized = list
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  return normalized.length ? normalized : null;
};

/**
 * Load canonical graph-input artifacts for tooling commands.
 *
 * @param {{
 *  repoRoot?:string|null,
 *  indexDir:string,
 *  strict?:boolean,
 *  maxBytes?:number,
 *  includeChunkMeta?:boolean
 * }} [options]
 * @returns {Promise<{
 *  repoRoot:string|null,
 *  indexDir:string,
 *  strict:boolean,
 *  maxBytes:number,
 *  manifest:object,
 *  chunkMeta:object|null,
 *  indexCompatKey:string|null,
 *  indexSignature:string|null
 * }>}
 */
export const prepareGraphInputs = async ({
  repoRoot = null,
  indexDir,
  strict = true,
  maxBytes = MAX_JSON_BYTES,
  includeChunkMeta = false
} = {}) => {
  if (!indexDir) {
    throw new Error('Missing required indexDir.');
  }
  const manifest = loadPiecesManifest(indexDir, { maxBytes, strict });
  const chunkMeta = includeChunkMeta
    ? await loadChunkMeta(indexDir, { maxBytes, manifest, strict })
    : null;
  const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
    maxBytes,
    strict
  });
  const indexSignature = await buildIndexSignature(indexDir);
  return {
    repoRoot: repoRoot || null,
    indexDir,
    strict,
    maxBytes,
    manifest,
    chunkMeta,
    indexCompatKey: indexCompatKey || null,
    indexSignature: indexSignature || null
  };
};

/**
 * Prepare graph store + optional graph index/relations for tooling execution.
 *
 * Accepts either explicit options or preloaded `graphInputs` and always
 * normalizes selection into a deterministic list-or-null shape.
 *
 * @param {{
 *  repoRoot?:string|null,
 *  indexDir?:string|null,
 *  selection?:string|string[]|null,
 *  strict?:boolean,
 *  maxBytes?:number,
 *  graphInputs?:object|null,
 *  includeGraphIndex?:boolean,
 *  includeGraphRelations?:boolean
 * }} [options]
 * @returns {Promise<{
 *  graphStore:ReturnType<typeof createGraphStore>,
 *  graphSelection:string[]|null,
 *  includeCsr:boolean,
 *  graphCacheKey:string,
 *  graphIndex:object|null,
 *  graphRelations:object|null,
 *  indexSignature:string|null
 * }>}
 */
export const prepareGraphIndex = async ({
  repoRoot = null,
  indexDir = null,
  selection = null,
  strict = true,
  maxBytes = MAX_JSON_BYTES,
  graphInputs = null,
  includeGraphIndex = true,
  includeGraphRelations = false
} = {}) => {
  const resolvedIndexDir = indexDir || graphInputs?.indexDir || null;
  if (!resolvedIndexDir) {
    throw new Error('Missing required indexDir.');
  }

  const resolvedRepoRoot = repoRoot ?? graphInputs?.repoRoot ?? null;
  const resolvedStrict = hasOwn(graphInputs, 'strict') ? graphInputs.strict : strict;
  const resolvedMaxBytes = hasOwn(graphInputs, 'maxBytes') ? graphInputs.maxBytes : maxBytes;
  const manifest = hasOwn(graphInputs, 'manifest')
    ? graphInputs.manifest
    : loadPiecesManifest(resolvedIndexDir, {
      maxBytes: resolvedMaxBytes,
      strict: resolvedStrict
    });
  const indexSignature = hasOwn(graphInputs, 'indexSignature')
    ? graphInputs.indexSignature
    : await buildIndexSignature(resolvedIndexDir);

  const graphStore = createGraphStore({
    indexDir: resolvedIndexDir,
    manifest,
    strict: resolvedStrict,
    maxBytes: resolvedMaxBytes
  });

  const graphSelection = normalizeSelection(selection);
  const includeCsr = graphStore.hasArtifact('graph_relations_csr');
  const graphCacheKey = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot: resolvedRepoRoot,
    graphs: graphSelection,
    includeCsr
  });

  const graphIndex = includeGraphIndex
    ? await graphStore.loadGraphIndex({
      repoRoot: resolvedRepoRoot,
      cacheKey: graphCacheKey,
      indexSignature,
      graphs: graphSelection,
      includeCsr
    })
    : null;

  const graphRelations = includeGraphRelations
    ? (graphStore.hasArtifact('graph_relations')
      ? await graphStore.loadGraph()
      : null)
    : null;

  return {
    graphStore,
    graphSelection,
    includeCsr,
    graphCacheKey,
    graphIndex,
    graphRelations,
    indexSignature: indexSignature || null
  };
};
