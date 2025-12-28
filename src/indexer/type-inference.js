const TYPE_SOURCES = {
  annotation: 'annotation',
  default: 'default',
  literal: 'literal'
};

const CONFIDENCE = {
  annotation: 0.95,
  default: 0.7,
  literal: 0.6
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

const normalizeDefaultValue = (raw) => {
  let value = normalizeText(raw);
  if (!value || value === '...' || value === '…') return '';
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

const inferLiteralType = (raw, languageId) => {
  const value = normalizeDefaultValue(raw);
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (languageId === 'python') {
    if (lowered === 'none') return PYTHON_TYPES.null;
    if (lowered === 'true' || lowered === 'false') return PYTHON_TYPES.boolean;
    if (/^-?\d+\.\d+$/.test(value)) return PYTHON_TYPES.float;
    if (/^-?\d+$/.test(value)) return PYTHON_TYPES.number;
    if (value.startsWith('[')) return PYTHON_TYPES.array;
    if (value.startsWith('{')) return PYTHON_TYPES.object;
    if (value.startsWith('(')) return PYTHON_TYPES.tuple;
    if (lowered.startsWith('set(')) return PYTHON_TYPES.set;
    if (lowered.startsWith('dict(')) return PYTHON_TYPES.object;
    if (lowered.startsWith('list(')) return PYTHON_TYPES.array;
  } else {
    if (lowered === 'null') return JS_TYPES.null;
    if (lowered === 'undefined') return JS_TYPES.undefined;
    if (lowered === 'true' || lowered === 'false') return JS_TYPES.boolean;
    if (/^-?\d+(\.\d+)?$/.test(value)) return JS_TYPES.number;
    if (value.startsWith('[')) return JS_TYPES.array;
    if (value.startsWith('{')) return JS_TYPES.object;
  }
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
    return mapPrimitive('string', languageId);
  }
  const newMatch = value.match(/^new\s+([A-Za-z_][\w.]*)/);
  if (newMatch) return newMatch[1];
  return null;
};

const addEntry = (bucket, key, entry) => {
  if (!bucket || !key || !entry?.type) return false;
  const list = bucket[key] || [];
  const existing = list.find((item) => item.type === entry.type && item.source === entry.source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence, entry.confidence || 0);
    bucket[key] = list;
    return true;
  }
  bucket[key] = [...list, entry];
  return true;
};

const addListEntry = (list, entry) => {
  if (!Array.isArray(list) || !entry?.type) return false;
  const existing = list.find((item) => item.type === entry.type && item.source === entry.source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence, entry.confidence || 0);
    return true;
  }
  list.push(entry);
  return true;
};

const inferAssignments = (chunkText, languageId) => {
  const locals = {};
  if (!chunkText) return locals;
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
      type: inferred,
      source: TYPE_SOURCES.literal,
      confidence: CONFIDENCE.literal
    });
  }
  return locals;
};

export function inferTypeMetadata({ docmeta, chunkText, languageId }) {
  if (!docmeta || typeof docmeta !== 'object') return null;
  const inferred = {
    params: {},
    returns: [],
    fields: {},
    locals: {}
  };
  let hasData = false;

  const paramTypes = docmeta.paramTypes || {};
  for (const [name, type] of Object.entries(paramTypes)) {
    const normalized = normalizeText(type);
    if (!normalized) continue;
    hasData = addEntry(inferred.params, name, {
      type: normalized,
      source: TYPE_SOURCES.annotation,
      confidence: CONFIDENCE.annotation
    }) || hasData;
  }

  const paramDefaults = docmeta.paramDefaults || {};
  for (const [name, value] of Object.entries(paramDefaults)) {
    const inferredType = inferLiteralType(value, languageId);
    if (!inferredType) continue;
    hasData = addEntry(inferred.params, name, {
      type: inferredType,
      source: TYPE_SOURCES.default,
      confidence: CONFIDENCE.default
    }) || hasData;
  }

  const returnType = normalizeText(docmeta.returnType);
  if (returnType) {
    hasData = addListEntry(inferred.returns, {
      type: returnType,
      source: TYPE_SOURCES.annotation,
      confidence: CONFIDENCE.annotation
    }) || hasData;
  }

  if (Array.isArray(docmeta.fields)) {
    for (const field of docmeta.fields) {
      if (!field || !field.name) continue;
      if (field.type) {
        hasData = addEntry(inferred.fields, field.name, {
          type: normalizeText(field.type),
          source: TYPE_SOURCES.annotation,
          confidence: CONFIDENCE.annotation
        }) || hasData;
      }
      if (field.default) {
        const inferredType = inferLiteralType(field.default, languageId);
        if (inferredType) {
          hasData = addEntry(inferred.fields, field.name, {
            type: inferredType,
            source: TYPE_SOURCES.default,
            confidence: CONFIDENCE.default
          }) || hasData;
        }
      }
    }
  }

  const locals = inferAssignments(chunkText, languageId);
  for (const [name, entries] of Object.entries(locals)) {
    for (const entry of entries) {
      hasData = addEntry(inferred.locals, name, entry) || hasData;
    }
  }

  if (!hasData) return null;
  if (!Object.keys(inferred.params).length) delete inferred.params;
  if (!Object.keys(inferred.fields).length) delete inferred.fields;
  if (!Object.keys(inferred.locals).length) delete inferred.locals;
  if (!inferred.returns.length) delete inferred.returns;
  return inferred;
}
