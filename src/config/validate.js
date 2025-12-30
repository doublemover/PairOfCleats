const TYPE_NAMES = {
  array: 'array',
  boolean: 'boolean',
  integer: 'integer',
  null: 'null',
  number: 'number',
  object: 'object',
  string: 'string'
};

function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

function normalizeTypes(type) {
  if (!type) return [];
  return Array.isArray(type) ? type : [type];
}

function formatPath(base, key) {
  if (key === null || key === undefined) return base;
  if (typeof key === 'number') return `${base}[${key}]`;
  if (!base || base === '$') return `$.${key}`;
  return `${base}.${key}`;
}

function validateValue(value, schema, path) {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  const types = normalizeTypes(schema.type);
  if (types.length) {
    const matched = types.some((type) => matchesType(value, type));
    if (!matched) {
      const expected = types.map((type) => TYPE_NAMES[type] || type).join(' or ');
      errors.push(`${path} should be ${expected}`);
      return errors;
    }
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path} should be one of ${schema.enum.join(', ')}`);
      return errors;
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateValue(item, schema.items, formatPath(path, index)));
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const required = new Set(schema.required || []);
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${formatPath(path, key)} is required`);
      }
    }

    const known = schema.properties || {};
    for (const [key, val] of Object.entries(value)) {
      if (known[key]) {
        errors.push(...validateValue(val, known[key], formatPath(path, key)));
        continue;
      }
      if (schema.additionalProperties === false) {
        errors.push(`${formatPath(path, key)} is not allowed`);
        continue;
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validateValue(val, schema.additionalProperties, formatPath(path, key)));
      }
    }
  }

  return errors;
}

export function validateConfig(schema, config) {
  const errors = validateValue(config, schema, '$');
  return { ok: errors.length === 0, errors };
}
