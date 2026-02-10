import crypto from 'node:crypto';
import { compareStrings } from './sort.js';

const normalizeSelector = (selector) => {
  if (typeof selector === 'function') return selector;
  if (typeof selector === 'string') return (value) => value?.[selector];
  return () => null;
};

const compareValues = (left, right) => {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return -1;
    if (Number.isNaN(right)) return 1;
    return left - right;
  }
  return compareStrings(left, right);
};

const buildComparator = (selectors = []) => {
  const resolved = selectors.map(normalizeSelector);
  return (left, right) => {
    for (const selector of resolved) {
      const cmp = compareValues(selector(left), selector(right));
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
};

export const stableOrder = (items, selectors = []) => {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!selectors || selectors.length === 0) return list;
  const comparator = buildComparator(selectors);
  return list
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const cmp = comparator(left.item, right.item);
      if (cmp !== 0) return cmp;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
};

export const stableOrderWithComparator = (items, comparator) => {
  const list = Array.isArray(items) ? items.slice() : [];
  if (typeof comparator !== 'function') return list;
  return list
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const cmp = comparator(left.item, right.item);
      if (cmp !== 0) return cmp;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
};

export const stableBucketOrder = (items, bucketSelector, selectors = []) => {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!bucketSelector) return stableOrder(list, selectors);
  const bucketKey = normalizeSelector(bucketSelector);
  const buckets = new Map();
  for (const item of list) {
    const key = bucketKey(item);
    const safeKey = key == null ? '' : key;
    if (!buckets.has(safeKey)) buckets.set(safeKey, []);
    buckets.get(safeKey).push(item);
  }
  const bucketKeys = Array.from(buckets.keys()).sort(compareValues);
  const ordered = [];
  for (const key of bucketKeys) {
    const bucketItems = buckets.get(key) || [];
    ordered.push(...stableOrder(bucketItems, selectors));
  }
  return ordered;
};

export const stableOrderMapEntries = (map, selectors = ['key']) => {
  const entries = map instanceof Map
    ? Array.from(map.entries()).map(([key, value]) => ({ key, value }))
    : Object.entries(map || {}).map(([key, value]) => ({ key, value }));
  return stableOrder(entries, selectors);
};

export const orderRepoMapEntries = (entries) => stableOrder(entries, [
  (entry) => entry?.file ?? null,
  (entry) => entry?.name ?? null,
  (entry) => entry?.kind ?? null,
  (entry) => entry?.signature ?? null,
  (entry) => Number.isFinite(entry?.startLine) ? entry.startLine : null,
  (entry) => Number.isFinite(entry?.endLine) ? entry.endLine : null
]);

export const createOrderingHasher = () => {
  const hash = crypto.createHash('sha1');
  let count = 0;
  return {
    update(value) {
      hash.update(String(value ?? ''));
      hash.update('\n');
      count += 1;
    },
    digest() {
      const value = hash.digest('hex');
      return {
        algo: 'sha1',
        value,
        count,
        hash: `sha1:${value}`
      };
    },
    count() {
      return count;
    }
  };
};

export const ORDERING_HELPERS = {
  stableOrder,
  stableOrderWithComparator,
  stableBucketOrder,
  stableOrderMapEntries,
  orderRepoMapEntries,
  createOrderingHasher
};
