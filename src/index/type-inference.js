import { collectDeclaredReturnTypes } from '../shared/docmeta.js';

const TYPE_SOURCES = {
  annotation: 'annotation',
  default: 'default',
  literal: 'literal',
  flow: 'flow',
  tooling: 'tooling'
};

const CONFIDENCE = {
  annotation: 0.95,
  default: 0.7,
  literal: 0.6,
  flow: 0.55,
  tooling: 0.85
};

const PYTHON_TYPES = {
  string: 'str',
  number: 'int',
  float: 'float',
  boolean: 'bool',
  null: 'None',
  array: 'list',
  object: 'dict',
  tuple: 'tuple',
  set: 'set'
};

const JS_TYPES = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
  undefined: 'undefined',
  array: 'array',
  object: 'object'
};

const normalizeText = (value) => String(value || '').trim();
const toTypeList = (values) => {
  if (Array.isArray(values)) return values;
  if (values == null) return [];
  if (typeof values === 'string') return [values];
  if (values && typeof values[Symbol.iterator] === 'function') return Array.from(values);
  return [];
};
const unique = (values) => Array.from(new Set(toTypeList(values).filter(Boolean)));

const normalizeTypeName = (value, languageId) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (languageId === 'typescript' || languageId === 'tsx') {
    return normalized;
  }
  const lowered = normalized.toLowerCase();
  if (languageId === 'python') {
    const pyMap = {
      integer: 'int',
      bool: 'bool',
      boolean: 'bool',
      string: 'str',
      array: 'list',
      object: 'dict'
    };
    return pyMap[lowered] || normalized;
  }
  const jsMap = {
    integer: 'number',
    float: 'number',
    bool: 'boolean',
    string: 'string',
    array: 'array',
    object: 'object',
    dict: 'object',
    list: 'array'
  };
  return jsMap[lowered] || normalized;
};

const splitTopLevel = (value, delimiter) => {
  const parts = [];
  if (!value) return parts;
  let current = '';
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '<' || ch === '[' || ch === '(') depth += 1;
    if (ch === '>' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const splitLiteralTopLevel = (value) => {
  const parts = [];
  if (!value) return parts;
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === '{' || ch === '[' || ch === '(') depth += 1;
      if (ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const stripOptionalSuffix = (value) => {
  if (!value) return value;
  if (value.endsWith('?')) return value.slice(0, -1).trim();
  return value;
};

const parseGeneric = (value) => {
  if (!value) return null;
  const ltIndex = value.indexOf('<');
  const lbIndex = value.indexOf('[');
  const index = ltIndex >= 0 && (lbIndex < 0 || ltIndex < lbIndex) ? ltIndex : lbIndex;
  if (index < 0) return null;
  const closer = value[index] === '<' ? '>' : ']';
  const closeIndex = value.lastIndexOf(closer);
  if (closeIndex <= index) return null;
  const outer = value.slice(0, index).trim();
  const inner = value.slice(index + 1, closeIndex).trim();
  if (!outer || !inner) return null;
  return { outer, inner };
};

const expandUnionTypes = (value, languageId) => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  if (languageId === 'python') {
    const optionalMatch = normalized.match(/^(?:typing\.)?Optional\[(.+)\]$/);
    if (optionalMatch) {
      const inner = optionalMatch[1];
      return splitTopLevel(inner, ',').concat(PYTHON_TYPES.null);
    }
    const unionMatch = normalized.match(/^(?:typing\.)?Union\[(.+)\]$/);
    if (unionMatch) {
      return splitTopLevel(unionMatch[1], ',');
    }
  }
  const parts = splitTopLevel(normalized, '|');
  if (parts.length > 1) return parts;
  return [];
};

const expandTypeCandidates = (raw, languageId) => {
  const initial = normalizeTypeName(raw, languageId);
  if (!initial) return [];
  const seen = new Set();
  const queue = [initial];
  while (queue.length) {
    const current = normalizeTypeName(queue.shift(), languageId);
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const stripped = stripOptionalSuffix(current);
    if (stripped && stripped !== current) {
      queue.push(stripped);
      if (languageId !== 'python') queue.push('undefined');
    }
    const unions = expandUnionTypes(current, languageId);
    if (unions.length) {
      unions.forEach((entry) => queue.push(entry));
    }
    const generic = parseGeneric(current);
    if (generic) {
      if (generic.outer) queue.push(generic.outer);
      splitTopLevel(generic.inner, ',').forEach((entry) => queue.push(entry));
    }
  }
  return Array.from(seen).filter(Boolean);
};

const normalizeDefaultValue = (raw) => {
  let value = normalizeText(raw);
  if (!value || value === '...' || value === '...') return '';
  const commentCuts = [];
  const hashIdx = value.indexOf('#');
  if (hashIdx >= 0) commentCuts.push(hashIdx);
  const slashIdx = value.indexOf('//');
  if (slashIdx >= 0) commentCuts.push(slashIdx);
  if (commentCuts.length) {
    const cut = Math.min(...commentCuts);
    value = value.slice(0, cut).trim();
  }
  value = value.replace(/[;,]$/, '').trim();
  return value;
};

const mapPrimitive = (kind, languageId) => {
  if (languageId === 'python') return PYTHON_TYPES[kind] || kind;
  return JS_TYPES[kind] || kind;
};

const stripQuotes = (value) => {
  if (!value) return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const extractObjectKeys = (value, limit) => {
  const keys = [];
  if (!value || !value.trim().startsWith('{')) return keys;
  const keyRx = /([A-Za-z_$][\w$]*|"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+')\s*:/g;
  let match;
  while ((match = keyRx.exec(value)) !== null) {
    const key = stripQuotes(match[1]);
    if (key) keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
};

const extractArrayElements = (value, limit, languageId) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return null;
  const closeIndex = trimmed.lastIndexOf(']');
  if (closeIndex <= 0) return null;
  const inner = trimmed.slice(1, closeIndex);
  const parts = splitLiteralTopLevel(inner).slice(0, limit);
  const elements = [];
  for (const part of parts) {
    const entry = inferLiteralType(part, languageId);
    if (entry?.type) elements.push(entry.type);
  }
  return unique(elements);
};

const inferLiteralType = (raw, languageId) => {
  const value = normalizeDefaultValue(raw);
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (languageId === 'python') {
    if (lowered === 'none') return { type: PYTHON_TYPES.null };
    if (lowered === 'true' || lowered === 'false') return { type: PYTHON_TYPES.boolean };
    if (/^-?\d+\.\d+$/.test(value)) return { type: PYTHON_TYPES.float };
    if (/^-?\d+$/.test(value)) return { type: PYTHON_TYPES.number };
    if (value.startsWith('[')) {
      return {
        type: PYTHON_TYPES.array,
        elements: extractArrayElements(value, 25, languageId)
      };
    }
    if (value.startsWith('{')) {
      const keys = extractObjectKeys(value, 20);
      return {
        type: PYTHON_TYPES.object,
        shape: keys.length ? { kind: 'object', keys } : null
      };
    }
    if (value.startsWith('(')) return { type: PYTHON_TYPES.tuple };
    if (lowered.startsWith('set(')) return { type: PYTHON_TYPES.set };
    if (lowered.startsWith('dict(')) return { type: PYTHON_TYPES.object };
    if (lowered.startsWith('list(')) return { type: PYTHON_TYPES.array };
  } else {
    if (lowered === 'null') return { type: JS_TYPES.null };
    if (lowered === 'undefined') return { type: JS_TYPES.undefined };
    if (lowered === 'true' || lowered === 'false') return { type: JS_TYPES.boolean };
    if (/^-?\d+(\.\d+)?$/.test(value)) return { type: JS_TYPES.number };
    if (value.startsWith('[')) {
      return {
        type: JS_TYPES.array,
        elements: extractArrayElements(value, 25, languageId)
      };
    }
    if (value.startsWith('{')) {
      const keys = extractObjectKeys(value, 20);
      return {
        type: JS_TYPES.object,
        shape: keys.length ? { kind: 'object', keys } : null
      };
    }
  }
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
    return { type: mapPrimitive('string', languageId) };
  }
  const newMatch = value.match(/^new\s+([A-Za-z_][\w.]*)/);
  if (newMatch) return { type: normalizeTypeName(newMatch[1], languageId) };
  return null;
};

const addTypes = (bucket, key, entry, languageId) => {
  if (!bucket || !key || !entry?.type) return false;
  const expanded = expandTypeCandidates(entry.type, languageId);
  if (!expanded.length) return false;
  let hasData = false;
  for (const type of expanded) {
    if (!type) continue;
    hasData = addEntry(bucket, key, { ...entry, type }) || hasData;
  }
  return hasData;
};

const addReturnTypes = (list, entry, languageId) => {
  if (!Array.isArray(list) || !entry?.type) return false;
  const expanded = expandTypeCandidates(entry.type, languageId);
  if (!expanded.length) return false;
  let hasData = false;
  for (const type of expanded) {
    if (!type) continue;
    hasData = addListEntry(list, { ...entry, type }) || hasData;
  }
  return hasData;
};

const mergeTypeEntry = (existing, entry) => {
  if (!existing || !entry) return;
  existing.confidence = Math.max(existing.confidence || 0, entry.confidence || 0);
  if (entry.shape && !existing.shape) existing.shape = entry.shape;
  const incomingElements = toTypeList(entry.elements);
  if (incomingElements.length) {
    existing.elements = unique([...toTypeList(existing.elements), ...incomingElements]);
  }
  if (entry.evidence && !existing.evidence) existing.evidence = entry.evidence;
};

const addEntry = (bucket, key, entry) => {
  if (!bucket || !key || !entry?.type) return false;
  const list = Array.isArray(bucket[key]) ? bucket[key] : [];
  const existing = list.find((item) => item.type === entry.type && item.source === entry.source);
  if (existing) {
    mergeTypeEntry(existing, entry);
    bucket[key] = list;
    return true;
  }
  bucket[key] = [...list, entry];
  return true;
};

const addListEntry = (list, entry) => {
  if (!entry?.type) return false;
  const target = Array.isArray(list) ? list : [];
  const existing = target.find((item) => item.type === entry.type && item.source === entry.source);
  if (existing) {
    mergeTypeEntry(existing, entry);
    return true;
  }
  target.push(entry);
  return true;
};

const inferAssignments = (chunkText, languageId, knownTypes) => {
  const locals = Object.create(null);
  if (!chunkText) return { locals };
  const lines = chunkText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
    if (trimmed.includes('==') || trimmed.includes('!=') || trimmed.includes('=>')) continue;
    if (trimmed.includes('>=') || trimmed.includes('<=')) continue;
    let match = trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
    if (!match) {
      match = trimmed.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
    }
    if (!match) continue;
    const name = match[1];
    const value = match[2];
    const inferred = inferLiteralType(value, languageId);
    if (!inferred) continue;
    addEntry(locals, name, {
      ...inferred,
      source: TYPE_SOURCES.literal,
      confidence: CONFIDENCE.literal
    });
  }
  if (knownTypes && typeof knownTypes.get === 'function') {
    for (const [name, entries] of Object.entries(locals)) {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) continue;
      const existing = knownTypes.get(name) || [];
      for (const entry of list) {
        if (!entry?.type) continue;
        existing.push(entry.type);
      }
      knownTypes.set(name, existing);
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
      if (trimmed.includes('==') || trimmed.includes('!=') || trimmed.includes('=>')) continue;
      if (trimmed.includes('>=') || trimmed.includes('<=')) continue;
      let match = trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$.]*)\s*;?$/);
      if (!match) {
        match = trimmed.match(/^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$.]*)\s*;?$/);
      }
      if (!match) continue;
      const name = match[1];
      const value = match[2];
      const types = knownTypes.get(value);
      if (!types || !types.length) continue;
      for (const type of types) {
        addEntry(locals, name, {
          type,
          source: TYPE_SOURCES.flow,
          confidence: CONFIDENCE.flow
        });
      }
    }
  }
  return { locals };
};

const inferConditionalTypes = (chunkText, languageId) => {
  const results = [];
  if (!chunkText) return results;
  const lines = chunkText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    let match = trimmed.match(/typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*['"]([A-Za-z]+)['"]/);
    if (match) {
      results.push({ name: match[1], type: normalizeTypeName(match[2], languageId) });
      continue;
    }
    match = trimmed.match(/([A-Za-z_$][\w$]*)\s+instanceof\s+([A-Za-z_$][\w$.]*)/);
    if (match) {
      results.push({ name: match[1], type: normalizeTypeName(match[2], languageId) });
      continue;
    }
    match = trimmed.match(/Array\.isArray\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
    if (match) {
      results.push({ name: match[1], type: mapPrimitive('array', languageId) });
      continue;
    }
    match = trimmed.match(/([A-Za-z_$][\w$]*)\s*===?\s*null/);
    if (match) {
      results.push({ name: match[1], type: mapPrimitive('null', languageId) });
      continue;
    }
  }
  return results.filter((entry) => entry.name && entry.type);
};

export function inferTypeMetadata({ docmeta, chunkText, languageId }) {
  if (!docmeta || typeof docmeta !== 'object') return null;
  const inferred = {
    params: Object.create(null),
    returns: [],
    fields: Object.create(null),
    locals: Object.create(null)
  };
  let hasData = false;

  const paramTypes = docmeta.paramTypes || {};
  for (const [name, type] of Object.entries(paramTypes)) {
    const normalized = normalizeTypeName(type, languageId);
    if (!normalized) continue;
    hasData = addTypes(inferred.params, name, {
      type: normalized,
      source: TYPE_SOURCES.annotation,
      confidence: CONFIDENCE.annotation
    }, languageId) || hasData;
  }

  const paramDefaults = docmeta.paramDefaults || {};
  for (const [name, value] of Object.entries(paramDefaults)) {
    const inferredType = inferLiteralType(value, languageId);
    if (!inferredType) continue;
    hasData = addTypes(inferred.params, name, {
      ...inferredType,
      source: TYPE_SOURCES.default,
      confidence: CONFIDENCE.default
    }, languageId) || hasData;
  }

  const declaredReturns = collectDeclaredReturnTypes(docmeta);
  for (const rawType of declaredReturns) {
    const returnType = normalizeTypeName(rawType, languageId);
    if (!returnType) continue;
    hasData = addReturnTypes(inferred.returns, {
      type: returnType,
      source: TYPE_SOURCES.annotation,
      confidence: CONFIDENCE.annotation
    }, languageId) || hasData;
  }

  if (Array.isArray(docmeta.fields)) {
    for (const field of docmeta.fields) {
      if (!field || !field.name) continue;
      if (field.type) {
        hasData = addTypes(inferred.fields, field.name, {
          type: normalizeTypeName(field.type, languageId),
          source: TYPE_SOURCES.annotation,
          confidence: CONFIDENCE.annotation
        }, languageId) || hasData;
      }
      if (field.default) {
        const inferredType = inferLiteralType(field.default, languageId);
        if (inferredType) {
          hasData = addTypes(inferred.fields, field.name, {
            ...inferredType,
            source: TYPE_SOURCES.default,
            confidence: CONFIDENCE.default
          }, languageId) || hasData;
        }
      }
    }
  }

  const knownTypes = new Map();
  const captureKnownTypes = (bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    for (const [name, entries] of Object.entries(bucket)) {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) continue;
      const existing = knownTypes.get(name) || [];
      for (const entry of list) {
        if (!entry?.type) continue;
        existing.push(entry.type);
      }
      knownTypes.set(name, existing);
    }
  };
  captureKnownTypes(inferred.params);
  captureKnownTypes(inferred.fields);

  const assignmentResult = inferAssignments(chunkText, languageId, knownTypes);
  const locals = assignmentResult.locals || {};
  for (const [name, entries] of Object.entries(locals)) {
    for (const entry of entries) {
      hasData = addEntry(inferred.locals, name, entry) || hasData;
    }
  }

  const paramNameSet = new Set(Array.isArray(docmeta.params) ? docmeta.params : []);
  const conditionalTypes = inferConditionalTypes(chunkText, languageId);
  for (const entry of conditionalTypes) {
    if (!entry?.name || !entry?.type) continue;
    const target = paramNameSet.has(entry.name) ? inferred.params : inferred.locals;
    hasData = addEntry(target, entry.name, {
      type: entry.type,
      source: TYPE_SOURCES.flow,
      confidence: CONFIDENCE.flow
    }) || hasData;
  }
  if (!hasData) return null;
  if (!Object.keys(inferred.params).length) delete inferred.params;
  if (!Object.keys(inferred.fields).length) delete inferred.fields;
  if (!Object.keys(inferred.locals).length) delete inferred.locals;
  if (!inferred.returns.length) delete inferred.returns;
  return inferred;
}
