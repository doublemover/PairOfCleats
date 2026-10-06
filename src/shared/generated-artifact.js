import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseTree } from 'jsonc-parser';
import { openContainedFile } from './contained-file.js';

export const GENERATED_ARTIFACT_PREFIX_BYTES = 8192;
export const GENERATED_ARTIFACT_FLAGS = Object.freeze({ OMIT: 1, WARN: 2 });
const FORMAT = 'poc.generated@1';
const MAP_KIND = 'code-map-cache';
const MAP_NAME = /^poc-code-map-cache-v1-([a-f0-9]{64})\.json$/;
const LEGACY_MAP_PATH = /^\.pairofcleats\/maps\/cache\/code-map:lk1:[a-f0-9]{40}\.json$/;
const HEADER_KEYS = ['flags', 'format', 'key', 'kind'];
const LEGACY_HEADER_KEYS = ['generatedAt', 'legend', 'mode', 'options', 'root', 'version'];

const hasDuplicateKeys = (text) => {
  const errors = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) return true;
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
    for (const child of node.children || []) pending.push(child);
  }
  return false;
};

export const generatedMapCacheIdentity = (cacheKey) => {
  const key = createHash('sha256').update(String(cacheKey)).digest('hex');
  return { key, fileName: `poc-code-map-cache-v1-${key}.json` };
};

export const createMapCacheEnvelope = (model, key) => ({
  __poc_generated: { format: FORMAT, kind: MAP_KIND, flags: GENERATED_ARTIFACT_FLAGS.OMIT, key },
  data: model
});

const isMapHeader = (header, key) => Boolean(
  header && typeof header === 'object' && !Array.isArray(header)
  && Object.keys(header).sort().join(',') === HEADER_KEYS.join(',')
  && header.format === FORMAT && header.kind === MAP_KIND
  && header.flags === GENERATED_ARTIFACT_FLAGS.OMIT && header.key === key
);

export const readMapCacheEnvelope = (payload, key) => (
  isMapHeader(payload?.__poc_generated, key)
    && payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data : null
);

const parseMapHeader = (text, key) => {
  const match = /^\s*\{\s*"__poc_generated"\s*:\s*(\{[^{}]*\})\s*,\s*"data"\s*:\s*\{/.exec(text);
  if (!match) return false;
  try {
    const keys = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)]
      .map(entry => JSON.parse(`"${entry[1]}"`)).sort();
    if (keys.join(',') !== HEADER_KEYS.join(',')) return false;
    return isMapHeader(JSON.parse(match[1]), key);
  } catch { return false; }
};

export const isGeneratedArtifactCandidatePath = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return MAP_NAME.test(path.posix.basename(normalized)) || LEGACY_MAP_PATH.test(normalized);
};

/** Classify only this file. Marker data never names exclusions or grants trust. */
export const classifyGeneratedArtifactPrefix = ({ relativePath, prefix, repoRoot }) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const name = MAP_NAME.exec(path.posix.basename(normalized));
  const text = Buffer.isBuffer(prefix)
    ? prefix.subarray(0, GENERATED_ARTIFACT_PREFIX_BYTES).toString('utf8')
    : String(prefix || '').slice(0, GENERATED_ARTIFACT_PREFIX_BYTES);
  if (name) {
    // Cache writers put the small reserved header first, ahead of the payload.
    // The anchored JSON field structure cannot match a quoted example elsewhere.
    if (!parseMapHeader(text, name[1])) return null;
    return { kind: MAP_KIND, format: FORMAT, flags: GENERATED_ARTIFACT_FLAGS.OMIT, action: 'omit' };
  }
  if (!LEGACY_MAP_PATH.test(normalized)) return null;
  // Historical caches have no reserved header. Require their exact old location,
  // canonical key filename and recognizable map header; authored siblings survive.
  const nodes = /"nodes"\s*:\s*\[/.exec(text);
  if (!nodes) return null;
  try {
    const headerText = `${text.slice(0, nodes.index).trimEnd().replace(/,$/, '')}}`;
    if (hasDuplicateKeys(headerText)) return null;
    const header = JSON.parse(headerText);
    if (Object.keys(header).sort().join(',') !== LEGACY_HEADER_KEYS.join(',')) return null;
    if (header.version !== '1.0.0' || !Number.isFinite(Date.parse(header.generatedAt))
      || typeof header.root?.path !== 'string'
      || path.resolve(header.root.path) !== path.resolve(repoRoot)
      || typeof header.root?.id !== 'string'
      || !['code', 'prose', 'both'].includes(header.mode)
      || !header.options || !Array.isArray(header.options.include)
      || !header.legend || typeof header.legend !== 'object') return null;
  } catch { return null; }
  return { kind: MAP_KIND, format: 'legacy-code-map@1', flags: GENERATED_ARTIFACT_FLAGS.OMIT, action: 'omit' };
};

const readPrefix = async (repoRoot, filePath, maxBytes) => {
  const handle = await openContainedFile(repoRoot, filePath);
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

export const inspectGeneratedArtifact = async ({
  repoRoot, filePath, relativePath, readPrefix: reader = readPrefix
}) => {
  if (!isGeneratedArtifactCandidatePath(relativePath)) return null;
  try {
    const prefix = await reader(repoRoot, filePath, GENERATED_ARTIFACT_PREFIX_BYTES);
    return classifyGeneratedArtifactPrefix({ repoRoot, relativePath, prefix });
  } catch {
    // Failed classification is not permission to discard an authored input.
    return null;
  }
};
