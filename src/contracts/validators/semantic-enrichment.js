import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_ENRICHMENT_SCHEMAS } from '../schemas/semantic-enrichment.js';
const ajv = createAjv({ strict: true, allErrors: true });
const validators = new Map(Object.entries(SEMANTIC_ENRICHMENT_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertSemanticEnrichment = (kind, value) => {
  const validate = validators.get(kind);
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid semantic enrichment ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: 'ERR_SEMANTIC_ENRICHMENT_CONTRACT' });
  if (kind === 'request' && value.action && value.action !== 'plan' && !value.taskIds?.length) {
    throw Object.assign(new TypeError('Explicit enqueue/drain requires exact task IDs.'), { code: 'ERR_SEMANTIC_ENRICHMENT_CONTRACT' });
  }
  return value;
};
