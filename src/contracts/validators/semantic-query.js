import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_DETAIL_REQUEST_SCHEMA, SEMANTIC_DETAIL_RESULT_SCHEMA } from '../schemas/semantic-query.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = {
  detailRequest: compileSchema(ajv, SEMANTIC_DETAIL_REQUEST_SCHEMA),
  detailResult: compileSchema(ajv, SEMANTIC_DETAIL_RESULT_SCHEMA)
};
export const assertSemanticQuery = (kind, value) => {
  const validate = validators[kind];
  if (!validate) throw new TypeError('Unknown semantic query contract: ' + kind);
  if (!validate(value)) throw Object.assign(new TypeError('Invalid semantic query ' + kind + ': ' + ajv.errorsText(validate.errors)),
    { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  if (kind === 'detailResult') {
    for (const row of value.records) {
      if (row.id !== row.ref.localId) throw new TypeError('Semantic projection identity mismatch.');
      for (const field of ['span', 'scope', 'data']) {
        if (Object.hasOwn(row, field) === row.omittedFieldGroups.includes(field)) throw new TypeError('Semantic projection field disclosure mismatch.');
      }
    }
    if (value.coverage.response.returnedCount !== value.records.length) throw new TypeError('Semantic response count mismatch.');
    for (const entry of value.providerEvidence || []) {
      for (const span of [entry.span, entry.target?.span, entry.observedTarget?.span]) {
        if (span && span[0] > span[1]) throw new TypeError('Provider evidence range is reversed.');
      }
      if (entry.target && (entry.kind !== 'reference' || entry.qualification !== 'source-qualified-observation'
        || entry.sourceUnitId === null || entry.sourceHash === null)) throw new TypeError('Navigable provider evidence lacks qualified source authority.');
      if (entry.qualification === 'source-qualified-observation' && (entry.sourceUnitId === null || entry.sourceHash === null)) throw new TypeError('Qualified provider evidence lacks original source identity.');
      if (entry.kind === 'observation' && entry.target) throw new TypeError('Captured provider observations are not independently verified navigation targets.');
      if (entry.kind === 'reference' && ((entry.target !== null) !== (entry.state === 'partial')
        || entry.target !== null && entry.candidateCount < 1)) throw new TypeError('Provider reference state differs from its qualified target.');
      const observed = entry.observedTarget;
      if (observed && ((observed.sourceUnitId === null) !== (observed.sourceHash === null)
        || observed.span !== null && observed.sourceUnitId === null)) throw new TypeError('Observed provider coordinates lack captured source identity.');
    }
  }
  return value;
};
