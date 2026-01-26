/**
 * Merge two filter lists so multiple sources intersect (CLI + --filter).
 * @param {string[]|null} left
 * @param {string[]|null} right
 * @returns {{values: string[]|null, impossible: boolean}}
 */
export const mergeFilterLists = (left, right) => {
  if (!left && !right) return { values: null, impossible: false };
  if (!left) return { values: right, impossible: false };
  if (!right) return { values: left, impossible: false };
  const rightSet = new Set(right);
  const intersection = left.filter((value) => rightSet.has(value));
  if (intersection.length) {
    return { values: Array.from(new Set(intersection)), impossible: false };
  }
  return { values: null, impossible: true };
};
