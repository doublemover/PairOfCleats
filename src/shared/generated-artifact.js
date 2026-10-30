import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseTree } from 'jsonc-parser';
import { withContainedFile } from './contained-file.js';
import { describeStorageFailure, observeStorageResource } from './storage/failure-observation.js';
import { classifyGeneratedArtifactCorePrefix, isGeneratedArtifactCoreCandidatePath } from './generated-artifact-core.js';
import { classifyGeneratedArtifactCachePrefix, isGeneratedArtifactCacheCandidatePath } from './generated-artifact-cache.js';
import { MAP_MODEL_VERSION } from '../map/model-version.js';
import { hasAmbiguousGeneratedArtifactPrefix } from './generated-artifact-prefix.js';
import { GENERATED_ARTIFACT_PREFIX_BYTES, createGeneratedArtifactPrefixObservation,
  resolveGeneratedArtifactPrefixObservation, isGeneratedArtifactPrefixObservation } from './generated-artifact-observation.js';
import { throwIfAborted } from './abort.js';
import { addStorageFailureContext } from './storage/operation-error.js';

export { GENERATED_ARTIFACT_PREFIX_BYTES, GENERATED_ARTIFACT_POLICY_VERSION } from './generated-artifact-observation.js';
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

const parseMapHeader = (text, key = null) => {
  const match = /^\s*\{\s*"__poc_generated"\s*:\s*(\{[^{}]*\})\s*,\s*"data"\s*:\s*\{/.exec(text);
  if (!match) return false;
  try {
    const keys = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)]
      .map(entry => JSON.parse(`"${entry[1]}"`)).sort();
    if (keys.join(',') !== HEADER_KEYS.join(',')) return false;
    const header = JSON.parse(match[1]);
    if (!/^[a-f0-9]{64}$/.test(header.key || '') || !isMapHeader(header, key || header.key)) return false;
    return { header, dataOffset: match[0].length - 1 };
  } catch { return false; }
};

const hasMapModelHeader = (text, repoRoot = null, versions = ['1.0.0', MAP_MODEL_VERSION]) => {
  const nodes = /"nodes"\s*:\s*\[/.exec(text);
  if (!nodes) return false;
  try {
    const headerText = `${text.slice(0, nodes.index).trimEnd().replace(/,$/, '')}}`;
    if (hasDuplicateKeys(headerText)) return false;
    const header = JSON.parse(headerText);
    if (Object.keys(header).sort().join(',') !== LEGACY_HEADER_KEYS.join(',')) return false;
    return versions.includes(header.version) && Number.isFinite(Date.parse(header.generatedAt))
      && typeof header.root?.path === 'string'
      && (!repoRoot || path.resolve(header.root.path) === path.resolve(repoRoot))
      && typeof header.root?.id === 'string'
      && ['code', 'prose', 'both'].includes(header.mode)
      && header.options && Array.isArray(header.options.include)
      && header.legend && typeof header.legend === 'object';
  } catch { return false; }
};

/** Recognize a renamed owned cache from bytes already read for normal indexing. */
export const classifyGeneratedArtifactContentPrefix = ({ prefix }) => {
  const lead = isGeneratedArtifactPrefixObservation(prefix) ? prefix.text?.slice(0, 512) || ''
    : Buffer.isBuffer(prefix) ? prefix.subarray(0, 512).toString('utf8') : typeof prefix === 'string' ? prefix.slice(0, 512) : '';
  if (!/^\s*\{\s*"(?:extensions|__poc_generated)"\s*:/.test(lead)) return null;
  const observation = resolveGeneratedArtifactPrefixObservation(prefix);
  if (!observation || observation.text === null) return null;
  prefix = observation;
  if (/^\s*\{\s*"extensions"\s*:/.test(lead)) return classifyGeneratedArtifactCorePrefix({ prefix });
  if (!/^\s*\{\s*"__poc_generated"\s*:/.test(lead)) return null;
  const cache = classifyGeneratedArtifactCachePrefix({ prefix });
  if (cache) return cache;
  const { text, complete } = observation;
  const parsed = parseMapHeader(text);
  if (!parsed || hasAmbiguousGeneratedArtifactPrefix(text, complete) || !hasMapModelHeader(text.slice(parsed.dataOffset))) return null;
  return { kind: MAP_KIND, format: FORMAT, flags: GENERATED_ARTIFACT_FLAGS.OMIT, action: 'omit' };
};

export const isGeneratedArtifactCandidatePath = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return MAP_NAME.test(path.posix.basename(normalized)) || LEGACY_MAP_PATH.test(normalized)
    || isGeneratedArtifactCoreCandidatePath(normalized) || isGeneratedArtifactCacheCandidatePath(normalized);
};

/** Classify only this file. Marker data never names exclusions or grants trust. */
export const classifyGeneratedArtifactPrefix = ({ relativePath, prefix, repoRoot }) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const name = MAP_NAME.exec(path.posix.basename(normalized));
  const observation = resolveGeneratedArtifactPrefixObservation(prefix);
  if (!observation || observation.text === null) return null;
  const { text, complete } = observation;
  prefix = observation;
  if (name) {
    // Cache writers put the small reserved header first, ahead of the payload.
    // The anchored JSON field structure cannot match a quoted example elsewhere.
    if (!parseMapHeader(text, name[1]) || hasAmbiguousGeneratedArtifactPrefix(text, complete)) return null;
    return { kind: MAP_KIND, format: FORMAT, flags: GENERATED_ARTIFACT_FLAGS.OMIT, action: 'omit' };
  }
  if (!LEGACY_MAP_PATH.test(normalized)) {
    return classifyGeneratedArtifactCorePrefix({ relativePath: normalized, prefix })
      || classifyGeneratedArtifactCachePrefix({ relativePath: normalized, prefix });
  }
  // Historical caches have no reserved header. Require their exact old location,
  // canonical key filename and recognizable map header; authored siblings survive.
  if (typeof repoRoot !== 'string' || !repoRoot || hasAmbiguousGeneratedArtifactPrefix(text, complete)
    || !hasMapModelHeader(text, repoRoot, ['1.0.0'])) return null;
  return { kind: MAP_KIND, format: 'legacy-code-map@1', flags: GENERATED_ARTIFACT_FLAGS.OMIT, action: 'omit' };
};

const changedPrefix = () => Object.assign(new Error('Generated-artifact prefix changed during its descriptor borrow.'), { code: 'ERR_FILE_CHANGED' });
export const readGeneratedArtifactPrefix = (repoRoot, filePath, maxBytes = GENERATED_ARTIFACT_PREFIX_BYTES, { signal = null } = {}) => {
  if (maxBytes !== GENERATED_ARTIFACT_PREFIX_BYTES) throw new TypeError('Generated prefix reads require their fixed byte allowance.');
  throwIfAborted(signal);
  return withContainedFile(repoRoot, filePath, async descriptor => {
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || typeof before.size !== 'bigint' || before.size < 0n) throw changedPrefix();
    const extent = Number(before.size < BigInt(maxBytes) ? before.size : BigInt(maxBytes));
    const buffer = Buffer.alloc(extent);
    let position = 0;
    while (position < extent) {
      throwIfAborted(signal);
      const allowance = extent - position;
      const { bytesRead } = await descriptor.read(buffer, position, allowance, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > allowance) throw changedPrefix();
      position += bytesRead;
    }
    const after = await descriptor.stat({ bigint: true });
    if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink']
      .some(key => before[key] !== after[key])) throw changedPrefix();
    descriptor.verify();
    throwIfAborted(signal);
    return createGeneratedArtifactPrefixObservation({ bytes: buffer, sourceBytes: before.size });
  }, { signal });
};

export const inspectGeneratedArtifact = async ({
  repoRoot, filePath, relativePath, readPrefix: reader = readGeneratedArtifactPrefix, signal = null
}) => {
  if (!isGeneratedArtifactCandidatePath(relativePath)) return null;
  try {
    const prefix = await reader(repoRoot, filePath, GENERATED_ARTIFACT_PREFIX_BYTES, { signal });
    const observation = observeStorageResource(prefix, { phase: 'generated-artifact-prefix-result' });
    observation.requireSettled();
    if (!isGeneratedArtifactPrefixObservation(prefix)) return null;
    let result;
    try { result = classifyGeneratedArtifactPrefix({ repoRoot, relativePath, prefix }); }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    return result;
  } catch (error) {
    describeStorageFailure(error, { phase: 'generated-artifact-prefix', defaultCode: 'ERR_GENERATED_ARTIFACT_PREFIX' });
    try { throwIfAborted(signal); }
    catch (abortError) { throw addStorageFailureContext(abortError, {}, error, { secondaryPresent: true }); }
    // Failed classification is not permission to discard an authored input.
    return null;
  }
};
