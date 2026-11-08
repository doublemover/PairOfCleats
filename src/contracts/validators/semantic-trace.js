import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_TRACE_REQUEST_SCHEMA, SEMANTIC_TRACE_RESULT_SCHEMA } from '../schemas/semantic-trace.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { semanticTracePathDeclaration } from '../../semantic/path-capabilities.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, SEMANTIC_TRACE_REQUEST_SCHEMA), result: compileSchema(ajv, SEMANTIC_TRACE_RESULT_SCHEMA) };
export const assertSemanticTraceProjection = (value, operation) => {
  if (value.coverage.response.returnedCount !== value.records.length) throw new TypeError('Semantic response count mismatch.');
  for (const row of value.records) {
    if (row.id !== row.ref.localId) throw new TypeError('Semantic projection identity mismatch.');
    for (const field of ['span', 'scope', 'data']) if (Object.hasOwn(row, field) === row.omittedFieldGroups.includes(field)) throw new TypeError('Semantic projection field disclosure mismatch.');
  }
  const capability = value.pathCapability;
  if (capability) {
    const expected = semanticTracePathDeclaration(capability.declaration.semantics, operation);
    if (canonicalSemanticJson(capability.declaration) !== canonicalSemanticJson(expected)
      || canonicalSemanticJson(capability.scope.generation) !== canonicalSemanticJson(value.generation)
      || capability.selectedKinds.some(kind => !expected.edgeKinds.includes(kind))
      || value.edges.some(edge => !capability.selectedKinds.includes(edge.kind))) {
      throw new TypeError('Semantic path declaration differs from its operation, generation or selected edges.');
    }
    if (value.records.length > capability.limits.records || value.edges.length > capability.limits.edges
      || Buffer.byteLength(JSON.stringify(value)) > capability.limits.bytes) throw new TypeError('Semantic path result exceeds its declared response limits.');
    if (capability.limits.callContextDepth !== (expected.semantics === 'balanced-call-value' ? 16 : 0)) throw new TypeError('Semantic path context allowance differs from its declared policy.');
    if (value.coverage.response.state === 'complete' && value.frontier.some(row => row.reason !== 'analysis_incomplete')) {
      throw new TypeError('Incomplete semantic path traversal cannot claim complete response coverage.');
    }
  }
  return value;
};
export const assertSemanticTrace = (kind, value, { operation = 'semantic_trace' } = {}) => {
  const validate = validators[kind];
  if (!validate) throw new TypeError('Unknown semantic trace contract: ' + kind);
  if (!validate(value)) throw Object.assign(new TypeError('Invalid semantic trace ' + kind + ': ' + ajv.errorsText(validate.errors)), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  if (kind === 'result') assertSemanticTraceProjection(value, operation);
  return value;
};
