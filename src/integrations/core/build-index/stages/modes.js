/**
 * Canonical primary index mode order used for stage batching and progress.
 * This order is stable and intentionally reused when resolving `all` mode.
 */
export const PRIMARY_INDEX_MODES = Object.freeze([
  'code',
  'prose',
  'extracted-prose',
  'records'
]);

const PRIMARY_INDEX_MODE_SET = new Set(PRIMARY_INDEX_MODES);

/**
 * @param {string} mode
 * @returns {boolean}
 */
export const isPrimaryIndexMode = (mode) => PRIMARY_INDEX_MODE_SET.has(mode);

/**
 * Keep only primary index modes from an arbitrary mode list.
 * @param {string[]|unknown} modes
 * @returns {string[]}
 */
export const filterPrimaryIndexModes = (modes) => (
  Array.isArray(modes) ? modes.filter(isPrimaryIndexMode) : []
);

/**
 * Check whether requested modes are exactly the full primary mode set.
 * @param {string[]|unknown} modes
 * @returns {boolean}
 */
export const areAllPrimaryModesRequested = (modes) => {
  if (!Array.isArray(modes) || modes.length !== PRIMARY_INDEX_MODES.length) {
    return false;
  }
  const requested = new Set(modes);
  if (requested.size !== PRIMARY_INDEX_MODES.length) {
    return false;
  }
  for (const mode of PRIMARY_INDEX_MODES) {
    if (!requested.has(mode)) return false;
  }
  return true;
};

/**
 * Deduplicate a mode list while preserving first-seen ordering.
 *
 * This keeps observable ordering stable while avoiding redundant per-mode
 * work for callers that accidentally pass duplicates.
 *
 * @param {string[]|unknown} modes
 * @returns {string[]}
 */
export const dedupeModeList = (modes) => {
  if (!Array.isArray(modes)) return [];
  if (modes.length < 2) return modes.slice();
  const seen = new Set();
  const unique = [];
  for (const mode of modes) {
    if (seen.has(mode)) continue;
    seen.add(mode);
    unique.push(mode);
  }
  return unique;
};
