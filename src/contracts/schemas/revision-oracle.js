import { semanticObject as object, semanticHashSchema as hash } from './semantic-envelopes.js';
import { POSITIVE_RULE_MODEL_SCHEMAS } from './positive-rule-model.js';

const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const text = { type: 'string', minLength: 1, maxLength: 128 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const count = maximum => ({ type: 'integer', minimum: 0, maximum });
const elapsed = { type: 'number', minimum: 0 };
const producer = object({ kind: { enum: ['extensional-support', 'grounded-rule-instance'] }, originId: nullable(hash), body: list(id, 8) });
const fact = object({ id, present: { type: 'boolean' }, producers: list(producer, 96) });
const input = { ...POSITIVE_RULE_MODEL_SCHEMAS.input, properties: { ...POSITIVE_RULE_MODEL_SCHEMAS.input.properties,
  supports: list(POSITIVE_RULE_MODEL_SCHEMAS.support, 64),
  definition: { ...POSITIVE_RULE_MODEL_SCHEMAS.definition, properties: { ...POSITIVE_RULE_MODEL_SCHEMAS.definition.properties,
    facts: { ...POSITIVE_RULE_MODEL_SCHEMAS.definition.properties.facts, maxItems: 16 },
    rules: list(POSITIVE_RULE_MODEL_SCHEMAS.definition.properties.rules.items, 32) } } } };
export const REVISION_ORACLE_SCHEMAS = {
  input,
  scenario: object({ schemaVersion: { const: 1 }, profile: { const: 'finite-positive-support-revisions-v1' },
    family: id, seed: { type: 'integer', minimum: 0, maximum: 4294967295 }, input,
    revisions: list(object({ id, beforeId: hash, afterId: hash,
      removeOriginIds: { ...list(hash, 64), uniqueItems: true }, addSupports: list(POSITIVE_RULE_MODEL_SCHEMAS.support, 64) }), 16) }),
  output: object({ complete: { type: 'boolean' }, facts: list(fact, 16) })
};
const independentClaim = object({ tier: { const: 'independent-finite-reference' }, relation: { const: 'exact-membership-and-direct-producer-bag' },
  outcome: { enum: ['pass', 'fail', 'unknown'] }, reason: nullable(text), valuations: count(4096),
  differences: list(object({ id, expected: nullable(fact), actual: nullable(fact) }), 32) });
const rebuildClaim = object({ tier: { const: 'same-implementation-clean-rebuild' }, relation: { const: 'exact-output-and-root' }, outcome: { enum: ['pass', 'fail'] } });
const checkpoint = { oneOf: [object({ index: count(16), checkpointId: id, stateId: hash,
  outcome: { const: 'not-run' }, reason: { const: 'run-work-or-output-budget' } }),
object({ index: count(16), checkpointId: id, stateId: hash, outcome: { enum: ['pass', 'fail', 'unknown'] }, candidateRootId: hash, rebuildRootId: hash,
  candidateExecutionId: text, rebuildExecutionId: text, actualId: hash, rebuildId: hash,
  claims: { type: 'array', minItems: 2, maxItems: 2, items: { oneOf: [independentClaim, rebuildClaim] } },
  work: object({ candidateMs: elapsed, rebuildMs: elapsed, referenceMs: elapsed, valuations: count(4096),
    truthChanges: nullable(count(16)), producerChanges: nullable(count(16)), rounds: count(18), ruleChecks: count(576), bodyChecks: count(4608), directProducerRows: count(320) }) })] };
REVISION_ORACLE_SCHEMAS.receipt = object({ schemaVersion: { const: 1 }, kind: { const: 'finite-positive-revision-run' },
  scenarioId: hash, executionId: text, profile: { const: 'finite-positive-support-revisions-v1' }, family: id, seed: count(4294967295),
  outcome: { enum: ['pass', 'fail', 'unknown'] }, checkpoints: { ...list(checkpoint, 17), minItems: 1 },
  candidateStrategy: { const: 'existing-complete-declared-model-recomputation' }, oracle: { const: 'intersection-of-all-Horn-closed-valuations-v1' },
  semantics: { const: 'Boolean-membership-and-bag-of-direct-producers; not-all-derivations' },
  sourceAuthority: { const: 'supplied-model-only' }, programSemantics: { const: 'not-established' },
  bounds: object({ maxMs: { type: 'integer', minimum: 1, maximum: 1000 }, maxValuations: { type: 'integer', minimum: 1, maximum: 4096 },
    maxOutputBytes: { type: 'integer', minimum: 16384, maximum: 1048576 } }), elapsedMs: elapsed });
