export const PRIMARY_INDEX_MODES = Object.freeze([
  'code',
  'prose',
  'extracted-prose',
  'records'
]);

const PRIMARY_INDEX_MODE_SET = new Set(PRIMARY_INDEX_MODES);

export const isPrimaryIndexMode = (mode) => PRIMARY_INDEX_MODE_SET.has(mode);

export const filterPrimaryIndexModes = (modes) => (
  Array.isArray(modes) ? modes.filter(isPrimaryIndexMode) : []
);

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
