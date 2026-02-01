import Ajv from 'ajv/dist/2020.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});

const formatPath = (instancePath) => (instancePath ? `#${instancePath}` : '#');

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
  const validate = ajv.compile(schema);
  const ok = validate(config);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map(formatError);
  return { ok: false, errors };
}
