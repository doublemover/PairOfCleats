import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { EMBEDDED_SOURCE_MAP_SCHEMA } from '../schemas/embedded-source-map.js';

const ajv = createAjv({ allErrors: true, strict: true });
const validate = compileSchema(ajv, EMBEDDED_SOURCE_MAP_SCHEMA);
export const assertEmbeddedSourceMap = value => {
  if (!validate(value) || value.parentEnd <= value.parentStart
    || value.quality === 'exact' && value.localEnd !== value.parentEnd - value.parentStart) {
    throw Object.assign(new TypeError('Invalid embedded source map: ' + ajv.errorsText(validate.errors)), {
      code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT'
    });
  }
  return value;
};
