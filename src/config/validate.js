import Ajv from 'ajv/dist/2020.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});

const formatPath = (instancePath) => (instancePath ? `#${instancePath}` : '#');

const ensureRequiredProperties = (schema) => {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    schema.forEach((entry) => ensureRequiredProperties(entry));
    return;
  }
  const hasObjectType = schema.type === 'object'
    || (Array.isArray(schema.type) && schema.type.includes('object'))
    || schema.properties
    || schema.required
    || schema.additionalProperties !== undefined
    || schema.patternProperties;
  if (hasObjectType && schema.additionalProperties === false && Array.isArray(schema.required)) {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      schema.properties = {};
    }
    for (const key of schema.required) {
      if (typeof key !== 'string') continue;
      if (!schema.properties[key]) schema.properties[key] = {};
    }
  }

  const visitMap = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const value of Object.values(map)) {
      ensureRequiredProperties(value);
    }
  };

  visitMap(schema.properties);
  visitMap(schema.patternProperties);
  visitMap(schema.$defs);
  visitMap(schema.definitions);
  visitMap(schema.dependencies);
  visitMap(schema.dependentSchemas);

  if (schema.items) ensureRequiredProperties(schema.items);
  if (Array.isArray(schema.items)) schema.items.forEach((item) => ensureRequiredProperties(item));
  if (schema.anyOf) ensureRequiredProperties(schema.anyOf);
  if (schema.oneOf) ensureRequiredProperties(schema.oneOf);
  if (schema.allOf) ensureRequiredProperties(schema.allOf);
  if (schema.not) ensureRequiredProperties(schema.not);
  if (schema.if) ensureRequiredProperties(schema.if);
  if (schema.then) ensureRequiredProperties(schema.then);
  if (schema.else) ensureRequiredProperties(schema.else);
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
  const normalizedSchema = structuredClone(schema);
  ensureRequiredProperties(normalizedSchema);
  const validate = ajv.compile(normalizedSchema);
  const ok = validate(config);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map(formatError);
  return { ok: false, errors };
}
