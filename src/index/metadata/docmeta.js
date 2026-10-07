const normalizeReturnTypeValue = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string') {
      return normalizeReturnTypeValue(value.type);
    }
  }
  return null;
};

export const collectDeclaredReturnTypes = (docmeta) => {
  if (!docmeta || typeof docmeta !== 'object') return [];
  const types = [];
  const pushValue = (value) => {
    const normalized = normalizeReturnTypeValue(value);
    if (normalized) types.push(normalized);
  };
  pushValue(docmeta.returnType);
  const returns = docmeta.returns;
  if (Array.isArray(returns)) {
    for (const entry of returns) {
      pushValue(entry);
    }
  } else {
    pushValue(returns);
  }
  return Array.from(new Set(types));
};

export const collectMetaV2ReturnTypes = (metaV2) => {
  const entries = metaV2?.types?.declared?.returns;
  if (!Array.isArray(entries)) return [];
  const types = entries
    .map((entry) => (entry && typeof entry.type === 'string' ? entry.type.trim() : null))
    .filter(Boolean);
  return Array.from(new Set(types));
};

export const pickDeclaredReturnType = (docmeta) => {
  const types = collectDeclaredReturnTypes(docmeta);
  return types.length ? types[0] : null;
};
