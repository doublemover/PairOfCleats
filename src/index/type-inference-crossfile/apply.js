const ensureInferred = (docmeta) => {
  if (!docmeta.inferredTypes || typeof docmeta.inferredTypes !== 'object') {
    docmeta.inferredTypes = {};
  }
  return docmeta.inferredTypes;
};

export const addInferredReturn = (docmeta, type, source, confidence) => {
  if (!type) return false;
  const inferred = ensureInferred(docmeta);
  if (!Array.isArray(inferred.returns)) inferred.returns = [];
  const existing = inferred.returns.find((entry) => entry.type === type && entry.source === source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence || 0, confidence);
    return true;
  }
  inferred.returns.push({ type, source, confidence });
  return true;
};

export const addInferredParam = (docmeta, name, type, source, confidence, maxCandidates = null) => {
  if (!name || !type) return false;
  const inferred = ensureInferred(docmeta);
  if (!inferred.params || typeof inferred.params !== 'object') inferred.params = {};
  const list = inferred.params[name] || [];
  if (Number.isFinite(maxCandidates) && maxCandidates > 0) {
    const hasType = list.some((entry) => entry.type === type);
    if (!hasType && list.length >= maxCandidates) return false;
  }
  const existing = list.find((entry) => entry.type === type && entry.source === source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence || 0, confidence);
    inferred.params[name] = list;
    return true;
  }
  inferred.params[name] = [...list, { type, source, confidence }];
  return true;
};

export const mergeDiagnostics = (target, incoming) => {
  if (!incoming || !incoming.size) return target;
  for (const [key, list] of incoming.entries()) {
    if (!Array.isArray(list) || !list.length) continue;
    const existing = target.get(key) || [];
    target.set(key, [...existing, ...list]);
  }
  return target;
};
