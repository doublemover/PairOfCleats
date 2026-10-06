import path from 'node:path';
import { parseTree } from 'jsonc-parser';

const FORMAT = 'poc.generated@1';
const PREFIX_BYTES = 8192;
const OMIT = 1;
const SHARDED_ARTIFACTS = new Set([
  'file_meta', 'chunk_meta', 'chunk_meta_cold', 'chunk_uid_map',
  'vfs_manifest', 'vfs_path_map', 'field_tokens', 'file_relations',
  'symbols', 'symbol_occurrences', 'symbol_edges', 'call_sites',
  'risk_summaries', 'risk_flows', 'risk_partial_flows', 'repo_map', 'graph_relations'
]);
const VECTOR_ARTIFACTS = new Set([
  'dense_vectors_uint8', 'dense_vectors_doc_uint8', 'dense_vectors_code_uint8'
]);
const SIMPLE_KINDS = new Map([
  ['pieces-manifest', ['manifest.json', 'manifest.json.bak']],
  ['index-state', ['index_state.json']],
  ['index-state-meta', ['index_state.meta.json']],
  ['builds-current', ['current.json']],
  ['token-postings-meta', ['token_postings.meta.json']]
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isRegistered = (kind, artifact) => (
  (SIMPLE_KINDS.has(kind) && artifact == null)
  || (kind === 'sharded-meta' && SHARDED_ARTIFACTS.has(artifact))
  || (kind === 'file-meta' && artifact === 'file_meta')
  || (kind === 'dense-vector-meta' && VECTOR_ARTIFACTS.has(artifact))
);

/**
 * Stamp only explicit, registered metadata producers. The marker is static so it
 * participates in stable hashes without reintroducing volatile build identity.
 * Neither this declaration nor any payload path authorizes omission of members.
 * Unknown families remain unmarked; generic JSON and native writers do not call this.
 */
export const withGeneratedArtifactMetadata = (fields, kind, artifact = null) => {
  if (!isObject(fields) || !isRegistered(kind, artifact)) return fields;
  const { extensions, ...rest } = fields;
  const { __poc_generated: previous, ...preserved } = isObject(extensions) ? extensions : {};
  void previous;
  return {
    extensions: {
      __poc_generated: {
        format: FORMAT,
        kind,
        flags: OMIT,
        ...(artifact != null ? { artifact } : {})
      },
      ...preserved
    },
    ...rest
  };
};

/** Marker validation does not authenticate content or make referenced paths trusted. */
export const isGeneratedArtifactMetadata = (header, kind, artifact = null) => {
  if (!isObject(header) || !isRegistered(kind, artifact)) return false;
  const expectedKeys = artifact == null ? 'flags,format,kind' : 'artifact,flags,format,kind';
  return Object.keys(header).sort().join(',') === expectedKeys
    && header.format === FORMAT && header.kind === kind && header.flags === OMIT
    && (artifact == null || header.artifact === artifact);
};

const metadataCandidates = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const name = path.posix.basename(normalized);
  const parent = path.posix.basename(path.posix.dirname(normalized));
  const candidates = [];
  for (const [kind, names] of SIMPLE_KINDS) {
    if (!names.includes(name)) continue;
    if (kind === 'pieces-manifest' && parent !== 'pieces') continue;
    if (kind === 'builds-current' && parent !== 'builds') continue;
    candidates.push([kind, null]);
  }
  if (name.endsWith('.meta.json')) {
    const artifact = name.slice(0, -'.meta.json'.length);
    if (SHARDED_ARTIFACTS.has(artifact)) candidates.push(['sharded-meta', artifact]);
    if (artifact === 'file_meta') candidates.push(['file-meta', artifact]);
    if (VECTOR_ARTIFACTS.has(artifact)) candidates.push(['dense-vector-meta', artifact]);
  }
  return candidates;
};

export const isGeneratedArtifactCoreCandidatePath = (relativePath) => metadataCandidates(relativePath).length > 0;

const hasAmbiguousJsonPrefix = (text, complete) => {
  const errors = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || tree.type !== 'object' || (complete && errors.length)) return true;
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'object') {
      const keys = new Set();
      for (const property of node.children || []) {
        const key = property.children?.[0]?.value;
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
    pending.push(...(node.children || []));
  }
  return false;
};

/** Classify this metadata file only, from the bounded first-field declaration. */
export const classifyGeneratedArtifactCorePrefix = ({ relativePath = null, prefix }) => {
  const candidates = relativePath == null ? null : metadataCandidates(relativePath);
  if (candidates && !candidates.length) return null;
  const bytes = Buffer.isBuffer(prefix)
    ? prefix.subarray(0, PREFIX_BYTES)
    : Buffer.from(String(prefix || '').slice(0, PREFIX_BYTES), 'utf8').subarray(0, PREFIX_BYTES);
  const text = bytes.toString('utf8');
  const match = /^\s*\{\s*"extensions"\s*:\s*\{\s*"__poc_generated"\s*:\s*(\{[^{}]{0,512}\})\s*[,}]/.exec(text);
  if (!match) return null;
  try {
    // Complete short documents must be valid JSON. For larger outputs, only the
    // bounded prefix is available; reject duplicate keys visible in that prefix.
    if (hasAmbiguousJsonPrefix(text, bytes.length < PREFIX_BYTES)) return null;
    const header = JSON.parse(match[1]);
    const keys = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)]
      .map((entry) => JSON.parse(`"${entry[1]}"`)).sort();
    if (keys.join(',') !== Object.keys(header).sort().join(',')) return null;
    for (const [kind, artifact] of candidates || [[header.kind, header.artifact ?? null]]) {
      if (isGeneratedArtifactMetadata(header, kind, artifact)) {
        return { ...header, action: 'omit' };
      }
    }
  } catch {}
  return null;
};
