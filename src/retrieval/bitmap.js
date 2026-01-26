import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DEFAULT_MIN_SIZE = 256;
let roaringLib = null;
let roaringChecked = false;

const resolveRoaring = () => {
  if (roaringChecked) return roaringLib;
  roaringChecked = true;
  try {
    roaringLib = require('roaring-wasm');
  } catch {
    roaringLib = null;
  }
  return roaringLib;
};

const resolveBitmapClass = () => {
  const lib = resolveRoaring();
  if (!lib) return null;
  return lib.RoaringBitmap32
    || lib.RoaringBitmap
    || lib.default?.RoaringBitmap32
    || lib.default?.RoaringBitmap
    || lib.default
    || null;
};

const normalizeIds = (values) => {
  if (!values) return [];
  const list = Array.isArray(values) ? values : Array.from(values);
  const ids = [];
  for (const value of list) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    const id = Math.floor(parsed);
    if (id < 0) continue;
    ids.push(id);
  }
  ids.sort((a, b) => a - b);
  const deduped = [];
  let last = null;
  for (const id of ids) {
    if (id === last) continue;
    deduped.push(id);
    last = id;
  }
  return deduped;
};

const cloneBitmap = (bitmap) => {
  if (!bitmap) return null;
  if (typeof bitmap.clone === 'function') return bitmap.clone();
  const ids = bitmapToArray(bitmap);
  return createBitmapFromIds(ids, { force: true });
};

const bitmapHas = (bitmap, value) => {
  if (!bitmap) return false;
  if (typeof bitmap.has === 'function') return bitmap.has(value);
  if (typeof bitmap.contains === 'function') return bitmap.contains(value);
  if (typeof bitmap.includes === 'function') return bitmap.includes(value);
  return false;
};

const getBitmapSize = (bitmap) => {
  if (!bitmap) return 0;
  if (Number.isFinite(bitmap.size)) return bitmap.size;
  if (typeof bitmap.size === 'function') return bitmap.size();
  if (typeof bitmap.getSize === 'function') return bitmap.getSize();
  return bitmapToArray(bitmap).length;
};

export const isBitmapEmpty = (bitmap) => getBitmapSize(bitmap) === 0;

export const isRoaringAvailable = () => Boolean(resolveBitmapClass());

export const shouldUseBitmap = (size, minSize = DEFAULT_MIN_SIZE) => (
  Number.isFinite(size) && size >= minSize
);

export const bitmapToArray = (bitmap) => {
  if (!bitmap) return [];
  if (typeof bitmap.toArray === 'function') return bitmap.toArray();
  if (typeof bitmap.toArraySync === 'function') return bitmap.toArraySync();
  if (typeof bitmap.values === 'function') return Array.from(bitmap.values());
  return Array.from(bitmap || []);
};

export const bitmapToSet = (bitmap) => new Set(bitmapToArray(bitmap));

export const createBitmapFromIds = (values, options = {}) => {
  const Bitmap = resolveBitmapClass();
  if (!Bitmap) return null;
  const minSize = Number.isFinite(Number(options.minSize))
    ? Math.max(1, Math.floor(Number(options.minSize)))
    : DEFAULT_MIN_SIZE;
  const force = options.force === true;
  const ids = normalizeIds(values);
  if (!ids.length) return null;
  if (!force && !shouldUseBitmap(ids.length, minSize)) return null;
  let bitmap = null;
  if (typeof Bitmap.from === 'function') {
    bitmap = Bitmap.from(ids);
  } else {
    bitmap = new Bitmap();
    if (typeof bitmap.addMany === 'function') {
      bitmap.addMany(ids);
    } else {
      for (const id of ids) bitmap.add(id);
    }
  }
  return bitmap;
};

export const unionBitmaps = (bitmaps) => {
  if (!Array.isArray(bitmaps) || !bitmaps.length) return null;
  let acc = cloneBitmap(bitmaps[0]);
  for (let i = 1; i < bitmaps.length; i += 1) {
    const next = bitmaps[i];
    if (!next || !acc) continue;
    if (typeof acc.orInPlace === 'function') {
      acc.orInPlace(next);
    } else if (typeof acc.or === 'function') {
      acc = acc.or(next);
    } else if (typeof acc.union === 'function') {
      acc = acc.union(next);
    } else {
      const merged = [...bitmapToArray(acc), ...bitmapToArray(next)];
      acc = createBitmapFromIds(merged, { force: true });
    }
  }
  return acc;
};

export const intersectBitmaps = (bitmaps) => {
  if (!Array.isArray(bitmaps) || !bitmaps.length) return null;
  let acc = cloneBitmap(bitmaps[0]);
  for (let i = 1; i < bitmaps.length; i += 1) {
    const next = bitmaps[i];
    if (!next || !acc) continue;
    if (typeof acc.andInPlace === 'function') {
      acc.andInPlace(next);
    } else if (typeof acc.and === 'function') {
      acc = acc.and(next);
    } else if (typeof acc.intersect === 'function') {
      acc = acc.intersect(next);
    } else {
      const left = bitmapToArray(acc);
      const right = new Set(bitmapToArray(next));
      const merged = [];
      for (const id of left) {
        if (right.has(id)) merged.push(id);
      }
      acc = createBitmapFromIds(merged, { force: true });
    }
    if (!acc || isBitmapEmpty(acc)) return acc;
  }
  return acc;
};

export const intersectSetWithBitmap = (set, bitmap) => {
  const out = new Set();
  if (!set || !bitmap) return out;
  const hasMethod = typeof bitmap.has === 'function'
    || typeof bitmap.contains === 'function'
    || typeof bitmap.includes === 'function';
  if (!hasMethod) {
    const bitmapSet = bitmapToSet(bitmap);
    for (const id of set) {
      if (bitmapSet.has(id)) out.add(id);
    }
    return out;
  }
  for (const id of set) {
    if (bitmapHas(bitmap, id)) out.add(id);
  }
  return out;
};

export const buildBitmapIndex = (index, options = {}) => {
  const Bitmap = resolveBitmapClass();
  if (!Bitmap || !index) return null;
  const minSize = Number.isFinite(Number(options.minSize))
    ? Math.max(1, Math.floor(Number(options.minSize)))
    : DEFAULT_MIN_SIZE;
  const buildMap = (source) => {
    const out = new Map();
    if (!source || typeof source.entries !== 'function') return out;
    for (const [key, set] of source.entries()) {
      if (!set || !shouldUseBitmap(set.size, minSize)) continue;
      const bitmap = createBitmapFromIds(set, { force: true, minSize });
      if (bitmap) out.set(key, bitmap);
    }
    return out;
  };
  return {
    enabled: true,
    minSize,
    byExt: buildMap(index.byExt),
    byLang: buildMap(index.byLang),
    byKind: buildMap(index.byKind),
    byAuthor: buildMap(index.byAuthor),
    byChunkAuthor: buildMap(index.byChunkAuthor),
    byVisibility: buildMap(index.byVisibility)
  };
};
