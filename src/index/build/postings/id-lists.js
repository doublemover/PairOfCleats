const isSortedIds = (list) => {
  for (let i = 1; i < list.length; i += 1) {
    if (list[i] < list[i - 1]) return false;
  }
  return true;
};

const isSortedUniqueFiniteIds = (list) => {
  for (let i = 0; i < list.length; i += 1) {
    const value = list[i];
    if (!Number.isFinite(value)) return false;
    if (i > 0 && value <= list[i - 1]) return false;
  }
  return true;
};

const isSortedPostings = (list) => {
  for (let i = 1; i < list.length; i += 1) {
    if (!Array.isArray(list[i - 1]) || !Array.isArray(list[i])) return false;
    if (list[i][0] < list[i - 1][0]) return false;
  }
  return true;
};

const normalizeDocIdList = (value) => {
  if (value == null) return [];
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value;
  if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
  return [];
};

const mergeSortedUniqueIdLists = (listA, listB) => {
  const out = new Array(listA.length + listB.length);
  let aIndex = 0;
  let bIndex = 0;
  let writeIndex = 0;
  let last = null;
  let hasLast = false;
  while (aIndex < listA.length && bIndex < listB.length) {
    const leftValue = listA[aIndex];
    const rightValue = listB[bIndex];
    let nextValue;
    if (leftValue < rightValue) {
      nextValue = leftValue;
      aIndex += 1;
    } else if (leftValue > rightValue) {
      nextValue = rightValue;
      bIndex += 1;
    } else {
      nextValue = leftValue;
      aIndex += 1;
      bIndex += 1;
    }
    if (!hasLast || nextValue !== last) {
      out[writeIndex] = nextValue;
      writeIndex += 1;
      last = nextValue;
      hasLast = true;
    }
  }
  while (aIndex < listA.length) {
    const nextValue = listA[aIndex];
    aIndex += 1;
    if (!hasLast || nextValue !== last) {
      out[writeIndex] = nextValue;
      writeIndex += 1;
      last = nextValue;
      hasLast = true;
    }
  }
  while (bIndex < listB.length) {
    const nextValue = listB[bIndex];
    bIndex += 1;
    if (!hasLast || nextValue !== last) {
      out[writeIndex] = nextValue;
      writeIndex += 1;
      last = nextValue;
      hasLast = true;
    }
  }
  out.length = writeIndex;
  return out;
};

export const normalizeIdList = (value) => {
  if (Array.isArray(value) && value.length && isSortedUniqueFiniteIds(value)) {
    return value;
  }
  const raw = normalizeDocIdList(value);
  if (!raw.length) return [];
  const list = new Array(raw.length);
  let count = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!Number.isFinite(entry)) continue;
    list[count] = entry;
    count += 1;
  }
  if (count <= 1) {
    return count === 1 ? [list[0]] : [];
  }
  list.length = count;
  if (isSortedUniqueFiniteIds(list)) return list;
  if (isSortedIds(list)) {
    let write = 1;
    for (let read = 1; read < list.length; read += 1) {
      if (list[read] !== list[write - 1]) {
        list[write] = list[read];
        write += 1;
      }
    }
    list.length = write;
    return list;
  }
  list.sort((a, b) => a - b);
  let write = 1;
  for (let read = 1; read < list.length; read += 1) {
    if (list[read] !== list[write - 1]) {
      list[write] = list[read];
      write += 1;
    }
  }
  list.length = write;
  return list;
};

/**
 * Merge posting lists when the left input is already normalized.
 * Avoids re-validating/re-scanning the accumulated list on every merge.
 */
export const mergeIdListsWithNormalizedLeft = (leftNormalized, right) => {
  if (!Array.isArray(leftNormalized)) return normalizeIdList(right);
  const listB = normalizeIdList(right);
  if (!leftNormalized.length) return listB;
  if (!listB.length) return leftNormalized;
  const lastA = leftNormalized[leftNormalized.length - 1];
  const firstA = leftNormalized[0];
  const firstB = listB[0];
  const lastB = listB[listB.length - 1];
  if (Number.isFinite(lastA) && Number.isFinite(firstB) && lastA < firstB) {
    return leftNormalized.concat(listB);
  }
  if (Number.isFinite(lastB) && Number.isFinite(firstA) && lastB < firstA) {
    return listB.concat(leftNormalized);
  }
  return mergeSortedUniqueIdLists(leftNormalized, listB);
};

export const normalizeTfPostingList = (value) => {
  if (!Array.isArray(value)) return [];
  const next = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const docId = entry[0];
    const count = entry[1];
    if (!Number.isFinite(docId) || !Number.isFinite(count)) continue;
    next.push([docId, Math.trunc(count)]);
  }
  if (next.length <= 1 || isSortedPostings(next)) return next;
  next.sort((a, b) => {
    const delta = a[0] - b[0];
    return delta || (a[1] - b[1]);
  });
  return next;
};
