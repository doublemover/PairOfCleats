import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { validateSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';

const handles = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Finite shape profile: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** A deliberately finite value universe. No source printer parsing or mutable/native-type lowering. */
export const createFiniteShapeArena = ({ world, values, maxBytes = 1024 * 1024 }) => {
  if (!fields(world, ['generation', 'repositoryNamespace', 'contextKey', 'providerId', 'language'])
    || !validateSemanticEnvelope('generation', world.generation).ok
    || ['repositoryNamespace', 'contextKey', 'providerId', 'language'].some(name => !text(world[name]))
    || !Array.isArray(values) || values.length > 512 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('bounded qualified universe required');
  let nodes = 0, bytes = 0;
  const active = new Set();
  const validate = (value, depth = 0) => {
    if (++nodes > 16384 || depth > 16 || !value || active.has(value)) fail('finite acyclic shape allowance exceeded');
    active.add(value);
    if (fields(value, ['kind', 'type', 'value']) && value.kind === 'atom') {
      if (!(value.type === 'string' && typeof value.value === 'string' && Buffer.byteLength(value.value) <= 4096
        || value.type === 'integer' && Number.isSafeInteger(value.value) && !Object.is(value.value, -0)
        || value.type === 'boolean' && typeof value.value === 'boolean'
        || ['null', 'undefined'].includes(value.type) && value.value === null)) fail('unsupported finite atom');
    } else if (fields(value, ['kind', 'fields']) && value.kind === 'record') {
      if (!Array.isArray(value.fields) || value.fields.length > 64) fail('closed record fields required');
      const labels = new Set();
      for (const pair of value.fields) {
        if (!Array.isArray(pair) || pair.length !== 2 || !text(pair[0]) || labels.has(pair[0])) fail('unique record labels required');
        labels.add(pair[0]); validate(pair[1], depth + 1);
      }
    } else if (fields(value, ['kind', 'items']) && value.kind === 'tuple') {
      if (!Array.isArray(value.items) || value.items.length > 64) fail('bounded tuple required');
      for (const child of value.items) validate(child, depth + 1);
    } else fail('unsupported shape; opaque/native/effect values require another profile');
    active.delete(value);
  };
  const normalized = values.map(value => {
    validate(value);
    const normalize = item => item.kind === 'record' ? { kind: 'record', fields: item.fields
      .map(([label, child]) => [label, normalize(child)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) }
      : item.kind === 'tuple' ? { kind: 'tuple', items: item.items.map(normalize) } : item;
    const encoded = key(normalize(value)); bytes += Buffer.byteLength(encoded);
    if (bytes > maxBytes) throw new RangeError('Finite shape universe byte allowance exceeded.');
    return JSON.parse(encoded);
  });
  if (new Set(normalized.map(key)).size !== normalized.length) fail('duplicate universe value');
  const immutableWorld = freeze(JSON.parse(key(world))), universe = freeze(normalized);
  const universeId = semanticHash('pairofcleats.finite-closed-shape-universe.v1', { world, values: universe });
  const owner = { world: immutableWorld, universe, universeId };
  const fullMask = (1n << BigInt(universe.length)) - 1n, interned = new Map();
  let handleBytes = bytes + Buffer.byteLength(key(world));
  const make = (mask, unsupported = []) => {
    if (unsupported.length > 64) throw new RangeError('Finite shape unsupported-reason allowance exceeded.');
    const identity = key({ mask: mask === null ? null : mask.toString(), unsupported });
    if (interned.has(identity)) return interned.get(identity);
    if (interned.size >= 4096) throw new RangeError('Finite shape handle allowance exceeded.');
    const charge = Buffer.byteLength(identity) + 256;
    if (handleBytes + charge > maxBytes) throw new RangeError('Finite shape retained handle allowance exceeded.');
    const handle = Object.freeze({ profile: 'finite-closed-shape/v1', universeId, world: immutableWorld,
      rootId: semanticHash('pairofcleats.finite-closed-shape-type.v1', { universeId, identity }) });
    handleBytes += charge;
    handles.set(handle, { owner, mask, unsupported: [...unsupported] }); interned.set(identity, handle); return handle;
  };
  const state = handle => { const result = handles.get(handle); if (!result || result.owner !== owner) fail('incompatible arena/world'); return result; };
  const combine = (operation, left, right) => {
    const a = state(left), b = state(right);
    if (a.mask === null || b.mask === null) return make(null, [...new Set([...a.unsupported, ...b.unsupported])].sort());
    return make(operation === 'union' ? a.mask | b.mask : a.mask & b.mask);
  };
  return Object.freeze({ profile: 'finite-closed-shape/v1', universeId, world: immutableWorld, valueCount: universe.length,
    select(indices) {
      if (!Array.isArray(indices) || indices.length > universe.length || indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= universe.length)) fail('exact finite value indices required');
      return make(indices.reduce((mask, index) => mask | 1n << BigInt(index), 0n));
    },
    unknown(reason) { if (!text(reason)) fail('unsupported reason required'); return make(null, [reason]); },
    union: (a, b) => combine('union', a, b), intersection: (a, b) => combine('intersection', a, b),
    complement(handle) { const value = state(handle); return value.mask === null ? make(null, value.unsupported) : make(fullMask ^ value.mask); },
    value(index) { if (!Number.isSafeInteger(index) || index < 0 || index >= universe.length) fail('unknown value'); return universe[index]; }
  });
};

const pair = (left, right) => {
  const a = handles.get(left), b = handles.get(right);
  if (!a || !b || a.owner !== b.owner) fail('same owned profile/universe/world required');
  return [a, b];
};
const has = (state, index) => (state.mask & 1n << BigInt(index)) !== 0n;

export const compareFiniteShapes = ({ left, right, operation, maxWork = 512, signal = null }) => {
  const [a, b] = pair(left, right);
  if (!['inclusion', 'equivalence', 'disjointness'].includes(operation) || !Number.isSafeInteger(maxWork) || maxWork < 0) fail('unsupported bounded query');
  const base = { profile: left.profile, universeId: left.universeId, world: left.world, operation,
    leftRoot: left.rootId, rightRoot: right.rootId, scope: 'declared-finite-immutable-values', nativeAssignability: 'not-implied' };
  if (a.mask === null || b.mask === null) return { ...base, status: 'unknown', reason: 'unsupported-alternative', witness: null };
  let work = 0;
  for (let index = 0; index < a.owner.universe.length; index++) {
    if (signal?.aborted || work >= maxWork) return { ...base, status: 'unknown', reason: signal?.aborted ? 'cancelled' : 'work-budget', work, witness: null };
    work++;
    const inLeft = has(a, index), inRight = has(b, index);
    if (operation === 'inclusion' ? inLeft && !inRight : operation === 'equivalence' ? inLeft !== inRight : inLeft && inRight) {
      return { ...base, status: 'refuted', work, witness: { valueIndex: index, value: a.owner.universe[index], inLeft, inRight },
        certificate: 'checked-membership-counterexample' };
    }
  }
  return { ...base, status: 'proved', work, witness: null, certificate: 'complete-finite-enumeration' };
};

/** Preserve whole-record alternatives and distinguish missing fields from present undefined. */
export const projectFiniteShapeFields = ({ type, labels, maxWork = 512, signal = null }) => {
  const state = handles.get(type);
  if (!state || !Array.isArray(labels) || labels.length > 64 || labels.some(label => !text(label))
    || new Set(labels).size !== labels.length || !Number.isSafeInteger(maxWork) || maxWork < 0) fail('bounded projection required');
  if (state.mask === null) return { status: 'unknown', reason: 'unsupported-alternative', alternatives: [] };
  const alternatives = [];
  let work = 0;
  for (let index = 0; index < state.owner.universe.length; index++) {
    if (signal?.aborted || work >= maxWork) return { status: 'unknown', reason: signal?.aborted ? 'cancelled' : 'work-budget', alternatives, work };
    work++;
    if (!has(state, index)) continue;
    const value = state.owner.universe[index];
    if (value.kind !== 'record') return { status: 'unknown', reason: 'non-record-alternative', alternatives, work };
    const fields = new Map(value.fields);
    alternatives.push({ valueIndex: index, fields: labels.map(label => fields.has(label)
      ? { label, presence: 'present', value: fields.get(label) } : { label, presence: 'absent', value: null }) });
  }
  return { status: 'complete-in-model', universeId: type.universeId, world: type.world, alternatives, work };
};

/** Positive and negative existential preimages overlap for nondeterministic finite relations. */
export const finiteShapePreimages = ({ input, outputPredicate, relation, complete, maxWork = 65536, signal = null }) => {
  const [a, b] = pair(input, outputPredicate);
  if (!Array.isArray(relation) || relation.length > 65536 || typeof complete !== 'boolean'
    || !Number.isSafeInteger(maxWork) || maxWork < 0) fail('bounded finite relation required');
  const positive = new Set(), negative = new Set();
  let work = 0;
  if (a.mask === null || b.mask === null) return { status: 'unknown', reason: 'unsupported-alternative', positive: [], negative: [] };
  for (const edge of relation) {
    if (!Array.isArray(edge) || edge.length !== 2 || edge.some(index => !Number.isSafeInteger(index) || index < 0 || index >= a.owner.universe.length)) fail('relation endpoint outside universe');
    if (signal?.aborted || work >= maxWork) return { status: 'unknown', reason: signal?.aborted ? 'cancelled' : 'work-budget', positive: [...positive], negative: [...negative], work };
    work++;
    if (has(a, edge[0])) (has(b, edge[1]) ? positive : negative).add(edge[0]);
  }
  return { status: complete ? 'complete-in-model' : 'unknown', reason: complete ? null : 'incomplete-relation',
    positive: [...positive].sort((x, y) => x - y), negative: [...negative].sort((x, y) => x - y), work,
    semantics: 'independent-existential-preimages', divergence: 'not-modeled' };
};
