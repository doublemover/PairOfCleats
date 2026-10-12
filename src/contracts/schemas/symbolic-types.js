import { ARTIFACT_SURFACE_VERSION } from '../versioning.js';
import { SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';

export const SYMBOLIC_TYPE_SCHEMA_VERSION = 1;
export const SYMBOLIC_TYPE_GRAPH_MAX_BYTES = 16 * 1024 * 1024;
export const SYMBOLIC_TYPE_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
const object = (properties, optional = {}) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties: { ...properties, ...optional } });
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const graphId = { type: 'string', pattern: '^stg1:[a-f0-9]{64}$' };
const nodeId = { type: 'string', pattern: '^tir1:[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const displayText = { type: 'string', maxLength: 16384 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
export const SYMBOLIC_TYPE_REF_SCHEMA = object({ schemaVersion: { const: SYMBOLIC_TYPE_SCHEMA_VERSION },
  domain: { const: 'finite-string' }, graphId, contextKey: text, nodeId });
const virtualOrigin = object({ kind: { const: 'virtual' }, virtualPath: text,
  containerPath: nullable(text), segmentUid: nullable(text),
  segmentRange: nullable(object({ start: integer, end: integer })), mappingIdentity: nullable(text),
  mappingQuality: { enum: ['exact', 'coarse', 'synthetic', 'unmapped'] } });
export const SYMBOLIC_TYPE_DECLARATION_SCHEMA = object({ sourceId: text, sourceHash: hash, start: integer, end: integer },
  { origin: virtualOrigin });
export const TYPE_EXPRESSIONS_SCHEMA = object({ schemaVersion: { const: SYMBOLIC_TYPE_SCHEMA_VERSION },
  interpretation: { const: 'declared-type-denotation' },
  returnType: nullable(SYMBOLIC_TYPE_REF_SCHEMA),
  params: { type: 'object', maxProperties: 1024, propertyNames: text,
    additionalProperties: { type: 'array', minItems: 1, maxItems: 1024, items: SYMBOLIC_TYPE_REF_SCHEMA } },
  declarationRef: SYMBOLIC_TYPE_DECLARATION_SCHEMA,
  display: object({}, { returnType: displayText, signature: displayText,
    params: { type: 'object', maxProperties: 1024, propertyNames: text,
      additionalProperties: { type: 'array', maxItems: 1024, items: displayText } } })
}, { provenance: { type: 'array', maxItems: 4096, items: SYMBOLIC_TYPE_DECLARATION_SCHEMA } });
export const SYMBOLIC_TYPE_GRAPH_SCHEMA = object({ schemaVersion: { const: SYMBOLIC_TYPE_SCHEMA_VERSION },
  domain: { const: 'finite-string' }, contextKey: text, rootIds: { type: 'array', minItems: 1, maxItems: 100000, uniqueItems: true, items: nodeId },
  nodes: { type: 'array', minItems: 1, maxItems: 100000, items: { oneOf: [
    object({ id: nodeId, kind: { const: 'Literal' }, value: { type: 'string', maxLength: 1000000 } }),
    object({ id: nodeId, kind: { enum: ['Union', 'Concat'] },
      children: { type: 'array', maxItems: 100000, items: nodeId } })
  ] } }
});
export const SYMBOLIC_TYPE_GRAPH_ENTRY_SCHEMA = object({ graphId, graph: SYMBOLIC_TYPE_GRAPH_SCHEMA });
export const SYMBOLIC_TYPE_MANIFEST_SCHEMA = object({ schemaVersion: { const: SYMBOLIC_TYPE_SCHEMA_VERSION },
  artifactSurfaceVersion: { const: ARTIFACT_SURFACE_VERSION }, generation: SEMANTIC_GENERATION_SCHEMA,
  status: { const: 'complete' }, graphs: { type: 'array', maxItems: 256, items: object({
    graphId, contextKey: text, path: { type: 'string', pattern: '^symbolic-types/[a-f0-9]{64}\\.json$' },
    hash, bytes: { type: 'integer', minimum: 1, maximum: SYMBOLIC_TYPE_GRAPH_MAX_BYTES }, nodeCount: integer
  }) } });
export const SYMBOLIC_TYPE_QUERY_SCHEMA = { oneOf: [
  object({ ref: SYMBOLIC_TYPE_REF_SCHEMA, operation: { const: 'membership' }, value: { type: 'string', maxLength: 16384 } }),
  object({ ref: SYMBOLIC_TYPE_REF_SCHEMA, operation: { const: 'classify' } })
] };
export const SYMBOLIC_TYPE_QUERY_RESULT_SCHEMA = { oneOf: [
  object({ ref: SYMBOLIC_TYPE_REF_SCHEMA, operation: { const: 'membership' }, contains: { type: 'boolean' }, complete: { const: true } }),
  object({ ref: SYMBOLIC_TYPE_REF_SCHEMA, operation: { const: 'classify' },
    cardinality: { enum: ['zero', 'one', 'many'] }, witnesses: { type: 'array', maxItems: 2, items: { type: 'string' } }, complete: { const: true } })
] };
