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

const resolveGraphSources = ({
  dir,
  name,
  maxBytes,
  manifest,
  strict,
  required = true
}) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name,
    strict,
    maxBytes
  });
  if (sources?.paths?.length) return sources;
  if (!required && !strict) return null;
  throw new Error(`Missing manifest entry for ${name}`);
};

const readSingleJsonSource = ({ sources, maxBytes, name }) => {
  if (sources.format !== 'json') return { ok: false, payload: null };
  if (sources.paths.length > 1) {
    throw new Error(`Ambiguous JSON sources for ${name}`);
  }
  return {
    ok: true,
    payload: readJsonFile(sources.paths[0], { maxBytes })
  };
};

const loadGraphRelationsCsrPayload = ({ sources, maxBytes, strict }) => {
  if (!sources) return null;
  if (sources.format !== 'json') {
    throw new Error(`Unsupported manifest format for graph_relations_csr: ${sources.format}`);
  }
  const payload = readSingleJsonSource({
    sources,
    maxBytes,
    name: 'graph_relations_csr'
  }).payload;
  return normalizeGraphRelationsCsr(payload, { strict });
};

const resolveGraphRelationsReadPlan = ({
  dir,
  maxBytes,
  manifest,
  strict
}) => {
  const sources = resolveGraphSources({
    dir,
    name: 'graph_relations',
    maxBytes,
    manifest,
    strict,
    required: true
  });
  const jsonPayload = readSingleJsonSource({
    sources,
    maxBytes,
    name: 'graph_relations'
  });
  if (jsonPayload.ok) {
    return { isJson: true, jsonPayload: jsonPayload.payload, payload: null, sources: null, readOptions: null };
  }
  return {
    isJson: false,
    jsonPayload: null,
    payload: createGraphRelationsShell(sources.meta || null),
    sources,
    readOptions: {
      maxBytes,
      requiredKeys: resolveJsonlRequiredKeys('graph_relations'),
      validationMode: strict ? 'strict' : 'trusted'
    }
  };
};

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
  const plan = resolveGraphRelationsReadPlan({
    dir,
    maxBytes,
    manifest,
    strict
  });
  if (plan.isJson) return plan.jsonPayload;
  for (const partPath of plan.sources.paths) {
    for await (const entry of readJsonLinesIterator(partPath, plan.readOptions)) {
      appendGraphRelationsEntry(plan.payload, entry, partPath);
    }
  }
  return finalizeGraphRelations(plan.payload);
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
  const sources = resolveGraphSources({
    dir,
    name: 'graph_relations_csr',
    maxBytes,
    manifest,
    strict,
    required: false
  });
  return loadGraphRelationsCsrPayload({ sources, maxBytes, strict });
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
  const plan = resolveGraphRelationsReadPlan({
    dir,
    maxBytes,
    manifest,
    strict
  });
  if (plan.isJson) return plan.jsonPayload;
  for (const partPath of plan.sources.paths) {
    appendGraphRelationsEntries(
      plan.payload,
      readJsonLinesArraySync(partPath, plan.readOptions),
      partPath
    );
  }
  return finalizeGraphRelations(plan.payload);
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
  const sources = resolveGraphSources({
    dir,
    name: 'graph_relations_csr',
    maxBytes,
    manifest,
    strict,
    required: false
  });
  return loadGraphRelationsCsrPayload({ sources, maxBytes, strict });
};
