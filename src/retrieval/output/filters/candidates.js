export const extractRegexLiteral = (pattern) => {
  let best = '';
  let current = '';
  let escaped = false;
  for (const ch of pattern) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if ('^$.*+?()[]{}|'.includes(ch)) {
      if (current.length > best.length) best = current;
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > best.length) best = current;
  return best;
};

export const createCandidateHelpers = (deps) => {
  const {
    roaringAvailable,
    bitmapToSet,
    createBitmapFromIds,
    unionBitmaps,
    intersectBitmaps,
    intersectSetWithBitmap,
    isBitmapEmpty,
    getBitmapSize,
    preferBitmap = false,
    bitmapMinSize = null
  } = deps;
  const resolvedBitmapMinSize = Number.isFinite(Number(bitmapMinSize))
    ? Math.max(1, Math.floor(Number(bitmapMinSize)))
    : null;
  const shouldKeepBitmap = (bitmap) => {
    if (!preferBitmap || !roaringAvailable || !bitmap) return false;
    if (!resolvedBitmapMinSize) return true;
    return getBitmapSize(bitmap) >= resolvedBitmapMinSize;
  };

  const buildCandidate = (sets, bitmaps) => {
    const setList = Array.isArray(sets) ? sets.filter(Boolean) : [];
    const bitmapList = Array.isArray(bitmaps) ? bitmaps.filter(Boolean) : [];
    if (!setList.length && !bitmapList.length) return null;
    if (roaringAvailable) {
      let bitmap = bitmapList.length ? unionBitmaps(bitmapList) : null;
      if (setList.length) {
        const ids = [];
        for (const set of setList) {
          for (const id of set) ids.push(id);
        }
        const extraBitmap = createBitmapFromIds(ids, {
          force: preferBitmap === true,
          minSize: resolvedBitmapMinSize ?? undefined
        });
        if (extraBitmap) {
          bitmap = bitmap ? unionBitmaps([bitmap, extraBitmap]) : extraBitmap;
        }
      }
      if (bitmap) return { bitmap };
    }
    const out = new Set();
    for (const set of setList) {
      for (const id of set) out.add(id);
    }
    for (const bitmap of bitmapList) {
      for (const id of bitmapToSet(bitmap)) out.add(id);
    }
    return { set: out };
  };

  const mergeCandidates = (candidates) => {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const sets = [];
    const bitmaps = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.bitmap) bitmaps.push(candidate.bitmap);
      if (candidate.set) sets.push(candidate.set);
    }
    return buildCandidate(sets, bitmaps);
  };

  const collectExactMatches = (map, values, bitmapMap = null) => {
    if (!map || !values.length) return null;
    const sets = [];
    const bitmaps = [];
    for (const value of values) {
      if (!value) continue;
      const set = map.get(value);
      if (!set) continue;
      const bitmap = bitmapMap ? bitmapMap.get(value) : null;
      if (bitmap) {
        bitmaps.push(bitmap);
      } else {
        sets.push(set);
      }
    }
    if (!sets.length && !bitmaps.length) return { set: new Set() };
    return buildCandidate(sets, bitmaps);
  };

  const collectSubstringMatches = (map, needle, bitmapMap = null) => {
    if (!map || !needle) return null;
    const sets = [];
    const bitmaps = [];
    for (const [key, set] of map.entries()) {
      if (!key.includes(needle)) continue;
      const bitmap = bitmapMap ? bitmapMap.get(key) : null;
      if (bitmap) {
        bitmaps.push(bitmap);
      } else {
        sets.push(set);
      }
    }
    if (!sets.length && !bitmaps.length) return { set: new Set() };
    return buildCandidate(sets, bitmaps);
  };

  const collectAnySubstringMatches = (map, values, bitmapMap = null) => {
    if (!map || !values.length) return null;
    const candidates = values
      .map((value) => collectSubstringMatches(map, value, bitmapMap))
      .filter(Boolean);
    return mergeCandidates(candidates);
  };

  const intersectSets = (sets) => {
    if (!sets.length) return null;
    let acc = sets[0];
    for (let i = 1; i < sets.length; i += 1) {
      const next = sets[i];
      const merged = new Set();
      for (const id of acc) {
        if (next.has(id)) merged.add(id);
      }
      acc = merged;
      if (!acc.size) break;
    }
    return acc;
  };

  const intersectTwoSets = (left, right) => {
    if (!left || !right) return new Set();
    const out = new Set();
    for (const id of left) {
      if (right.has(id)) out.add(id);
    }
    return out;
  };

  const intersectCandidates = (candidates) => {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const sets = [];
    const bitmaps = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.set) {
        if (!candidate.set.size) return new Set();
        sets.push(candidate.set);
      }
      if (candidate.bitmap) {
        if (isBitmapEmpty(candidate.bitmap)) return new Set();
        bitmaps.push(candidate.bitmap);
      }
    }
    if (bitmaps.length) {
      let bitmap = intersectBitmaps(bitmaps);
      if (!bitmap || isBitmapEmpty(bitmap)) {
        return new Set();
      }
      if (sets.length) {
        const setIntersection = intersectSets(sets);
        if (!setIntersection || !setIntersection.size) {
          return new Set();
        }
        const setBitmap = createBitmapFromIds(setIntersection, {
          force: true,
          minSize: resolvedBitmapMinSize ?? undefined
        });
        if (setBitmap) {
          bitmap = intersectBitmaps([bitmap, setBitmap]);
          if (!bitmap || isBitmapEmpty(bitmap)) {
            return new Set();
          }
          return shouldKeepBitmap(bitmap) ? bitmap : bitmapToSet(bitmap);
        }
        return intersectSetWithBitmap(setIntersection, bitmap);
      }
      return shouldKeepBitmap(bitmap) ? bitmap : bitmapToSet(bitmap);
    }
    return intersectSets(sets);
  };

  return {
    buildCandidate,
    mergeCandidates,
    collectExactMatches,
    collectSubstringMatches,
    collectAnySubstringMatches,
    intersectCandidates,
    intersectTwoSets
  };
};
