import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { collectDeclaredReturnTypes } from '../metadata/docmeta.js';
import { RETURN_BARE_TARGET_RX, RETURN_CALL_RX, RETURN_NEW_RX } from './constants.js';
import { isTypeDeclaration } from './symbols.js';
import { isShadowedImportCall } from './lexical-call-binding.js';
import { normalizeLiteralInput, inspectLiteralStructure, isWholeQuotedLiteral } from '../type-inference/literal-expression.js';

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

export const extractReturnCalls = (chunkText, { knownCallees = null, chunk = null, importBindings = null, admitConstructor = null } = {}) => {
  const calls = new Set();
  const news = new Set();
  if (['javascript', 'typescript', 'jsx', 'tsx'].includes(chunk?.lang)) {
    const callSites = new Set();
    for (const detail of chunk.codeRelations?.callDetails || []) {
      const evidence = detail?.returnedValue;
      if (evidence?.v !== 1 || !['call', 'construct'].includes(evidence.kind)
        || evidence.awaited !== false || evidence.async !== false || evidence.generator !== false
        || !Array.isArray(evidence.ownerRanges) || !Array.isArray(evidence.expression) || evidence.expression.length !== 2
        || evidence.expression[0] !== detail.start || evidence.expression[1] !== detail.end
        || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end)
        || !Number.isSafeInteger(detail.start) || !Number.isSafeInteger(detail.end)
        || detail.start < chunk.start || detail.end > chunk.end || detail.start >= detail.end
        || !evidence.ownerRanges.some(range => Array.isArray(range) && range.length === 2
          && range[0] === chunk.start && range[1] === chunk.end)
        || typeof detail.callee !== 'string' || !detail.callee) continue;
      if (evidence.kind === 'construct' && (isShadowedImportCall(detail)
        || importBindings?.[detail.callee.split(/::|\./u)[0]]?.typeOnly === true
        || admitConstructor && !admitConstructor(detail.callee))) continue;
      (evidence.kind === 'construct' ? news : calls).add(detail.callee);
      if (evidence.kind === 'call') callSites.add(`${detail.start}:${detail.end}`);
    }
    return { calls, news, callSites };
  }
  if (!chunkText || !chunkText.includes('return')) return { calls, news };
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
  const value = normalizeLiteralInput(raw);
  if (!value) return null;
  const structure = inspectLiteralStructure(value);
  if (!structure) return null;
  if (value === 'null') return 'null';
  if (value === 'undefined') return 'undefined';
  if (value === 'true' || value === 'false') return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
  if (isWholeQuotedLiteral(value)) return 'string';
  const enclosed = structure.pairs.get(0) === value.length - 1;
  if (value.startsWith('[') && enclosed) return 'array';
  if (value.startsWith('{') && enclosed) return 'object';
  const newMatch = value.match(/^new\s+([\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*(?:\.[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*)*)/u);
  if (newMatch) {
    const tail = value.slice(newMatch[0].length).trim(), open = value.indexOf('(', newMatch[0].length);
    if (!tail || tail[0] === '(' && structure.pairs.get(open) === value.length - 1) return newMatch[1];
  }
  if (value === 'fn(...)') return 'function';
  return null;
};
