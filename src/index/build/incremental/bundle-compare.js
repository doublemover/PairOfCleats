import { sha1 } from '../../../shared/hash.js';

/**
 * Build a recursively key-sorted clone for stable object signatures.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
const buildCanonicalSignatureValue = (value, seen = new WeakSet()) => {
  if (Array.isArray(value)) {
    return value.map((entry) => buildCanonicalSignatureValue(entry, seen));
  }
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  if (seen.has(value)) return null;
  seen.add(value);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = buildCanonicalSignatureValue(value[key], seen);
  }
  seen.delete(value);
  return out;
};

const buildStableJsonSignature = (value) => {
  try {
    return JSON.stringify(buildCanonicalSignatureValue(value ?? null));
  } catch {
    return '';
  }
};

const buildBundleMetaReuseSignature = (metaV2) => {
  if (!metaV2 || typeof metaV2 !== 'object') return '';
  const selected = {
    chunkId: metaV2.chunkId ?? null,
    file: metaV2.file ?? null,
    range: metaV2.range ?? null,
    lang: metaV2.lang ?? null,
    ext: metaV2.ext ?? null,
    types: metaV2.types ?? null,
    relations: metaV2.relations ?? null,
    segment: metaV2.segment ?? null
  };
  const payload = buildStableJsonSignature(selected);
  return payload ? sha1(payload) : '';
};

const buildChunkReuseSignature = (chunks) => (
  Array.isArray(chunks)
    ? chunks.map((chunk) => {
      const chunkId = chunk?.chunkId || chunk?.chunkUid || '';
      const docId = Number.isFinite(chunk?.id) ? Math.floor(chunk.id) : '';
      const start = Number(chunk?.start) || 0;
      const end = Number(chunk?.end) || 0;
      const hash = typeof chunk?.hash === 'string' ? chunk.hash : '';
      const textLength = typeof chunk?.text === 'string' ? chunk.text.length : 0;
      const metaSignature = buildBundleMetaReuseSignature(chunk?.metaV2);
      return `${chunkId}:${docId}:${start}:${end}:${hash}:${textLength}:${metaSignature}`;
    }).join('|')
    : ''
);

export const shouldReuseExistingBundle = (existingBundle, nextBundle) => {
  if (!existingBundle || !nextBundle) return false;
  if (existingBundle.hash !== nextBundle.hash) return false;
  if (existingBundle.mtimeMs !== nextBundle.mtimeMs) return false;
  if (existingBundle.size !== nextBundle.size) return false;
  if (buildChunkReuseSignature(existingBundle.chunks) !== buildChunkReuseSignature(nextBundle.chunks)) {
    return false;
  }
  if (buildStableJsonSignature(existingBundle.fileRelations) !== buildStableJsonSignature(nextBundle.fileRelations)) {
    return false;
  }
  if (buildStableJsonSignature(existingBundle.vfsManifestRows) !== buildStableJsonSignature(nextBundle.vfsManifestRows)) {
    return false;
  }
  if ((existingBundle.encoding || null) !== (nextBundle.encoding || null)) return false;
  if ((existingBundle.encodingFallback || null) !== (nextBundle.encodingFallback || null)) return false;
  if ((existingBundle.encodingConfidence || null) !== (nextBundle.encodingConfidence || null)) return false;
  return true;
};
