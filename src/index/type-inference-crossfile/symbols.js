import { TYPE_KIND_PATTERNS } from './constants.js';

export const leafName = (value) => {
  if (!value) return null;
  const parts = String(value).split(/::|\./).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
};

export const isTypeDeclaration = (kind) => {
  if (!kind) return false;
  return TYPE_KIND_PATTERNS.some((rx) => rx.test(kind));
};

export const addSymbol = (index, key, entry) => {
  if (!key) return;
  const list = index.get(key) || [];
  list.push(entry);
  index.set(key, list);
};

export const resolveUniqueSymbol = (index, name) => {
  if (!name) return null;
  const direct = index.get(name) || [];
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;
  const leaf = leafName(name);
  if (!leaf || leaf === name) return null;
  const leafMatches = index.get(leaf) || [];
  return leafMatches.length === 1 ? leafMatches[0] : null;
};
