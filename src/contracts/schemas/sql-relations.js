import { SQL_RELATION_PRODUCER_VERSION } from '../../lang/sql/version.js';

const name = { type: 'string', minLength: 1, maxLength: 1024 };
const count = { type: 'integer', minimum: 0 };
const span = { type: ['array', 'null'], minItems: 2, maxItems: 2, items: count };

/** A decoded AST-name observation, not a resolved SQL catalog identity. */
export const SQL_RELATION_EVIDENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'producerVersion', 'dialect', 'parserVersion', 'textHash', 'textHashEncoding',
    'textLength', 'identifierPolicy', 'coverage', 'counts', 'occurrences'],
  properties: {
    textLength: count, schemaVersion: { const: 1 }, producerVersion: { const: SQL_RELATION_PRODUCER_VERSION }, dialect: { type: 'string', minLength: 1 },
    parserVersion: { type: ['string', 'null'] }, textHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
    textHashEncoding: { const: 'utf16le-js-string' },
    identifierPolicy: { const: 'parser-decoded-segments;quote-and-catalog-binding-unqualified' },
    coverage: { type: 'object', additionalProperties: false,
      required: ['state', 'recognition', 'reasons', 'scope', 'catalogBinding', 'omittedOccurrences'],
      properties: { state: { const: 'partial' }, recognition: { enum: ['unavailable', 'partial-empty', 'recognized-empty', 'recognized-nonempty'] },
        reasons: { type: 'object', maxProperties: 16, additionalProperties: { type: 'integer', minimum: 1 } },
        scope: { const: ['statement-relation-heads', 'cte-references', 'derived-bindings', 'query-alias-observations', 'column-qualifiers'] },
        catalogBinding: { const: 'not-attempted' }, omittedOccurrences: { const: null } } },
    counts: { type: 'object', additionalProperties: false, required: ['nodesVisited', 'statements', 'retainedOccurrences'],
      properties: { nodesVisited: { ...count, maximum: 32768 }, statements: { ...count, maximum: 32768 }, retainedOccurrences: { ...count, maximum: 4096 } } },
    occurrences: { type: 'array', maxItems: 4096, items: { type: 'object', additionalProperties: false,
      required: ['role', 'parts', 'alias', 'statementScope', 'astPath', 'span', 'decodedNameId', 'display', 'occurrenceId'],
      properties: { role: { enum: ['relation-use', 'relation-declaration', 'cte-reference-candidate', 'derived-binding',
        'query-alias', 'column-qualifier', 'unqualified-relation-reference'] }, parts: { type: 'array', maxItems: 3, items: name },
      alias: { ...name, type: ['string', 'null'] }, statementScope: { type: 'string', minLength: 1 }, astPath: { type: 'string', minLength: 1 },
      span, decodedNameId: { type: ['string', 'null'], pattern: '^sql-name1:[a-f0-9]{64}$' }, display: { type: ['string', 'null'] },
      occurrenceId: { type: 'string', pattern: '^sql-occ1:[a-f0-9]{64}$' } } } }
  }
};
