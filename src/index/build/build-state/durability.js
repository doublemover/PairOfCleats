export const BUILD_STATE_DURABILITY_CLASS = Object.freeze({
  REQUIRED: 'required',
  BEST_EFFORT: 'best_effort'
});

export const resolveBuildStateDurabilityClass = (
  value,
  fallback = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === BUILD_STATE_DURABILITY_CLASS.REQUIRED) {
    return BUILD_STATE_DURABILITY_CLASS.REQUIRED;
  }
  if (normalized === BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT) {
    return BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT;
  }
  return resolveBuildStateDurabilityClass(fallback, BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT);
};

export const isRequiredBuildStateDurability = (value) => (
  resolveBuildStateDurabilityClass(value) === BUILD_STATE_DURABILITY_CLASS.REQUIRED
);
