import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { collectDeclaredReturnTypes } from '../../shared/docmeta.js';
import { RETURN_CALL_RX, RETURN_NEW_RX } from './constants.js';
import { isTypeDeclaration } from './symbols.js';

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
  const paramNames = Array.isArray(docmeta.params) ? docmeta.params : [];
  const paramTypes = {};

  if (docmeta.paramTypes && typeof docmeta.paramTypes === 'object') {
    for (const [name, type] of Object.entries(docmeta.paramTypes)) {
      if (!name || !type) continue;
      paramTypes[name] = uniqueTypes([...(paramTypes[name] || []), type]);
    }
  }

  const inferred = docmeta.inferredTypes?.params || {};
  if (inferred && typeof inferred === 'object') {
    for (const [name, entries] of Object.entries(inferred)) {
      if (!name || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry?.type) continue;
        paramTypes[name] = uniqueTypes([...(paramTypes[name] || []), entry.type]);
      }
    }
  }

  return { paramNames, paramTypes };
};

export const extractReturnCalls = (chunkText) => {
  const calls = new Set();
  const news = new Set();
  if (!chunkText) return { calls, news };
  RETURN_CALL_RX.lastIndex = 0;
  RETURN_NEW_RX.lastIndex = 0;
  let match;
  while ((match = RETURN_CALL_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) calls.add(name);
  }
  while ((match = RETURN_NEW_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) news.add(name);
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
