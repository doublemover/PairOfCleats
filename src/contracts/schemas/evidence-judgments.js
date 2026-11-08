import { semanticObject as object, semanticHashSchema as hash } from './semantic-envelopes.js';
import { QUESTION_SOURCE_REFERENCE_SCHEMA as source } from './repository-question.js';
const receipts = { type: 'array', items: hash, minItems: 1, maxItems: 32, uniqueItems: true };

/** Explicit authored annotation under the existing task/split authority. This
 * profile does not execute the named checker or independently verify its receipt.
 */
export const EVIDENCE_JUDGMENTS_SCHEMA = object({ schemaVersion: { const: 1 }, profile: { const: 'authored-source-relevance-v1' },
  compilationId: hash, privateOracleId: hash, splitManifestId: hash, requirementId: hash, rawQueryHash: hash,
  producerId: hash, assumptionsId: hash, rightsScopeId: hash, reviewReceiptIds: receipts,
  judgments: { type: 'array', minItems: 1, maxItems: 256, items: object({ source,
    label: { enum: ['positive', 'verified-negative', 'unknown'] }, grade: { type: 'integer', minimum: 0, maximum: 3 },
    weight: { type: 'number', minimum: 0, maximum: 1 },
    basis: { enum: ['explicit-task-relevance-annotation', 'named-requirement-counterexample', 'unknown'] }, receiptIds: receipts }) },
  positiveAliases: { type: 'array', maxItems: 64, items: object({ left: source, right: source, reviewReceiptIds: receipts }) } });
