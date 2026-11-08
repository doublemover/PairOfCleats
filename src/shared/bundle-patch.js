import { stableStringify } from './stable-json.js';
import { BUNDLE_PATCH_FIELD_KEYS } from './bundle-io-constants.js';
import { canonicalizeBundlePayloadForChecksum } from './bundle-checksum.js';

export const stableEquals = (left, right) => {
  if (left === right) return true;
  try {
    return stableStringify(canonicalizeBundlePayloadForChecksum(left,{typedArraysBeforeToJSON:true}))
      === stableStringify(canonicalizeBundlePayloadForChecksum(right,{typedArraysBeforeToJSON:true}));
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
  const previous=canonicalizeBundlePayloadForChecksum(previousBundle,{typedArraysBeforeToJSON:true});
  const next=canonicalizeBundlePayloadForChecksum(nextBundle,{typedArraysBeforeToJSON:true});
  const supported=new Set(['chunks',...BUNDLE_PATCH_FIELD_KEYS]);
  for(const key of new Set([...Object.keys(previous),...Object.keys(next)])) {
    if(!supported.has(key) && !stableEquals(previous[key],next[key])) return {requiresFullRewrite:true,field:key};
  }
  const set = Object.create(null), unset=[];
  let setCount = 0;
  for (const key of BUNDLE_PATCH_FIELD_KEYS) {
    const before = previous[key];
    const after = next[key];
    const beforePresent=Object.hasOwn(previous,key), afterPresent=Object.hasOwn(next,key);
    if (beforePresent === afterPresent && stableEquals(before, after)) continue;
    if(!afterPresent) {unset.push(key);continue;}
    set[key] = after;
    setCount += 1;
  }
  const chunks = buildChunkPatch(previous.chunks, next.chunks);
  if (!chunks && setCount === 0 && unset.length === 0) return null;
  return {
    chunks: chunks || null,
    set: setCount > 0 ? set : null,
    unset:unset.length ? unset : null
  };
};
