import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';
import { createOccurrenceRelation } from '../../../semantic/relations/factor.js';
import { captureSourcePath } from '../../../semantic/source-order.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { POSITIVE_RULE_MODEL_VERSION, POSITIVE_RULE_MODEL_SCHEMAS } from '../../../contracts/schemas/positive-rule-model.js';
import { assertPositiveRuleModel } from '../../../contracts/validators/positive-rule-model.js';

const owned = new WeakMap(), MAX_INPUT_BYTES = 1024 * 1024;
const key = value => canonicalSemanticJson(value, { maxBytes: 8 * MAX_INPUT_BYTES });
const hash = (domain, value) => semanticHash('positive-rule.' + domain + '.v' + POSITIVE_RULE_MODEL_VERSION, value, { maxBytes: 8 * MAX_INPUT_BYTES });
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_POSITIVE_RULE_MODEL_' + suffix });
const capture = (kind, value) => {
  const captured = captureSemanticRequest(value, POSITIVE_RULE_MODEL_SCHEMAS[kind]);
  assertPositiveRuleModel(kind, captured); canonicalSemanticJson(captured, { maxBytes: MAX_INPUT_BYTES }); return captured;
};
const supportIdentity = input => hash('support', input);
export const positiveRuleSupportId = input => supportIdentity(capture('support', input));
const get = handle => {
  const value = handle !== null && typeof handle === 'object' ? owned.get(handle) : null;
  if (!value) throw fail('HANDLE', 'Original owned positive-rule view required.'); return value;
};
const validate = input => {
  const facts = new Map(), rules = new Set(), supports = new Set();
  for (const fact of input.definition.facts) {
    if (facts.has(fact.id)) throw fail('CONTRACT', 'Duplicate finite fact identity.'); facts.set(fact.id, fact.kind);
  }
  for (const rule of input.definition.rules) {
    if (rules.has(rule.id) || facts.get(rule.head) !== 'idb' || rule.body.some(id => !facts.has(id))) throw fail('CONTRACT', 'Rule identities, endogenous head or body references are invalid.');
    rules.add(rule.id);
  }
  for (const support of input.supports) {
    const id = supportIdentity(support);
    if (facts.get(support.factId) !== 'edb' || supports.has(id)) throw fail('CONTRACT', 'Only unique extensional supports may seed the declared model.');
    if (support.sourceRef && support.sourceRef.span[1] < support.sourceRef.span[0]) throw fail('CONTRACT', 'Supplied source coordinates are reversed.');
    if (support.sourceRef) captureSourcePath(support.sourceRef.path);
    supports.add(id);
  }
};

/** Exact least fixpoint over the supplied finite positive Boolean rules. This
 * computes model membership, not arbitrary source/program behavior. Recomputing
 * after changes prevents recursive self-support surviving the last EDB seed.
 */
export const bootstrapPositiveRuleView = (input, { signal = null } = {}) => {
  throwIfAborted(signal); input = capture('input', input); validate(input);
  const present = new Set(), witnesses = new Map(), productions = new Map(input.definition.facts.map(fact => [fact.id, []]));
  const supports = input.supports.map(support => ({ id: supportIdentity(support), support })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const supportById = new Map(supports.map(row => [row.id, row.support]));
  const rules = [...input.definition.rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(rule => ({ rule, id: hash('rule', rule) }));
  for (const { id, support } of supports) {
    present.add(support.factId); productions.get(support.factId).push({ id, kind: 'extensional-support', body: [], originId: support.originId });
    if (!witnesses.has(support.factId)) witnesses.set(support.factId, { producerId: id, body: [], height: 0 });
  }
  let rounds = 0, ruleChecks = 0, bodyChecks = 0, changed = true;
  while (changed) {
    throwIfAborted(signal); changed = false; rounds++;
    for (const { rule, id } of rules) {
      ruleChecks++;
      if (present.has(rule.head)) continue;
      let ready = true;
      for (const factId of rule.body) { bodyChecks++; if (!present.has(factId)) { ready = false; break; } }
      if (!ready) continue;
      present.add(rule.head); changed = true;
      witnesses.set(rule.head, { producerId: id, body: rule.body,
        height: 1 + Math.max(0, ...rule.body.map(id => witnesses.get(id).height)) });
    }
    if (rounds > input.definition.facts.length + 1) throw fail('INTEGRITY', 'Finite positive fixpoint failed to converge.');
  }
  for (const { rule, id } of rules) {
    throwIfAborted(signal);
    if (rule.body.every(id => present.has(id))) productions.get(rule.head).push({ id, kind: 'grounded-rule-instance', body: rule.body, originId: null });
  }
  const facts = input.definition.facts.map(fact => ({ ...fact, present: present.has(fact.id),
    producers: productions.get(fact.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), firstGroundedWitness: witnesses.get(fact.id) ?? null }));
  const definitionId = hash('definition', input.definition), rootId = hash('view', { version: POSITIVE_RULE_MODEL_VERSION, worldRef: input.worldRef, definitionId,
    supports: supports.map(row => ({ id: row.id, support: row.support })) });
  const rows = [];
  for (const fact of facts) for (const producer of fact.producers) {
    const sourceRef = producer.kind === 'extensional-support' ? supportById.get(producer.id).sourceRef : null;
    const dependencies = producer.body.length ? producer.body : [null];
    for (const [position, dependency] of dependencies.entries()) rows.push({ occurrenceId: hash('producer-row', { factId: fact.id, producerId: producer.id, position }),
      supportId: producer.id, tuple: [fact.id, producer.id, dependency, producer.kind], multiplicity: '1', sourceRef });
  }
  const relation = createOccurrenceRelation({ world: input.worldRef, relationId: rootId, atomRoleId: 'direct-finite-model-producer-dependency',
    schema: [{ name: 'fact', type: 'string', nullable: false }, { name: 'producer', type: 'string', nullable: false },
      { name: 'dependency', type: 'string', nullable: true }, { name: 'kind', type: 'string', nullable: false }], rows, complete: true, maxRetainedBytes: 8 * MAX_INPUT_BYTES });
  const report = { schemaVersion: POSITIVE_RULE_MODEL_VERSION, kind: 'finite-positive-rule-view', rootId, definitionId, worldRef: input.worldRef,
    facts, qualification: { inputAuthority: 'supplied-finite-model', membership: 'complete-least-fixpoint-in-declared-model',
      provenance: 'complete-direct-producers-one-grounded-witness-not-all-proofs', programSemantics: 'not-established' } };
  const immutable = JSON.parse(key(report));
  const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
  freeze(immutable);
  const handle = Object.freeze({ rootId, definitionId, relation, version: POSITIVE_RULE_MODEL_VERSION });
  owned.set(handle, { input, supports, report: immutable, work: Object.freeze({ rounds, ruleChecks, bodyChecks, directProducerRows: rows.length }) });
  throwIfAborted(signal); return handle;
};
export const describePositiveRuleView = handle => get(handle).report;
export const positiveRuleViewWork = handle => get(handle).work;
export const readPositiveRuleModelInput = handle => get(handle).input;

/** Correctness baseline: exact complete recomputation, with separate truth and
 * producer deltas. Stable Boolean membership never hides changed support. */
export const applyPositiveRuleSupportDelta = (handle, input, options = {}) => {
  throwIfAborted(options.signal);
  const state = get(handle), delta = capture('delta', input);
  if (delta.expectedRootId !== handle.rootId) throw fail('BASE_MISMATCH', 'Positive-rule support delta has a different exact base.');
  const supports = new Map(state.supports.map(row => [row.id, row.support]));
  for (const id of delta.removeSupportIds) if (!supports.delete(id)) throw fail('CONTRACT', 'Removed support is absent from the exact base.');
  for (const support of delta.addSupports) {
    const id = supportIdentity(support);
    if (supports.has(id)) throw fail('CONTRACT', 'Added support already exists.'); supports.set(id, support);
  }
  const next = bootstrapPositiveRuleView({ ...state.input, supports: [...supports.values()] }, options), before = state.report, after = get(next).report;
  const old = new Map(before.facts.map(fact => [fact.id, fact]));
  const truthChanges = after.facts.filter(fact => old.get(fact.id).present !== fact.present).map(fact => ({ factId: fact.id, before: old.get(fact.id).present, after: fact.present }));
  const producerChanges = after.facts.filter(fact => key(old.get(fact.id).producers) !== key(fact.producers))
    .map(fact => ({ factId: fact.id, before: old.get(fact.id).producers, after: fact.producers }));
  return { view: next, baseRootId: handle.rootId, nextRootId: next.rootId, strategy: 'complete-declared-model-recomputation', truthChanges, producerChanges };
};
