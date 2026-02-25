import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { collectDeclaredReturnTypes } from '../../shared/docmeta.js';
import { RETURN_BARE_TARGET_RX, RETURN_CALL_RX, RETURN_NEW_RX } from './constants.js';
import { isTypeDeclaration } from './symbols.js';

export const createParamTypeMap = () => Object.create(null);

const appendTypeCandidates = (list, value) => {
  if (!value) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) list.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendTypeCandidates(list, item);
    return;
  }
  if (typeof value === 'object') {
    if (typeof value.type === 'string') {
      const trimmed = value.type.trim();
      if (trimmed) list.push(trimmed);
    }
    if (Array.isArray(value.types)) {
      for (const item of value.types) appendTypeCandidates(list, item);
    }
  }
};

export const coerceParamTypeList = (value) => {
  const next = [];
  appendTypeCandidates(next, value);
  return uniqueTypes(next);
};

export const ensureParamTypeMap = (value) => {
  if (!value || typeof value !== 'object') return createParamTypeMap();
  if (Object.getPrototypeOf(value) === null) return value;
  const next = createParamTypeMap();
  for (const [name, types] of Object.entries(value)) {
    next[name] = coerceParamTypeList(types);
  }
  return next;
};

export const getParamTypeList = (paramTypes, name) => {
  if (!name || !paramTypes || typeof paramTypes !== 'object') return [];
  if (!Object.hasOwn(paramTypes, name)) return [];
  return coerceParamTypeList(paramTypes[name]);
};

export const extractReturnTypes = (chunk) => {
  const docmeta = chunk?.docmeta || {};
  const types = [];
  const declaredReturns = collectDeclaredReturnTypes(docmeta);
  for (const value of declaredReturns) {
    if (value) types.push(value);
  }
  if (Array.isArray(docmeta.inferredTypes?.returns)) {
    for (const entry of docmeta.inferredTypes.returns) {
      if (entry?.type) types.push(entry.type);
    }
  }
  if (isTypeDeclaration(chunk?.kind) && chunk?.name) {
    types.push(chunk.name);
  }
  return uniqueTypes(types);
};

export const extractParamTypes = (chunk) => {
  const docmeta = chunk?.docmeta || {};
  const paramNames = Array.isArray(docmeta.paramNames)
    ? docmeta.paramNames
    : (Array.isArray(docmeta.params) ? docmeta.params : []);
  const paramTypes = createParamTypeMap();

  if (docmeta.paramTypes && typeof docmeta.paramTypes === 'object') {
    for (const [name, type] of Object.entries(docmeta.paramTypes)) {
      if (!name || !type) continue;
      const existing = getParamTypeList(paramTypes, name);
      const nextTypes = coerceParamTypeList(type);
      if (!nextTypes.length) continue;
      paramTypes[name] = uniqueTypes([...existing, ...nextTypes]);
    }
  }

  const inferred = docmeta.inferredTypes?.params || {};
  if (inferred && typeof inferred === 'object') {
    for (const [name, entries] of Object.entries(inferred)) {
      if (!name || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry?.type) continue;
        const existing = getParamTypeList(paramTypes, name);
        paramTypes[name] = uniqueTypes([...existing, entry.type]);
      }
    }
  }

  return { paramNames, paramTypes };
};

export const extractReturnCalls = (chunkText, { knownCallees = null } = {}) => {
  const calls = new Set();
  const news = new Set();
  if (!chunkText) return { calls, news };
  RETURN_CALL_RX.lastIndex = 0;
  RETURN_NEW_RX.lastIndex = 0;
  RETURN_BARE_TARGET_RX.lastIndex = 0;
  let match;
  while ((match = RETURN_CALL_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) calls.add(name);
  }
  while ((match = RETURN_NEW_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) news.add(name);
  }
  if (knownCallees instanceof Set && knownCallees.size) {
    while ((match = RETURN_BARE_TARGET_RX.exec(chunkText)) !== null) {
      const name = match[1];
      if (!name) continue;
      if (knownCallees.has(name)) calls.add(name);
    }
  }
  return { calls, news };
};

export const inferArgType = (raw) => {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === 'null') return 'null';
  if (lowered === 'undefined') return 'undefined';
  if (lowered === 'true' || lowered === 'false') return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) return 'string';
  if (value.startsWith('[')) return 'array';
  if (value.startsWith('{')) return 'object';
  const newMatch = value.match(/^new\s+([A-Za-z_$][\w$.]*)/);
  if (newMatch) return newMatch[1];
  if (value === 'fn(...)') return 'function';
  return null;
};
