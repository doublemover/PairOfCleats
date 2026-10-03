import { stableStringify } from './stable-json.js';
import { BUNDLE_PATCH_FIELD_KEYS } from './bundle-io-constants.js';

export const stableEquals = (left, right) => {
  if (left === right) return true;
  try {
    return stableStringify(left ?? null) === stableStringify(right ?? null);
  } catch {
    return false;
  }
};

export const buildChunkPatch = (previousChunks, nextChunks) => {
  const before = Array.isArray(previousChunks) ? previousChunks : [];
  const after = Array.isArray(nextChunks) ? nextChunks : [];
  const minLength = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < minLength && stableEquals(before[prefix], after[prefix])) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < (minLength - prefix)
    && stableEquals(
      before[before.length - 1 - suffix],
      after[after.length - 1 - suffix]
    )
  ) {
    suffix += 1;
  }
  const deleteCount = Math.max(0, before.length - prefix - suffix);
  const insertEnd = Math.max(prefix, after.length - suffix);
  const items = after.slice(prefix, insertEnd);
  if (deleteCount === 0 && items.length === 0) return null;
  return {
    start: prefix,
    deleteCount,
    items
  };
};

export const buildBundlePatchPayload = ({ previousBundle, nextBundle }) => {
  if (!previousBundle || !nextBundle) return null;
  const set = {};
  let setCount = 0;
  for (const key of BUNDLE_PATCH_FIELD_KEYS) {
    const before = previousBundle[key];
    const after = nextBundle[key];
    if (stableEquals(before, after)) continue;
    set[key] = after ?? null;
    setCount += 1;
  }
  const chunks = buildChunkPatch(previousBundle.chunks, nextBundle.chunks);
  if (!chunks && setCount === 0) return null;
  return {
    chunks: chunks || null,
    set: setCount > 0 ? set : null
  };
};
