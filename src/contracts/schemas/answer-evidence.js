import { semanticObject as object, semanticInteger as uint } from './semantic-envelopes.js';
import { QUESTION_SOURCE_REFERENCE_SCHEMA, QUESTION_WORLD_SCHEMA } from './repository-question.js';
import { REPOSITORY_QUERY_RECEIPT_SCHEMA } from './repository-question-live.js';

export const ANSWER_EVIDENCE_VERSION = 1;
export const ANSWER_RENDERER_VERSION = 2;
const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const range = { type: 'array', minItems: 2, maxItems: 2, items: uint };
export const ANSWER_QUESTION_REF_SCHEMA = object({ id: text(256), revision: text(256) });
export const ANSWER_QUERY_RECEIPT_SCHEMA = REPOSITORY_QUERY_RECEIPT_SCHEMA;
export const ANSWER_QUOTATION_SCHEMA = object({ source: QUESTION_SOURCE_REFERENCE_SCHEMA,
  text: { type: 'string', maxLength: 32768 }, contentHash: hash });
export const ANSWER_INPUT_SCHEMA = object({ schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, questionRef: ANSWER_QUESTION_REF_SCHEMA,
  queryReceipt: ANSWER_QUERY_RECEIPT_SCHEMA, quotations: list(ANSWER_QUOTATION_SCHEMA, 16),
  openRequirements: list(object({ id: text(256), text: text(2048) }), 64) });
const support = object({ rule: { enum: ['retained-query-row-v1', 'retained-query-count-v1', 'verified-source-quotation-v1'] },
  inputIds: list(hash, 3), dependencyClaimIds: list(hash, 128), compatibilityRule: { const: 'exact-world-branch-assumptions-v1' } });
const claim = object({ id: hash, predicateId: { enum: ['retainedQueryTuple', 'retainedQueryCount', 'sourceContains'] }, predicateVersion: { const: 1 },
  worldId: hash, argumentsDigest: hash, assertionKind: { enum: ['structuralFact', 'checkedDomainFact', 'sourceText'] },
  polarity: { const: 'positive' }, quantifierScope: { enum: ['returned-page-tuples', 'named-retained-relation', 'exact-source-interval'] },
  sourceValidity: { enum: ['retained-source-headers', 'verified-retained-snapshot'] }, supportState: { const: 'supported' },
  supportSelection: { const: 'selected-provider-receipt' }, alternativesComplete: { const: false }, counterSupportState: { const: 'not-assessed' },
  support: list(support, 1) });
export const ANSWER_REVISION_SCHEMA = object({ schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, kind: { const: 'repository-answer-revision' },
  rendererVersion: { const: ANSWER_RENDERER_VERSION }, questionRef: ANSWER_QUESTION_REF_SCHEMA, world: QUESTION_WORLD_SCHEMA, worldId: hash,
  inputs: ANSWER_INPUT_SCHEMA, claims: list(claim, 145), text: { type: 'string', maxLength: 131072 },
  fragments: list(object({ kind: { enum: ['claim', 'qualification', 'open-requirement'] }, span: range,
    claimIds: list(hash, 1), sourceRefs: list(QUESTION_SOURCE_REFERENCE_SCHEMA, 3) }, { quoteSpan: range }), 212),
  unresolvedRequirements: list(object({ id: text(256), text: text(2048), state: { const: 'open' },
    reason: { const: 'caller-requirement-has-no-admitted-checker' } }), 64),
  dependencyFootprint: object({ inventoryId: hash, queryDigest: hash, domainId: text(4096), policy: { const: 'invalidate-the-whole-answer-on-any-input-world-change' },
    negativeAndDomainDependencies: { const: 'covered-conservatively-by-the-full-inventory' } }),
  qualification: object({ interpretation: { const: 'retained-query-facts-and-exact-source-quotations' },
    programSemantics: { const: 'not-established' }, questionCoverage: { enum: ['retained-question-answered', 'retained-question-partial'] },
    narrative: { const: 'none' } }),
  cost: object({ serializedBytes: uint, quotedSourceBytes: uint, claimsBuilt: uint }), digest: hash });
export const ANSWER_PATCH_SCHEMA = object({ schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, kind: { const: 'repository-answer-patch' },
  baseDigest: hash, nextDigest: hash, strategy: { const: 'full-deterministic-recomputation' },
  addedClaimIds: list(hash, 145), removedClaimIds: list(hash, 145), retainedClaimIds: list(hash, 145),
  sourceWorldChanged: { type: 'boolean' }, textChanged: { type: 'boolean' }, next: ANSWER_REVISION_SCHEMA });
