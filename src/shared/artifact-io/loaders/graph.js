import { MAX_JSON_BYTES } from '../constants.js';
import { readJsonFile, readJsonLinesArraySync, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import {
  createGraphRelationsShell,
  appendGraphRelationsEntry,
  appendGraphRelationsEntries,
  finalizeGraphRelations,
  normalizeGraphRelationsCsr
} from '../graph.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';

/**
 * Load graph relations payload with support for JSON and JSONL-sharded layouts.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {Promise<any>}
 */
export const loadGraphRelations = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict: true });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations',
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw new Error('Missing manifest entry for graph_relations');
  }
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for graph_relations');
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  const payload = createGraphRelationsShell(sources.meta || null);
  for (const partPath of sources.paths) {
    for await (const entry of readJsonLinesIterator(partPath, {
      maxBytes,
      requiredKeys,
      validationMode
    })) {
      appendGraphRelationsEntry(payload, entry, partPath);
    }
  }
  return finalizeGraphRelations(payload);
};

/**
 * Load normalized graph-relations CSR payload.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {Promise<any|null>}
 */
export const loadGraphRelationsCsr = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict: true });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations_csr',
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported manifest format for graph_relations_csr: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for graph_relations_csr');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    return normalizeGraphRelationsCsr(payload, { strict });
  }
  if (!strict) return null;
  throw new Error('Missing manifest entry for graph_relations_csr');
};

/**
 * Synchronous variant of {@link loadGraphRelations}.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {any}
 */
export const loadGraphRelationsSync = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict: true });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations',
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw new Error('Missing manifest entry for graph_relations');
  }
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for graph_relations');
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  const payload = createGraphRelationsShell(sources.meta || null);
  for (const partPath of sources.paths) {
    const entries = readJsonLinesArraySync(partPath, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    appendGraphRelationsEntries(payload, entries, partPath);
  }
  return finalizeGraphRelations(payload);
};

/**
 * Synchronous variant of {@link loadGraphRelationsCsr}.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {any|null}
 */
export const loadGraphRelationsCsrSync = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict: true });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations_csr',
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported manifest format for graph_relations_csr: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for graph_relations_csr');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    return normalizeGraphRelationsCsr(payload, { strict });
  }
  if (!strict) return null;
  throw new Error('Missing manifest entry for graph_relations_csr');
};
