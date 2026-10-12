import { createHash } from 'node:crypto';
import { createTypeIrBudget, invalidTypeIr } from './budget.js';
import { createTypeIrSequence } from './sequence.js';

const DOMAIN = 'pairofcleats.finite-string-type-ir.v1';
const ID_PREFIX = 'tir1:';
const DEFAULT_ARENA_BYTES = 64 * 1024 * 1024;
const DEFAULT_ARENA_NODES = 100000;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Context-scoped immutable finite-string DAG. Accounting is a conservative
 * logical storage charge, not a measurement or hard cap of V8 process memory.
 */
export const createTypeIrArena = ({ contextKey, maxArenaBytes = DEFAULT_ARENA_BYTES,
  maxArenaNodes = DEFAULT_ARENA_NODES, digest = sha256 } = {}) => {
  if (typeof contextKey !== 'string' || !contextKey.length) throw invalidTypeIr('contextKey is required');
  for (const [key, value] of Object.entries({ maxArenaBytes, maxArenaNodes })) {
    if (!Number.isSafeInteger(value) || value < 0) throw invalidTypeIr(key);
  }
  if (typeof digest !== 'function') throw invalidTypeIr('digest');
  const nodes = new Map();
  const weights = new WeakMap();
  let chargedBytes = contextKey.length * 2 + 128;
  if (chargedBytes > maxArenaBytes) {
    createTypeIrBudget({}, 'type-ir.arena').fail('maxArenaBytes_exceeded', { requested: chargedBytes });
  }
  const assertNode = (node) => {
    if (!node || nodes.get(node.id)?.node !== node) throw invalidTypeIr('node is not owned by this context arena');
    return node;
  };
  const intern = (kind, value, children, budget) => {
    budget.step();
    // JSON may escape every UTF-16 code unit as six ASCII characters. Charge
    // before creating payload strings, identity keys, or child-reference arrays.
    const payloadBound = 256 + contextKey.length * 6
      + (kind === 'Literal' ? value.length * 6 : children.length * 80);
    const weightBits = kind === 'Concat'
      ? Math.max(...children.map(child => weights.get(child).bits)) + 1
      : 1;
    const storageCharge = payloadBound * 2 + 512 + (children?.length || 0) * 24 + Math.ceil(weightBits / 8)
      + (kind === 'Literal' ? value.length * 2 : 0);
    if (storageCharge > maxArenaBytes) budget.fail('maxArenaBytes_exceeded');
    budget.stringLength(payloadBound);
    budget.allocate(payloadBound * 2 + (children?.length || 0) * 16);
    const payload = JSON.stringify([DOMAIN, contextKey, kind,
      kind === 'Literal' ? value : children.map(child => child.id)]);
    budget.step(payload.length);
    const hash = digest(payload);
    budget.check();
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw invalidTypeIr('invalid digest');
    const id = ID_PREFIX + hash;
    const existing = nodes.get(id);
    if (existing) {
      if (existing.payload !== payload) throw invalidTypeIr('identity hash collision');
      return existing.node;
    }
    if (nodes.size >= maxArenaNodes) budget.fail('maxArenaNodes_exceeded');
    if (storageCharge > maxArenaBytes - chargedBytes) budget.fail('maxArenaBytes_exceeded');
    const node = Object.freeze(kind === 'Literal'
      ? { id, contextKey, kind, value }
      : { id, contextKey, kind, children: Object.freeze(children.slice()) });
    chargedBytes += storageCharge;
    nodes.set(id, { payload, node });
    weights.set(node, { value: kind === 'Concat'
      ? weights.get(children[0]).value + weights.get(children[1]).value
      : 1n, bits: weightBits });
    return node;
  };
  const literal = (value, options = {}) => {
    const budget = createTypeIrBudget(options, 'type-ir.literal');
    if (typeof value !== 'string') throw invalidTypeIr('literal is not a string');
    budget.input(value);
    return intern('Literal', value, null, budget);
  };
  const combine = (kind, input, options) => {
    const budget = createTypeIrBudget(options, `type-ir.${kind.toLowerCase()}`);
    if (!Array.isArray(input)) throw invalidTypeIr('operands must be an array');
    let count = 0;
    let empty = false;
    for (const child of input) {
      budget.step();
      assertNode(child);
      if (kind === 'Concat' && child.kind === 'Union' && child.children.length === 0) empty = true;
      count += kind === 'Union' && child.kind === kind ? child.children.length : 1;
      if (!Number.isSafeInteger(count)) budget.fail('operand_count_exceeded');
    }
    if (empty) return intern('Union', null, [], budget);
    budget.allocate(count * 24);
    const flattened = [];
    for (const child of input) {
      budget.step();
      const additions = kind === 'Union' && child.kind === kind ? child.children : [child];
      for (const addition of additions) {
        budget.step();
        if (kind === 'Concat' && addition.kind === 'Literal' && addition.value === '') continue;
        flattened.push(addition);
      }
    }
    let children = flattened;
    if (kind === 'Union') {
      budget.step(Math.ceil(flattened.length * Math.log2(Math.max(2, flattened.length))));
      flattened.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      children = [];
      for (const child of flattened) {
        budget.step();
        if (children.at(-1) !== child) children.push(child);
      }
    }
    if (children.length === 1) return children[0];
    if (kind === 'Concat' && children.length === 0) return intern('Literal', '', null, budget);
    if (kind === 'Concat') {
      const sequence = createTypeIrSequence({
        weight: (node) => weights.get(node).value,
        bits: (node) => weights.get(node).bits,
        intern: (left, right) => intern('Concat', null, [left, right], budget),
        budget
      });
      while (children.length > 1) {
        budget.allocate(Math.ceil(children.length / 2) * 8);
        const next = [];
        for (let index = 0; index < children.length; index += 2) {
          budget.step();
          next.push(index + 1 < children.length ? sequence.join(children[index], children[index + 1]) : children[index]);
        }
        children = next;
      }
      return children[0];
    }
    return intern(kind, null, children, budget);
  };
  return Object.freeze({
    contextKey,
    literal,
    union: (children, options = {}) => combine('Union', children, options),
    concat: (children, options = {}) => combine('Concat', children, options),
    assertNode,
    getNode: (id) => nodes.get(id)?.node || null,
    stats: () => ({ nodes: nodes.size, chargedBytes, maxArenaBytes, maxArenaNodes })
  });
};
