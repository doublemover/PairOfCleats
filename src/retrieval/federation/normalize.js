export const normalizeFederationList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
};
