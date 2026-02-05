export const normalizeArray = (value, intern) => {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((entry) => entry !== null && entry !== undefined && entry !== '')
    .map((entry) => String(entry))
    .filter(Boolean);
  if (!filtered.length) return null;
  return intern ? filtered.map((entry) => intern(entry)) : filtered;
};

export const normalizeModifiers = (modifiers) => {
  if (!modifiers || typeof modifiers !== 'object') return null;
  return { ...modifiers };
};

export const normalizeControlFlow = (controlFlow) => {
  if (!controlFlow || typeof controlFlow !== 'object') return null;
  return { ...controlFlow };
};

export const normalizeDataflow = (dataflow, intern) => {
  if (!dataflow || typeof dataflow !== 'object') return null;
  const reads = normalizeArray(dataflow.reads, intern);
  const writes = normalizeArray(dataflow.writes, intern);
  const metadata = normalizeArray(dataflow.metadata, intern);
  const mutations = normalizeArray(dataflow.mutations || dataflow.mutates, intern);
  if (!reads && !writes && !metadata && !mutations) return null;
  return {
    reads,
    writes,
    metadata,
    mutations
  };
};

export const createStringInterner = () => {
  const cache = new Map();
  return (value) => {
    if (value === null || value === undefined) return value;
    const text = String(value);
    if (!text) return text;
    const cached = cache.get(text);
    if (cached) return cached;
    cache.set(text, text);
    return text;
  };
};
