import path from 'node:path';
import { parseTree } from 'jsonc-parser';

const FORMAT = 'poc.generated@1';
const KIND = 'object-cache';
const OMIT = 1;
const PREFIX_BYTES = 8192;
const FIXED_NAMES = new Map([
  ['cross-file-inference', 'output-cache.json'],
  ['import-resolution', 'import-resolution-cache.json'],
  ['import-resolution-persist-failure', 'import-resolution-cache.json.fail-open.json'],
  ['scm-file-meta', 'file-meta-v1.json'],
  ['lsp-requests', 'request-cache-v1.json'],
  ['learned-auto-profile', 'learned-auto-profile.json'],
  ['scheduler-autotune', 'scheduler-autotune.json'],
  ['tree-sitter-adaptive-profile', 'adaptive-rows-per-sec.json'],
  ['embeddings-autotune', 'embeddings-autotune.json'],
  ['enrichment-state', 'enrichment_state.json']
]);
const REGISTERED_ARTIFACTS = new Set([
  ...FIXED_NAMES.keys(), 'tree-sitter-chunks', 'command-probe',
  'workspace-preflight', 'pyright-planner-health', 'pyright-runtime-health'
]);
const HASH_JSON_NAME = /^[a-f0-9]{40}\.json$/;
const CHUNK_CACHE_NAME = /^tree-sitter-chunk_lk1_[a-f0-9]{40}\.json$/;
const isObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Only audited fixed-root object producers call this; never use it for a root map. */
export const withGeneratedCacheMetadata = (fields, artifact) => {
  if (!isObject(fields) || !REGISTERED_ARTIFACTS.has(artifact)) return fields;
  const { __poc_generated: previous, ...payload } = fields;
  void previous;
  return {
    __poc_generated: { format: FORMAT, kind: KIND, flags: OMIT, artifact },
    ...payload
  };
};

export const isGeneratedCacheMetadata = (header) => Boolean(
  isObject(header)
  && Object.keys(header).sort().join(',') === 'artifact,flags,format,kind'
  && header.format === FORMAT && header.kind === KIND && header.flags === OMIT
  && REGISTERED_ARTIFACTS.has(header.artifact)
);

/** Keep persistence-only metadata out of APIs that return the complete payload. */
export const withoutGeneratedCacheMetadata = (fields) => {
  if (!isGeneratedCacheMetadata(fields?.__poc_generated)) return fields;
  const { __poc_generated: marker, ...payload } = fields;
  void marker;
  return payload;
};

const candidateArtifacts = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const name = path.posix.basename(normalized);
  const dir = path.posix.dirname(normalized);
  const parent = path.posix.basename(dir);
  const grandparent = path.posix.basename(path.posix.dirname(dir));
  const candidates = [];
  for (const [artifact, fileName] of FIXED_NAMES) {
    if (name !== fileName) continue;
    if (artifact === 'cross-file-inference' && parent !== 'cross-file-inference') continue;
    if (artifact === 'scm-file-meta' && parent !== 'scm') continue;
    if (artifact === 'lsp-requests' && parent !== 'lsp') continue;
    candidates.push(artifact);
  }
  if (CHUNK_CACHE_NAME.test(name)) candidates.push('tree-sitter-chunks');
  if (HASH_JSON_NAME.test(name)) {
    if (parent === 'command-probes') candidates.push('command-probe');
    if (parent === 'pyright-planner') candidates.push('pyright-planner-health');
    if (parent === 'pyright-runtime') candidates.push('pyright-runtime-health');
  }
  if (/^[a-z0-9._-]+\.json$/.test(name)
    && (parent === 'workspace-preflight'
      || (grandparent === 'workspace-preflight' && /^[a-f0-9]{40}$/.test(parent)))) {
    candidates.push('workspace-preflight');
  }
  return candidates;
};

export const isGeneratedArtifactCacheCandidatePath = (relativePath) => candidateArtifacts(relativePath).length > 0;

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

/** Classify this cache object only. No field nominates another file or directory. */
export const classifyGeneratedArtifactCachePrefix = ({ relativePath = null, prefix }) => {
  const candidates = relativePath == null ? null : candidateArtifacts(relativePath);
  if (candidates && !candidates.length) return null;
  const bytes = Buffer.isBuffer(prefix)
    ? prefix.subarray(0, PREFIX_BYTES)
    : Buffer.from(String(prefix || '').slice(0, PREFIX_BYTES), 'utf8').subarray(0, PREFIX_BYTES);
  const text = bytes.toString('utf8');
  const match = /^\s*\{\s*"__poc_generated"\s*:\s*(\{[^{}]{0,512}\})\s*,/.exec(text);
  if (!match) return null;
  try {
    const header = JSON.parse(match[1]);
    if (!isGeneratedCacheMetadata(header) || (candidates && !candidates.includes(header.artifact))) return null;
    if (hasAmbiguousJsonPrefix(text, bytes.length < PREFIX_BYTES)) return null;
    return { ...header, action: 'omit' };
  } catch {
    return null;
  }
};
