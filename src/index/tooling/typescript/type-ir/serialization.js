import { createTypeIrArena } from './arena.js';
import { createTypeIrBudget, invalidTypeIr, shareTypeIrBudget, typeIrPostorderRoots } from './budget.js';

const ID = /^tir1:[a-f0-9]{64}$/;
const assertFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || fields.some(field => !Object.hasOwn(value, field))) throw invalidTypeIr('unexpected record fields');
  let count = 0;
  for (const key in value) {
    if (Object.hasOwn(value, key) && ++count > fields.length) throw invalidTypeIr('unexpected record fields');
  }
  if (count !== fields.length) throw invalidTypeIr('unexpected record fields');
};

// Exact JSON output length, including lone-surrogate escaping. The scan is
// interruptible and charges its own work before the native encoder is admitted.
const encodedStringLength = (value, budget) => {
  let length = 2;
  for (let index = 0; index < value.length; index += 1) {
    budget.step();
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) length += 2;
    else if (code < 32) length += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { budget.step(); index += 1; length += 2; }
      else length += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) length += 6;
    else length += 1;
  }
  return length;
};
const idListLength = count => count * 71 + Math.max(0, count - 1);

export const serializeTypeIrRoots = (arena, roots, options = {}) => {
  const budget = createTypeIrBudget(options, 'type-ir.serialize');
  if (!Array.isArray(roots)) throw invalidTypeIr('roots must be an array');
  budget.allocate(roots.length * 128);
  const ids = new Set();
  for (const root of roots) { budget.step(); arena.assertNode(root); ids.add(root.id); }
  budget.step(Math.ceil(ids.size * Math.log2(Math.max(2, ids.size))));
  const rootIds = [...ids].sort();
  const nodes = typeIrPostorderRoots(rootIds.map(id => arena.getNode(id)), budget);
  let bound = 256 + arena.contextKey.length * 6 + rootIds.length * 80;
  let encodedLength = '{"schemaVersion":1,"domain":"finite-string","contextKey":"","rootIds":[],"nodes":[]}'.length
    + encodedStringLength(arena.contextKey, budget) - 2
    + idListLength(rootIds.length) + Math.max(0, nodes.length - 1);
  for (const node of nodes) {
    budget.step();
    bound += 256 + (node.kind === 'Literal' ? node.value.length * 6 : node.children.length * 80);
    encodedLength += node.kind === 'Literal'
      ? '{"id":"","kind":"Literal","value":""}'.length + 69 + encodedStringLength(node.value, budget) - 2
      : (node.kind === 'Union' ? '{"id":"","kind":"Union","children":[]}'.length
        : '{"id":"","kind":"Concat","children":[]}'.length) + 69 + idListLength(node.children.length);
  }
  budget.stringLength(bound);
  budget.allocate(bound * 2 + nodes.length * 128);
  // Allocation remains conservatively pre-admitted. Work credits count the
  // actual emitted UTF-16 units rather than the worst escaped allocation bound.
  budget.step(encodedLength + Math.ceil(nodes.length * Math.log2(Math.max(2, nodes.length))));
  nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const serialized = JSON.stringify({ schemaVersion: 1, domain: 'finite-string', contextKey: arena.contextKey,
    rootIds, nodes: nodes.map(node => node.kind === 'Literal'
      ? { id: node.id, kind: node.kind, value: node.value }
      : { id: node.id, kind: node.kind, children: node.children.map(child => child.id) }) });
  budget.check();
  if (serialized.length !== encodedLength) throw invalidTypeIr('serialization length invariant');
  return serialized;
};

export const serializeTypeIr = (arena, root, options = {}) => serializeTypeIrRoots(arena, [root], options);

/** Verify every content identity and rebuild sharing. No serialized weight,
 * semantic equivalence claim, or caller-supplied handle is trusted. Cycles and
 * unsupported operations are rejected rather than truncated or approximated.
 */
export const deserializeTypeIr = (serialized, options = {}) => {
  const budget = createTypeIrBudget(options, 'type-ir.deserialize');
  let graph = serialized;
  if (typeof serialized === 'string') {
    budget.input(serialized);
    budget.step(serialized.length);
    budget.allocate(serialized.length * 8);
    try { graph = JSON.parse(serialized); } catch { throw invalidTypeIr('malformed JSON'); }
  }
  assertFields(graph, ['schemaVersion', 'domain', 'contextKey', 'rootIds', 'nodes']);
  if (graph.schemaVersion !== 1 || graph.domain !== 'finite-string') throw invalidTypeIr('unsupported schema or domain');
  if (typeof graph.contextKey !== 'string' || !graph.contextKey.length) throw invalidTypeIr('missing context');
  budget.input(graph.contextKey);
  if (options.contextKey !== undefined && options.contextKey !== graph.contextKey) throw invalidTypeIr('context mismatch');
  if (!Array.isArray(graph.rootIds) || !Array.isArray(graph.nodes)) throw invalidTypeIr('roots or nodes');
  budget.allocate(graph.nodes.length * 256 + graph.rootIds.length * 64);
  let previousRoot = '';
  for (const id of graph.rootIds) {
    budget.step();
    if (typeof id !== 'string' || !ID.test(id) || id <= previousRoot) throw invalidTypeIr('noncanonical root identities');
    previousRoot = id;
  }
  const records = new Map();
  const parents = new Map();
  const remaining = new Map();
  let previousId = '';
  for (const record of graph.nodes) {
    budget.step();
    budget.state();
    if (typeof record?.id !== 'string' || !ID.test(record.id) || record.id <= previousId) throw invalidTypeIr('noncanonical node identities');
    previousId = record.id;
    if (record.kind === 'Literal') {
      assertFields(record, ['id', 'kind', 'value']);
      if (typeof record.value !== 'string') throw invalidTypeIr('literal value');
      budget.input(record.value);
    } else if (record.kind === 'Union' || record.kind === 'Concat') {
      assertFields(record, ['id', 'kind', 'children']);
      if (!Array.isArray(record.children)) throw invalidTypeIr('children');
      if (record.kind === 'Concat' && record.children.length !== 2) throw invalidTypeIr('noncanonical concatenation arity');
      budget.allocate(record.children.length * 96);
      for (const id of record.children) {
        budget.step();
        if (typeof id !== 'string' || !ID.test(id)) throw invalidTypeIr('child identity');
      }
    } else budget.fail('unsupported_node_kind', { kind: record.kind });
    records.set(record.id, record);
  }
  for (const id of graph.rootIds) if (!records.has(id)) throw invalidTypeIr('root is missing');
  const ready = [];
  for (const record of records.values()) {
    budget.step();
    const dependencies = new Set(record.children || []);
    remaining.set(record.id, dependencies.size);
    if (dependencies.size === 0) ready.push(record.id);
    for (const childId of dependencies) {
      budget.step();
      if (!records.has(childId)) throw invalidTypeIr('referenced child is missing');
      let users = parents.get(childId);
      if (!users) { users = []; parents.set(childId, users); }
      users.push(record.id);
    }
  }
  const arena = createTypeIrArena({ contextKey: graph.contextKey,
    ...(options.maxArenaBytes !== undefined ? { maxArenaBytes: options.maxArenaBytes } : {}),
    ...(options.maxArenaNodes !== undefined ? { maxArenaNodes: options.maxArenaNodes } : {}) });
  // Node construction shares the complete import budget rather than resetting
  // per-node limits, including sequence rebalancing and derived BigInt weights.
  const constructionOptions = shareTypeIrBudget(options, budget);
  let completed = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    budget.step();
    const record = records.get(ready[cursor]);
    const children = record.children?.map(id => arena.getNode(id));
    const node = record.kind === 'Literal' ? arena.literal(record.value, constructionOptions)
      : record.kind === 'Union' ? arena.union(children, constructionOptions) : arena.concat(children, constructionOptions);
    if (node.id !== record.id || node.kind !== record.kind
      || (node.children && (node.children.length !== record.children.length
        || node.children.some((child, index) => child.id !== record.children[index])))) {
      throw invalidTypeIr('node content identity or canonical form mismatch');
    }
    completed += 1;
    for (const parent of parents.get(record.id) || []) {
      budget.step();
      remaining.set(parent, remaining.get(parent) - 1);
      if (remaining.get(parent) === 0) ready.push(parent);
    }
  }
  if (completed !== records.size) throw invalidTypeIr('cycle in serialized graph');
  const roots = graph.rootIds.map(id => arena.getNode(id));
  if (typeIrPostorderRoots(roots, budget).length !== records.size) throw invalidTypeIr('unreachable serialized nodes');
  return { arena, roots, root: roots[0] || null };
};
