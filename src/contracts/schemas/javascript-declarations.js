import { JAVASCRIPT_RELATIONS_VERSION } from '../../lang/javascript/version.js';
import { EMBEDDED_CONTENT_VIEW_SCHEMA } from './embedded-content.js';
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullableString = { type: ['string', 'null'] };
const range = { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: count, end: count } };
const id = { type: 'string', pattern: '^jsdecl1:[a-f0-9]{64}$' };
const digest = { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' };
export const JS_EVALUATION_PHASES = ['module-evaluation', 'invocation-body', 'parameter-initialization', 'definition-evaluation', 'class-static-initialization', 'class-instance-initialization'];
export const JAVASCRIPT_DECLARATION_CATALOG_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'producerVersion', 'source', 'analysis', 'records', 'rangeOwners', 'nameOwners', 'coverage'], properties: {
    schemaVersion: { const: 1 }, producerVersion: { const: JAVASCRIPT_RELATIONS_VERSION },
    source: { type: 'object', additionalProperties: false, required: ['encoding', 'length', 'textHash', 'parser', 'state'], properties: {
      encoding: { const: 'utf16le-js-string' }, length: count, textHash: digest, state: { enum: ['qualified', 'unavailable'] },
      parser: { type: ['object', 'null'], additionalProperties: false, required: ['family', 'version'],
        properties: { family: { enum: ['babel', 'acorn', 'esprima'] }, version: { type: 'string', minLength: 1, maxLength: 128 } } } } },
    analysis: { type: 'object', additionalProperties: false, required: ['dataflow', 'controlFlow'],
      properties: { dataflow: { type: 'boolean' }, controlFlow: { type: 'boolean' } } },
    records: { type: 'object', maxProperties: 10000, additionalProperties: { type: 'object', additionalProperties: false,
      required: ['id', 'sourceHash', 'range', 'role', 'associations', 'kind', 'displayName', 'internalName', 'parentId', 'metadata'], properties: {
        id, sourceHash: digest, range, role: { type: 'string', minLength: 1, maxLength: 128 }, kind: { enum: ['module', 'class', 'callable', 'evaluation'] },
        displayName: { type: 'string' }, internalName: nullableString, parentId: { ...id, type: ['string', 'null'] }, metadata: { type: 'object' },
        scopeState: { enum: ['complete', 'partial'] }, scopeReasons: { type: 'array', maxItems: 16, items: { type: 'string' } },
        associations: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['kind', 'range'],
          properties: { kind: { enum: ['declaration', 'variable-initializer', 'assignment-value', 'member-value', 'export-declaration'] }, range } } }
      } } },
    rangeOwners: { type: 'object', maxProperties: 20000, additionalProperties: { type: 'array', minItems: 1, maxItems: 4, items: id } },
    nameOwners: { type: 'object', maxProperties: 10000, additionalProperties: { type: 'array', minItems: 1, maxItems: 10000, items: id } },
    coverage: { type: 'object', additionalProperties: false,
      required: ['state', 'reasons', 'maxDeclarations', 'maxAssociationsPerDeclaration', 'maxTraversalSteps', 'maxQueuedSteps', 'visitedSteps', 'omittedDeclarations'],
      properties: { state: { enum: ['complete', 'partial', 'unavailable'] }, reasons: { type: 'array', maxItems: 16, items: { type: 'string' } },
        maxDeclarations: { const: 10000 }, maxAssociationsPerDeclaration: { const: 2 }, maxTraversalSteps: { const: 250000 }, maxQueuedSteps: { const: 50000 },
        visitedSteps: count, omittedDeclarations: { const: null } } }
  } };
export const JAVASCRIPT_CALLABLE_JOIN_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'state', 'reason', 'occurrenceId', 'role', 'ownerRange', 'projectionRange', 'sourceHash', 'internalName', 'sourceMapping', 'parentId'], properties: {
    schemaVersion: { const: 1 }, state: { enum: ['qualified', 'partial', 'unavailable', 'ambiguous'] }, reason: nullableString,
    occurrenceId: { ...id, type: ['string', 'null'] }, role: nullableString, sourceHash: digest, internalName: nullableString,
    ownerRange: { anyOf: [range, { type: 'null' }] }, projectionRange: range, parentId: { ...id, type: ['string', 'null'] },
    sourceMapping: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['offset', 'length'], properties: { offset: count, length: count } },
      { type: 'object', additionalProperties: false, required: ['schemaVersion', 'contentView'],
        properties: { schemaVersion: { const: 2 }, contentView: EMBEDDED_CONTENT_VIEW_SCHEMA } }
    ] }
  } };
export const JAVASCRIPT_EVALUATION_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'occurrenceId', 'sourceHash', 'ownerRange', 'phase', 'conditional', 'meaning', 'state', 'invocationKind', 'sourceOffset'], properties: {
    schemaVersion: { const: 1 }, occurrenceId: id, sourceHash: digest, ownerRange: range,
    phase: { enum: JS_EVALUATION_PHASES }, conditional: { type: 'boolean' }, meaning: { const: 'potential-source-syntax-within-owner-phase' },
    state: { enum: ['qualified', 'unavailable'] }, invocationKind: { enum: ['call', 'construct'] }, sourceOffset: count
  } };
