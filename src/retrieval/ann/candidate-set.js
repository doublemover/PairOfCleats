export const getCandidateSetSize = (value) => {
  if (!value) return 0;
  if (Number.isFinite(Number(value.size))) return Number(value.size);
  if (typeof value.size === 'function') {
    const resolved = Number(value.size());
    return Number.isFinite(resolved) ? resolved : 0;
  }
  if (typeof value.getSize === 'function') {
    const resolved = Number(value.getSize());
    return Number.isFinite(resolved) ? resolved : 0;
  }
  if (Array.isArray(value)) return value.length;
  return 0;
};

export const candidateSetHas = (value, id) => {
  if (!value) return false;
  if (typeof value.has === 'function') return value.has(id);
  if (typeof value.contains === 'function') return value.contains(id);
  if (typeof value.includes === 'function') return value.includes(id);
  return false;
};

export const candidateSetToArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.toArray === 'function') return value.toArray();
  if (typeof value.values === 'function') return Array.from(value.values());
  if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
  return [];
};

export const normalizeCandidateSetIds = (value) => candidateSetToArray(value)
  .map((id) => Number(id))
  .filter((id) => Number.isInteger(id));
