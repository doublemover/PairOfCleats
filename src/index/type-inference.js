import { collectDeclaredReturnTypes } from './metadata/docmeta.js';
import { normalizeLiteralInput, inspectLiteralStructure, splitLiteralElements, isWholeQuotedLiteral } from './type-inference/literal-expression.js';

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
  if (languageId === 'python') {
    const pyMap = {
      integer: 'int',
      bool: 'bool',
      boolean: 'bool',
      string: 'str',
      array: 'list',
      object: 'dict'
    };
    return Object.hasOwn(pyMap, normalized) ? pyMap[normalized] : normalized;
  }
  const jsMap = {
    integer: 'number',
    float: 'number',
    String: 'string',
    Boolean: 'boolean',
    Number: 'number',
    bool: 'boolean',
    string: 'string',
    array: 'array',
    object: 'object',
    dict: 'object',
    list: 'array'
  };
  return Object.hasOwn(jsMap, normalized) ? jsMap[normalized] : normalized;
};

// Candidate expansion is a lexical projection, not a type checker. Preserve the
// full annotation when quoting/nesting is malformed or exceeds this allowance.
const inspectTypeExpression = value => {
  if (!value || value.length > 65536 || value.includes('\u0000')) return null;
  const matching = { '<': '>', '[': ']', '(': ')', '{': '}' };
  const closers = new Set(Object.values(matching)), stack = [], pairs = new Map();
  const separators = new Map([['|', []], [',', []]]);
  let quote = null, outerOpen = -1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    // An unparenthesized function return or conditional branch owns later
    // unions. Preserve that unsupported outer grammar rather than flatten it.
    if (!stack.length && (char === '=' && value[index + 1] === '>' || char === '?' && index < value.length - 1)) return null;
    if (Object.hasOwn(matching, char)) {
      if (stack.length >= 128) return null;
      if (!stack.length && outerOpen < 0) outerOpen = index;
      stack.push(index);
    } else if (closers.has(char)) {
      if (char === '>' && value[index - 1] === '=') continue;
      const open = stack.pop();
      if (open == null || matching[value[open]] !== char) return null;
      pairs.set(open, index);
    } else if (!stack.length && separators.has(char)) separators.get(char).push(index);
  }
  if (quote || stack.length) return null;
  const split = delimiter => {
    const parts = [], cuts = separators.get(delimiter) || [];
    let start = 0;
    for (const end of [...cuts, value.length]) { parts.push(value.slice(start, end).trim()); start = end + 1; }
    return parts.every(Boolean) ? parts : [];
  };
  let generic = null;
  if (outerOpen >= 0 && ['<', '['].includes(value[outerOpen]) && pairs.get(outerOpen) === value.length - 1) {
    const outer = value.slice(0, outerOpen).trim(), inner = value.slice(outerOpen + 1, -1).trim();
    if (inner && /^[\p{ID_Start}_$][\p{ID_Continue}$]*(?:(?:\.|::)[\p{ID_Start}_$][\p{ID_Continue}$]*)*$/u.test(outer)) generic = { outer, inner, opener: value[outerOpen] };
  }
  return { split, generic };
};

const splitTopLevel = (value, delimiter) => {
  return inspectTypeExpression(value)?.split(delimiter) || [];
};

const stripOptionalSuffix = (value) => {
  if (!value) return value;
  if (value.endsWith('?') && inspectTypeExpression(value)) return value.slice(0, -1).trim();
  return value;
};

const parseGeneric = (value) => {
  return inspectTypeExpression(value)?.generic || null;
};

const expandUnionTypes = (value, languageId) => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  if (languageId === 'python') {
    const generic = parseGeneric(normalized), argumentsList = generic ? splitTopLevel(generic.inner, ',') : [];
    if (generic?.opener === '[' && ['Optional', 'typing.Optional', 'typing_extensions.Optional'].includes(generic.outer)
      && argumentsList.length === 1) return [...argumentsList, PYTHON_TYPES.null];
    if (generic?.opener === '[' && ['Union', 'typing.Union', 'typing_extensions.Union'].includes(generic.outer)) {
      return argumentsList;
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
    // A generic's arguments describe its contained values, not additional
    // types of this parameter/return/field. Keep their ownership in the type.
  }
  return Array.from(seen).filter(Boolean);
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
  for (const part of splitLiteralElements(value.slice(1, -1))) {
    const structure = inspectLiteralStructure(part), colon = structure?.colons[0];
    const raw = colon === undefined ? part : part.slice(0, colon).trim();
    if (!/^[A-Za-z_$][\w$]*$/u.test(raw) && !(['"', "'"].includes(raw[0]) && isWholeQuotedLiteral(raw))) continue;
    const key = stripQuotes(raw);
    if (key) keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
};

const extractArrayElements = (value, limit, languageId, depth) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return null;
  const closeIndex = trimmed.lastIndexOf(']');
  if (closeIndex <= 0) return null;
  const inner = trimmed.slice(1, closeIndex);
  const parts = splitLiteralElements(inner).slice(0, limit);
  const elements = [];
  for (const part of parts) {
    const entry = inferLiteralType(part, languageId, depth + 1);
    if (entry?.type) elements.push(entry.type);
  }
  return unique(elements);
};

const inferLiteralType = (raw, languageId, depth = 0) => {
  if (depth > 128) return null;
  const value = normalizeLiteralInput(raw, languageId);
  if (!value) return null;
  const structure = inspectLiteralStructure(value);
  if (!structure) return null;
  const enclosed = structure.pairs.get(0) === value.length - 1;
  if (value[0] === '(' && enclosed) {
    const inner = value.slice(1, -1), layout = inspectLiteralStructure(inner);
    if (languageId === 'python' && /^lambda(?:\s|:)/u.test(inner.trim())) return null;
    if (languageId === 'python' && (!inner.trim() || layout?.commas.length)) return { type: PYTHON_TYPES.tuple };
    return inferLiteralType(inner, languageId, depth + 1);
  }
  if (languageId === 'python') {
    if (value === 'None') return { type: PYTHON_TYPES.null };
    if (value === 'True' || value === 'False') return { type: PYTHON_TYPES.boolean };
    if (/^-?\d+\.\d+$/.test(value)) return { type: PYTHON_TYPES.float };
    if (/^-?\d+$/.test(value)) return { type: PYTHON_TYPES.number };
    if (value.startsWith('[') && enclosed) {
      return {
        type: PYTHON_TYPES.array,
        elements: extractArrayElements(value, 25, languageId, depth)
      };
    }
    if (value.startsWith('{') && enclosed) {
      const inner = value.slice(1, -1).trim(), layout = inspectLiteralStructure(inner);
      if (splitLiteralElements(inner).some(part => /^lambda(?:\s|:)/u.test(part))) return null;
      if (inner && !layout.colons.length && !inner.startsWith('**')) return { type: PYTHON_TYPES.set };
      const keys = extractObjectKeys(value, 20);
      return {
        type: PYTHON_TYPES.object,
        shape: keys.length ? { kind: 'object', keys } : null
      };
    }
    for (const [name, type] of [['set', PYTHON_TYPES.set], ['dict', PYTHON_TYPES.object], ['list', PYTHON_TYPES.array]]) {
      if (value.startsWith(name + '(') && structure.pairs.get(name.length) === value.length - 1) return { type };
    }
  } else {
    if (value === 'null') return { type: JS_TYPES.null };
    if (value === 'undefined') return { type: JS_TYPES.undefined };
    if (value === 'true' || value === 'false') return { type: JS_TYPES.boolean };
    if (/^-?\d+(\.\d+)?$/.test(value)) return { type: JS_TYPES.number };
    if (value.startsWith('[') && enclosed) {
      return {
        type: JS_TYPES.array,
        elements: extractArrayElements(value, 25, languageId, depth)
      };
    }
    if (value.startsWith('{') && enclosed) {
      const keys = extractObjectKeys(value, 20);
      return {
        type: JS_TYPES.object,
        shape: keys.length ? { kind: 'object', keys } : null
      };
    }
  }
  if (isWholeQuotedLiteral(value, languageId)) {
    return { type: mapPrimitive('string', languageId) };
  }
  const newMatch = value.match(/^new\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/u);
  if (newMatch) {
    const tail = value.slice(newMatch[0].length).trim(), open = value.indexOf('(', newMatch[0].length);
    if (!tail || tail[0] === '(' && structure.pairs.get(open) === value.length - 1) {
      return { type: normalizeTypeName(newMatch[1], languageId) };
    }
  }
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

const inferAssignments = (chunkText,languageId,knownTypes) => {
  const locals=Object.create(null);
  if(!chunkText)return {locals};
  for(const line of chunkText.split(/\r?\n/)){
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith('//')||trimmed.startsWith('#')||trimmed.startsWith('*'))continue;
    const match=trimmed.match(/^(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=(?!=|>)\s*(.+)$/);
    if(!match)continue;
    const name=match[1],value=match[2];
    const inferred=inferLiteralType(value,languageId);
    if(inferred){
      addEntry(locals,name,{...inferred,source:TYPE_SOURCES.literal,confidence:CONFIDENCE.literal});
      knownTypes?.set(name,[inferred.type]);
      continue;
    }
    const alias=/^([A-Za-z_$][\w$.]*)\s*;?$/.exec(value);
    const types=alias&&knownTypes?.get(alias[1]);
    if(types?.length){
      for(const type of types)addEntry(locals,name,{type,source:TYPE_SOURCES.flow,confidence:CONFIDENCE.flow});
      knownTypes.set(name,[...types]);
    }else knownTypes?.delete(name);
  }
  return {locals};
};

const guardName = '[\\p{ID_Start}_$][\\p{ID_Continue}$\\u200c\\u200d]*';
const guardBoundary = '(?<![\\p{ID_Continue}$\\u200c\\u200d.#])';
const guardEnd = '(?![\\p{ID_Continue}$\\u200c\\u200d])';
const conditionalGuards = {
  typeof: new RegExp(guardBoundary + 'typeof\\s+(' + guardName + ')\\s*===?\\s*' + "(['\"])(string|number|boolean|object|function|undefined|symbol|bigint)\\2", 'gu'),
  instanceof: new RegExp(guardBoundary + '(' + guardName + ')\\s+instanceof\\s+(' + guardName + '(?:\\.' + guardName + ')*)' + guardEnd, 'gu'),
  array: new RegExp(guardBoundary + 'Array\\s*\\.\\s*isArray\\s*\\(\\s*(' + guardName + ')\\s*\\)', 'gu'),
  null: new RegExp(guardBoundary + '(' + guardName + ')\\s*===?\\s*null' + guardEnd, 'gu')
};
const inferConditionalTypes = (chunkText, languageId) => {
  const results = [];
  if (!chunkText || !['javascript', 'typescript', 'jsx', 'tsx'].includes(languageId)) return results;
  const unqualified = (pattern, text) => {
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(text));) {
      let previous = match.index - 1;
      while (previous >= 0 && /\s/u.test(text[previous])) previous--;
      if (text[previous] === '.' || text[previous] === '#') continue;
      if (pattern === conditionalGuards.instanceof || pattern === conditionalGuards.null) {
        let next = pattern.lastIndex;
        while (next < text.length && /\s/u.test(text[next])) next++;
        if (['.', '[', '('].includes(text[next])) continue;
      }
      return match;
    }
    return null;
  };
  const lines = chunkText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    let match = unqualified(conditionalGuards.typeof, trimmed);
    if (match) {
      results.push({ name: match[1], type: normalizeTypeName(match[3], languageId) });
      continue;
    }
    match = unqualified(conditionalGuards.instanceof, trimmed);
    if (match) {
      results.push({ name: match[1], type: normalizeTypeName(match[2], languageId) });
      continue;
    }
    match = unqualified(conditionalGuards.array, trimmed);
    if (match) {
      results.push({ name: match[1], type: mapPrimitive('array', languageId) });
      continue;
    }
    match = unqualified(conditionalGuards.null, trimmed);
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
