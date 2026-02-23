import { isCodeEntryForPath, isProseEntryForPath } from '../mode-routing.js';

export const createTrackedState = () => ({
  trackedEntriesByMode: new Map(),
  skippedEntriesByMode: new Map(),
  trackedCounts: new Map(),
  trackedFiles: new Set()
});

const ensureModeMap = (state, mode) => {
  if (!state.trackedEntriesByMode.has(mode)) state.trackedEntriesByMode.set(mode, new Map());
  return state.trackedEntriesByMode.get(mode);
};

const ensureSkipMap = (state, mode) => {
  if (!state.skippedEntriesByMode.has(mode)) state.skippedEntriesByMode.set(mode, new Map());
  return state.skippedEntriesByMode.get(mode);
};

const recordSkip = (state, mode, absPath, reason, extra = {}) => {
  if (!mode) return;
  const map = ensureSkipMap(state, mode);
  map.set(absPath, { file: absPath, reason, ...extra });
};

const clearSkip = (state, mode, absPath) => {
  const map = state.skippedEntriesByMode.get(mode);
  if (map) map.delete(absPath);
};

const incrementTracked = (state, absPath) => {
  const count = state.trackedCounts.get(absPath) || 0;
  state.trackedCounts.set(absPath, count + 1);
  state.trackedFiles.add(absPath);
};

const decrementTracked = (state, absPath) => {
  const count = state.trackedCounts.get(absPath) || 0;
  if (count <= 1) {
    state.trackedCounts.delete(absPath);
    state.trackedFiles.delete(absPath);
    return;
  }
  state.trackedCounts.set(absPath, count - 1);
};

export const removeTrackedPathFromModes = (state, absPath) => {
  for (const map of state.trackedEntriesByMode.values()) {
    if (map.delete(absPath)) {
      decrementTracked(state, absPath);
    }
  }
};

export const buildDiscoveryForMode = (state, mode) => {
  const map = state.trackedEntriesByMode.get(mode);
  const entries = map ? Array.from(map.values()) : [];
  const skippedMap = state.skippedEntriesByMode.get(mode);
  const skippedFiles = skippedMap ? Array.from(skippedMap.values()) : [];
  return { entries, skippedFiles };
};

const resolveModeAllowances = (classification) => ({
  proseAllowed: isProseEntryForPath({
    ext: classification.ext,
    relPath: classification.relPosix
  }),
  codeAllowed: isCodeEntryForPath({
    ext: classification.ext,
    relPath: classification.relPosix,
    isSpecial: classification.isSpecial
  })
});

/**
 * Decide whether a mode should track a path after classification.
 *
 * `extracted-prose` intentionally admits both code-routed and prose-routed
 * files because extraction consumes mixed content.
 *
 * @param {string} mode
 * @param {{proseAllowed:boolean,codeAllowed:boolean}} allowances
 * @returns {boolean}
 */
const isAllowedForMode = (mode, allowances) => {
  const isProse = mode === 'prose';
  const isCode = mode === 'code' || mode === 'extracted-prose';
  return (isProse && allowances.proseAllowed)
    || (isCode && allowances.codeAllowed)
    || (mode === 'extracted-prose' && allowances.proseAllowed);
};

export const seedTrackedStateForMode = ({
  state,
  mode,
  entries = [],
  skippedEntries = []
}) => {
  const modeMap = ensureModeMap(state, mode);
  for (const entry of entries) {
    if (!entry?.abs) continue;
    if (!modeMap.has(entry.abs)) incrementTracked(state, entry.abs);
    modeMap.set(entry.abs, entry);
  }
  const skipMap = ensureSkipMap(state, mode);
  for (const skipped of skippedEntries) {
    if (skipped?.file) skipMap.set(skipped.file, skipped);
  }
};

/**
 * Apply one path classification to tracked/skipped mode maps.
 *
 * @param {{
 *   state:object,
 *   absPath:string,
 *   modes:string[],
 *   classification:object,
 *   maxFilesCap:number|null
 * }} input
 * @returns {boolean}
 */
export const applyClassificationToTrackedState = ({
  state,
  absPath,
  modes,
  classification,
  maxFilesCap
}) => {
  const beforeCount = state.trackedCounts.get(absPath) || 0;
  if (classification.skip) {
    if (beforeCount > 0) removeTrackedPathFromModes(state, absPath);
    for (const mode of modes) {
      recordSkip(state, mode, absPath, classification.reason, classification.extra || {});
    }
    return beforeCount > 0;
  }

  if (maxFilesCap && beforeCount === 0 && state.trackedCounts.size >= maxFilesCap) {
    for (const mode of modes) {
      recordSkip(state, mode, absPath, 'max-files', { maxFiles: maxFilesCap });
    }
    return false;
  }

  const baseEntry = {
    abs: absPath,
    rel: classification.relPosix,
    stat: classification.stat,
    ext: classification.ext
  };
  const allowances = classification.record ? null : resolveModeAllowances(classification);

  for (const mode of modes) {
    if (classification.record) {
      if (mode === 'records') {
        const map = ensureModeMap(state, mode);
        if (!map.has(absPath)) incrementTracked(state, absPath);
        map.set(absPath, { ...baseEntry, record: classification.record });
        clearSkip(state, mode, absPath);
      } else {
        const map = ensureModeMap(state, mode);
        if (map.delete(absPath)) decrementTracked(state, absPath);
        recordSkip(state, mode, absPath, 'records', {
          recordType: classification.record.recordType || null
        });
      }
      continue;
    }

    if (mode === 'records') {
      const map = ensureModeMap(state, mode);
      if (map.delete(absPath)) decrementTracked(state, absPath);
      recordSkip(state, mode, absPath, 'unsupported');
      continue;
    }

    const allowed = isAllowedForMode(mode, allowances);
    const map = ensureModeMap(state, mode);
    if (allowed) {
      if (!map.has(absPath)) incrementTracked(state, absPath);
      map.set(absPath, baseEntry);
      clearSkip(state, mode, absPath);
    } else {
      if (map.delete(absPath)) decrementTracked(state, absPath);
      recordSkip(state, mode, absPath, 'unsupported');
    }
  }

  const afterCount = state.trackedCounts.get(absPath) || 0;
  return beforeCount !== afterCount;
};
