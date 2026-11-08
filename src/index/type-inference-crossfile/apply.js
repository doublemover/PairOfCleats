import { returnTypeSupportKey } from './return-evidence.js';

const ensureInferred = (docmeta) => {
  if (!docmeta.inferredTypes || typeof docmeta.inferredTypes !== 'object') {
    docmeta.inferredTypes = {};
  }
  return docmeta.inferredTypes;
};

const ensureParamMap = (value) => {
  if (!value || typeof value !== 'object') return Object.create(null);
  if (Object.getPrototypeOf(value) === null) return value;
  const next = Object.create(null);
  for (const [name, entries] of Object.entries(value)) {
    next[name] = Array.isArray(entries) ? entries : [];
  }
  return next;
};

export const addInferredReturn = (docmeta, type, source, confidence, evidence = null) => {
  if (!type) return false;
  const inferred = ensureInferred(docmeta);
  if (!Array.isArray(inferred.returns)) inferred.returns = [];
  const support = returnTypeSupportKey(evidence);
  const existing = inferred.returns.find((entry) => entry.type === type && entry.source === source
    && returnTypeSupportKey(entry.evidence) === support);
  if (existing) {
    if (Number.isFinite(confidence) && (!Number.isFinite(existing.confidence) || confidence > existing.confidence)) {
      existing.confidence = confidence;
      if (evidence) existing.evidence = evidence;
    }
    return true;
  }
  inferred.returns.push({ type, source, confidence: Number.isFinite(confidence) ? confidence : null,
    ...(evidence ? { evidence } : {}) });
  return true;
};

export const addInferredParam = (docmeta, name, type, source, confidence, maxCandidates = null) => {
  if (!name || !type) return false;
  const inferred = ensureInferred(docmeta);
  inferred.params = ensureParamMap(inferred.params);
  const list = Object.hasOwn(inferred.params, name) && Array.isArray(inferred.params[name])
    ? inferred.params[name]
    : [];
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
    const existingRaw = target.get(key);
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    target.set(key, [...existing, ...list]);
  }
  return target;
};
