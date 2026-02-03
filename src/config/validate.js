import Ajv from 'ajv/dist/2020.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});

const validatorCache = new WeakMap();
const BLOCKED_REQUIRED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const ensureObjectMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
  if (Object.getPrototypeOf(value) === null) return value;
  return Object.assign(Object.create(null), value);
};

const formatPath = (instancePath) => (instancePath ? `#${instancePath}` : '#');

const ensureRequiredProperties = (schema, visited = new WeakSet()) => {
  if (!schema || typeof schema !== 'object') return;
  if (visited.has(schema)) return;
  visited.add(schema);
  if (Array.isArray(schema)) {
    schema.forEach((entry) => ensureRequiredProperties(entry, visited));
    return;
  }
  const hasObjectType = schema.type === 'object'
    || (Array.isArray(schema.type) && schema.type.includes('object'))
    || schema.properties
    || schema.required
    || schema.additionalProperties !== undefined
    || schema.patternProperties;
  if (hasObjectType && schema.additionalProperties === false && Array.isArray(schema.required)) {
    schema.properties = ensureObjectMap(schema.properties);
    for (const key of schema.required) {
      if (typeof key !== 'string') continue;
      if (BLOCKED_REQUIRED_KEYS.has(key)) continue;
      if (!schema.properties[key]) schema.properties[key] = {};
    }
  }

  const visitMap = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const value of Object.values(map)) {
      ensureRequiredProperties(value, visited);
    }
  };

  visitMap(schema.properties);
  visitMap(schema.patternProperties);
  visitMap(schema.$defs);
  visitMap(schema.definitions);
  visitMap(schema.dependencies);
  visitMap(schema.dependentSchemas);

  if (schema.items) ensureRequiredProperties(schema.items, visited);
  if (schema.anyOf) ensureRequiredProperties(schema.anyOf, visited);
  if (schema.oneOf) ensureRequiredProperties(schema.oneOf, visited);
  if (schema.allOf) ensureRequiredProperties(schema.allOf, visited);
  if (schema.not) ensureRequiredProperties(schema.not, visited);
  if (schema.if) ensureRequiredProperties(schema.if, visited);
  if (schema.then) ensureRequiredProperties(schema.then, visited);
  if (schema.else) ensureRequiredProperties(schema.else, visited);
};

const formatError = (error) => {
  const basePath = formatPath(error.instancePath);
  if (error.keyword === 'required' && error.params?.missingProperty) {
    return `${basePath}/${error.params.missingProperty} is required`;
  }
  if (error.keyword === 'additionalProperties' && error.params?.additionalProperty) {
    return `${basePath}/${error.params.additionalProperty} is not allowed`;
  }
  if (error.message) {
    return `${basePath} ${error.message}`.trim();
  }
  return `${basePath} is invalid`;
};

export function validateConfig(schema, config) {
  const cacheKey = schema && typeof schema === 'object' ? schema : null;
  let validate = cacheKey ? validatorCache.get(cacheKey) : null;
  if (!validate) {
    const normalizedSchema = structuredClone(schema);
    ensureRequiredProperties(normalizedSchema);
    validate = ajv.compile(normalizedSchema);
    if (cacheKey) validatorCache.set(cacheKey, validate);
  }
  const ok = validate(config);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map(formatError);
  return { ok: false, errors };
}
