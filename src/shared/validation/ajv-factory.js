import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';

const AJV_DIALECTS = Object.freeze({
  default: Ajv,
  '2020': Ajv2020
});

export const cloneJsonSchema = (schema) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(schema);
  }
  return JSON.parse(JSON.stringify(schema));
};

export const createAjv = ({ dialect = 'default', ...options } = {}) => {
  const AjvConstructor = AJV_DIALECTS[dialect];
  if (!AjvConstructor) {
    throw new Error(`Unsupported Ajv dialect: ${dialect}`);
  }
  return new AjvConstructor(options);
};

export const compileSchema = (ajv, schema, { clone = true } = {}) => {
  if (!ajv || typeof ajv.compile !== 'function') {
    throw new TypeError('compileSchema requires an Ajv instance');
  }
  return ajv.compile(clone ? cloneJsonSchema(schema) : schema);
};

