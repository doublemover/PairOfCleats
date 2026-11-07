import path from 'node:path';
import { throwIfAborted } from '../../shared/abort.js';
import { buildGraphIndexCacheKey, createGraphStore } from '../../graph/store.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import {
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io/manifest.js';
import { loadChunkMeta } from '../../shared/artifact-io/loaders.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const normalizeSelection = (selection) => {
  if (selection == null) return null;
  const list = Array.isArray(selection) ? selection : [selection];
  const normalized = list
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  return normalized;
};

/**
 * Load canonical graph-input artifacts for tooling commands.
 *
 * @param {{
 *  repoRoot?:string|null,
 *  indexDir:string,
 *  strict?:boolean,
 *  maxBytes?:number,
 *  includeChunkMeta?:boolean,
 *  signal?:AbortSignal
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
  includeChunkMeta = false,
  signal = null
} = {}) => {
  throwIfAborted(signal);
  if (!indexDir) {
    throw new Error('Missing required indexDir.');
  }
  const manifest = loadPiecesManifest(indexDir, { maxBytes, strict });
  const chunkMeta = includeChunkMeta
    ? await loadChunkMeta(indexDir, { maxBytes, manifest, strict })
    : null;
  throwIfAborted(signal);
  const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
    maxBytes,
    strict
  });
  const indexSignature = await buildIndexSignature(indexDir);
  throwIfAborted(signal);
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
 *  includeGraphRelations?:boolean,
 *  cacheEnabled?:boolean,
 *  chunkFileFact?:{chunkUid:string,file:string}|null,
 *  signal?:AbortSignal
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
  includeGraphRelations = false,
  cacheEnabled = true,
  chunkFileFact = null,
  signal = null
} = {}) => {
  throwIfAborted(signal);
  const resolvedIndexDir = indexDir || graphInputs?.indexDir || null;
  if (!resolvedIndexDir) {
    throw new Error('Missing required indexDir.');
  }

  const resolvedRepoRoot = repoRoot ?? graphInputs?.repoRoot ?? null;
  const fileFact = chunkFileFact == null ? null : { chunkUid: chunkFileFact.chunkUid, file: chunkFileFact.file };
  if (fileFact && (!fileFact.chunkUid || typeof fileFact.chunkUid !== 'string' || !fileFact.file || typeof fileFact.file !== 'string')) {
    throw new TypeError('Selected chunk-file fact requires a chunk UID and indexed file.');
  }
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
  const graphCacheKey = cacheEnabled ? buildGraphIndexCacheKey({
    indexSignature,
    repoRoot: resolvedRepoRoot,
    graphs: graphSelection,
    includeCsr
  }) : null;

  let graphIndex = includeGraphIndex
    ? await graphStore.loadGraphIndex({
      repoRoot: resolvedRepoRoot,
      cacheKey: graphCacheKey,
      indexSignature,
      graphs: graphSelection,
      includeCsr
    })
    : null;
  throwIfAborted(signal);
  if (graphIndex && fileFact) {
    const current = graphIndex.chunkInfo.get(fileFact.chunkUid);
    if (current?.file && graphIndex.normalizeImportPath(current.file) !== graphIndex.normalizeImportPath(fileFact.file)) {
      throw Object.assign(new Error('Selected chunk metadata conflicts with graph containing-file identity.'), { code: 'ERR_ARTIFACT_INVALID' });
    }
    if (!current?.file) {
      // A graph-family filter must not lose a chunk seed's canonical containing
      // file. Keep the cached selected-family index unchanged for other callers.
      const chunkInfo = new Map(graphIndex.chunkInfo);
      chunkInfo.set(fileFact.chunkUid, Object.freeze({ ...current, file: fileFact.file }));
      graphIndex = { ...graphIndex, chunkInfo, _traversalCache: new Map(), _traversalTelemetry: { hits: 0, misses: 0, evictions: 0 } };
    }
  }

  const graphRelations = includeGraphRelations
    ? (graphStore.hasArtifact('graph_relations')
      ? await graphStore.loadGraph()
      : null)
    : null;
  throwIfAborted(signal);

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


/** Private bridge for the authoritative CLI/API/MCP dispatchers. It opens only
 * the supplied pinned generation; it never redirects an old cursor to current.
 * Whole graph indexes, neighborhood traversal and full occurrence arrays are
 * deliberately absent from this bounded evidence-only request.
 */
export const prepareGraphEvidenceOperation = async ({ indexDir = null, graphInputs = null,
  family, filter = {}, cursor = null, limit = 128, scanRows = 1024,
  maxPageBytes = 1024 * 1024, expectedBuildId = null, signal = null } = {}) => {
  throwIfAborted(signal);
  if (!['call_sites', 'graph_relation_edges'].includes(family)) throw new TypeError('Unknown retained graph evidence family.');
  const selectedRoot = indexDir || graphInputs?.indexDir;
  if (!selectedRoot || graphInputs?.indexDir && path.resolve(selectedRoot) !== path.resolve(graphInputs.indexDir)) {
    throw Object.assign(new Error('Evidence inputs belong to another pinned index root.'), { code: 'ERR_RETAINED_EVIDENCE_GENERATION' });
  }
  if (!Number.isSafeInteger(maxPageBytes) || maxPageBytes < 4096 || maxPageBytes > 4 * 1024 * 1024) {
    throw new TypeError('Retained evidence response allowance must be between 4096 and 4194304 bytes.');
  }
  const maxBytes = graphInputs?.maxBytes ?? MAX_JSON_BYTES;
  const manifest = graphInputs?.manifest || loadPiecesManifest(selectedRoot, { maxBytes, strict: true });
  if (typeof manifest?.buildId !== 'string' || !manifest.buildId
    || expectedBuildId !== null && manifest.buildId !== expectedBuildId) {
    throw Object.assign(new Error('Retained evidence requires the exact published build identity.'), { code: 'ERR_RETAINED_EVIDENCE_GENERATION' });
  }
  const store = createGraphStore({ indexDir: selectedRoot, manifest, maxBytes, strict: true });
  const options = {
    filter, cursor, limit, scanRows, maxPageBytes: maxPageBytes - 2048, signal
  };
  const qualifyPage = page => {
    const result = { family, generation: { buildId: manifest.buildId, artifactSurfaceVersion: manifest.artifactSurfaceVersion }, ...page };
    if (Buffer.byteLength(JSON.stringify(result)) > maxPageBytes) {
      throw Object.assign(new Error('Retained evidence response envelope exceeds its byte allowance.'), { code: 'ERR_RETAINED_EVIDENCE_RESPONSE_BYTES' });
    }
    throwIfAborted(signal);
    return result;
  };
  return {
    readPage: async () => qualifyPage(await (family === 'call_sites' ? store.readCallSitesPage : store.readGraphEdgesPage)(options)),
    iteratePages: () => (family === 'call_sites' ? store.iterateCallSitePages : store.iterateGraphEdgePages)(options),
    qualifyPage
  };
};

export const prepareGraphEvidencePage = async options => (await prepareGraphEvidenceOperation(options)).readPage();
