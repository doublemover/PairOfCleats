import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { describeOccurrenceRelation, sumOccurrenceRelations } from '../../../semantic/relations/factor.js';

const requests = new WeakMap(), receipts = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Occurrence sum legality: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const OCCURRENCE_SUM_OBSERVATION = 'tuple-and-original-occurrence-bag/v1';
const rule = 'positive-natural-bag-union-associativity-commutativity/v1';

/** Ground sum-only island. No order, scores, physical choice paths, effects or set-idempotence law. */
export const createOccurrenceSumRequest = ({ inputs, left, right, world, observation }) => {
  if (!(inputs instanceof Map) || !inputs.size || inputs.size > 128 || observation !== OCCURRENCE_SUM_OBSERVATION) fail('unsupported observation/input domain');
  const bindings = new Map(), descriptors = [];
  for (const [id, relation] of inputs) {
    if (!text(id)) fail('input ID required');
    const descriptor = describeOccurrenceRelation(relation);
    if (key(descriptor.world) !== key(world) || descriptors.length && (key(descriptor.schema) !== key(descriptors[0].schema)
      || key(descriptor.atomRoles) !== key(descriptors[0].atomRoles))) fail('incompatible input world/schema/original roles');
    bindings.set(id, relation); descriptors.push({ id, ...descriptor });
  }
  let nodes = 0, leaves = 0;
  const active = new Set();
  const admit = (term, depth = 0) => {
    if (++nodes > 2048 || depth > 16 || active.has(term)) fail('bounded acyclic terms required');
    if (fields(term, ['op', 'input']) && term.op === 'input' && bindings.has(term.input)) {
      if (++leaves > 128) fail('sum operand allowance exceeded');
      return { op: 'input', input: term.input };
    }
    if (!fields(term, ['op', 'children']) || term.op !== 'sum' || !Array.isArray(term.children)
      || !term.children.length || term.children.length > 128) fail('unsupported term operator');
    active.add(term);
    const result = { op: 'sum', children: term.children.map(child => admit(child, depth + 1)) };
    active.delete(term); return result;
  };
  const admittedLeft = admit(left); nodes = 0; leaves = 0;
  const admittedRight = admit(right);
  const identity = freeze(JSON.parse(key({ world, observation, rule, descriptors,
    left: admittedLeft, right: admittedRight })));
  const request = Object.freeze({ requestId: semanticHash('pairofcleats.occurrence-sum-request.v1', identity),
    world: identity.world, observation, leftHash: semanticHash('pairofcleats.occurrence-sum-term.v1', identity.left),
    rightHash: semanticHash('pairofcleats.occurrence-sum-term.v1', identity.right) });
  requests.set(request, { ...identity, bindings });
  return request;
};

/** Candidate generator is deliberately separate from the proof checker. */
export const proposeOccurrenceSumNormalization = ({ inputs, term, world, observation }) => {
  const pending = [term], leaves = [];
  let work = 0;
  while (pending.length) {
    if (++work > 2048) fail('candidate term work allowance exceeded');
    const next = pending.pop();
    if (fields(next, ['op', 'input']) && next.op === 'input') leaves.push({ op: 'input', input: next.input });
    else if (fields(next, ['op', 'children']) && next.op === 'sum' && Array.isArray(next.children)
      && next.children.length <= 128) pending.push(...next.children);
    else fail('unsupported normalization candidate');
  }
  leaves.sort((a, b) => a.input < b.input ? -1 : a.input > b.input ? 1 : 0);
  const right = { op: 'sum', children: leaves };
  const request = createOccurrenceSumRequest({ inputs, left: term, right, world, observation });
  return { request, alternative: freeze(right), proof: Object.freeze({ rule, requestId: request.requestId,
    leftHash: request.leftHash, rightHash: request.rightHash, observation }) };
};

/** Check trusted bag AC premises by counted leaf roles, independent of candidate sorting/flattening. */
export const checkOccurrenceSumProof = ({ request, proof, maxWork = 4096, signal = null }) => {
  const state = requests.get(request);
  if (!state || !Number.isSafeInteger(maxWork) || maxWork < 0) fail('owned bounded request required');
  if (!fields(proof, ['rule', 'requestId', 'leftHash', 'rightHash', 'observation']) || proof.rule !== rule
    || proof.requestId !== request.requestId || proof.leftHash !== request.leftHash
    || proof.rightHash !== request.rightHash || proof.observation !== state.observation) return { status: 'rejected', reason: 'proof-context-or-rule-mismatch' };
  let work = 0;
  const counts = new Map();
  const visit = (term, sign) => {
    if (signal?.aborted || work >= maxWork) return false;
    work++;
    if (term.op === 'input') counts.set(term.input, (counts.get(term.input) || 0) + sign);
    else for (const child of term.children) if (!visit(child, sign)) return false;
    return true;
  };
  if (!visit(state.left, 1) || !visit(state.right, -1)) return { status: 'unknown', reason: signal?.aborted ? 'cancelled' : 'work-budget', work };
  if ([...counts.values()].some(count => count !== 0)) return { status: 'rejected', reason: 'operand-multiplicity-mismatch', work };
  const receipt = Object.freeze({ receiptId: semanticHash('pairofcleats.occurrence-sum-check.v1', { requestId: request.requestId, rule }),
    requestId: request.requestId, relation: 'equality', observation: state.observation, checker: 'counted-ground-bag-ac/v1',
    rule, work, world: request.world, sourceClosure: 'not-implied', rankedOrder: 'not-observed' });
  receipts.set(receipt, request);
  return { status: 'checked-in-model', receipt };
};

export const admitOccurrenceSumAlternative = ({ receipt, request }) => ({
  admitted: requests.has(request) && receipts.get(receipt) === request,
  reason: requests.has(request) && receipts.get(receipt) === request ? null : 'missing-owned-exact-request-receipt'
});

/** Real #1513 consumer: without a matching checked receipt, only the original plan is executable. */
export const executeOccurrenceSumRequest = ({ request, receipt = null }) => {
  const state = requests.get(request);
  if (!state) fail('owned request required');
  if (receipt !== null && !admitOccurrenceSumAlternative({ receipt, request }).admitted) fail('unadmitted alternative');
  const evaluate = term => term.op === 'input' ? state.bindings.get(term.input) : sumOccurrenceRelations(term.children.map(evaluate));
  return { relation: evaluate(receipt === null ? state.left : state.right),
    plan: receipt === null ? 'original' : 'checked-alternative', receiptId: receipt?.receiptId || null,
    observation: state.observation, physicalChoicePaths: 'not-equated', rankedOrder: 'not-equated' };
};
