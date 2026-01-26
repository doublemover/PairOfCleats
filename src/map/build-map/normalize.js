export const normalizeArray = (value) => {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((entry) => entry !== null && entry !== undefined && entry !== '')
    .map((entry) => String(entry))
    .filter(Boolean);
  return filtered.length ? filtered : null;
};

export const normalizeModifiers = (modifiers) => {
  if (!modifiers || typeof modifiers !== 'object') return null;
  return { ...modifiers };
};

export const normalizeControlFlow = (controlFlow) => {
  if (!controlFlow || typeof controlFlow !== 'object') return null;
  return { ...controlFlow };
};

export const normalizeDataflow = (dataflow) => {
  if (!dataflow || typeof dataflow !== 'object') return null;
  const reads = normalizeArray(dataflow.reads);
  const writes = normalizeArray(dataflow.writes);
  const metadata = normalizeArray(dataflow.metadata);
  const mutations = normalizeArray(dataflow.mutations || dataflow.mutates);
  if (!reads && !writes && !metadata && !mutations) return null;
  return {
    reads,
    writes,
    metadata,
    mutations
  };
};
