import { throwIfAborted } from '../../../shared/abort.js';

const budgetFailures = new WeakSet();
export const isNativeProjectionBudgetFailure = value => value !== null && typeof value === 'object' && budgetFailures.has(value);
const nodeProperties = new Set(['parent', 'previousNamedSibling', 'nextNamedSibling', 'firstNamedChild', 'lastNamedChild',
  'previousSibling', 'nextSibling', 'firstChild', 'lastChild']);
const nodeMethods = new Set(['namedChild', 'child', 'childForFieldName', 'childForFieldId', 'namedDescendantForIndex',
  'descendantForIndex', 'namedDescendantForPosition', 'descendantForPosition', 'childWithDescendant']);
const unsupportedWalks = new Set(['descendantsOfType', 'closest', 'walk', 'toString']);

/** One synchronous parser-owned admission ledger. Native parsing is separate.
 * maxAstNodes now charges outer visits and native child/field/parent projection
 * work. maxAstStack bounds live traversal entries plus conservatively retained
 * child containers within a projection callback. No native node escapes it.
 */
export const createNativeProjectionWork = (budget, { signal = null, assertAccepting = null, deadlineAt = null } = {}) => {
  const limits = { maxAstNodes: budget.maxAstNodes, maxAstStack: budget.maxAstStack, maxChunkNodes: budget.maxChunkNodes };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid native projection budget.');
  const counters = { operations: 0, visits: 0, childAccesses: 0, fieldAccesses: 0, parentAccesses: 0,
    childCounts: 0, queryExecutions: 0, outputRows: 0, nameCacheHits: 0, scopeCacheHits: 0, scopeLinks: 0 };
  const originals = new WeakMap(), views = new WeakMap(), frames = [];
  let frontier = 0, maxFrontier = 0, reason = null;
  const snapshot = () => Object.freeze({ ...counters, frontier, maxFrontier, reason, limits: Object.freeze({ ...limits }),
    units: 'native wrapper/field/parent operations; frontier entries; emitted rows; native parse excluded',
    outputByteMeasurement: 'existing serialization owner; no extra production stringify/copy for telemetry' });
  const fail = value => {
    reason ||= value;
    const error = Object.assign(new Error('Native declaration projection exhausted ' + reason + '.'), {
      code: 'ERR_TREE_SITTER_PROJECTION_BUDGET', reason, projectionWork: snapshot()
    }); budgetFailures.add(error); throw error;
  };
  const check = () => {
    throwIfAborted(signal); assertAccepting?.();
    if (deadlineAt !== null && performance.now() >= deadlineAt) fail('maxParseMs');
  };
  const spend = (kind, count = 1) => {
    check();
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Invalid native projection operation count.');
    if (count > limits.maxAstNodes - counters.operations) fail('maxAstNodes');
    counters.operations += count;
    if (Object.hasOwn(counters, kind)) counters[kind] += count;
  };
  const reserve = count => {
    check();
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Invalid native projection frontier count.');
    if (count > limits.maxAstStack - frontier) fail('maxAstStack');
    frontier += count; maxFrontier = Math.max(maxFrontier, frontier);
  };
  const release = count => { if (!Number.isSafeInteger(count) || count < 0 || count > frontier) throw new Error('Native projection frontier ownership mismatch.'); frontier -= count; };
  const countOf = (node, named) => {
    spend('childCounts');
    const count = Reflect.get(node, named ? 'namedChildCount' : 'childCount', node);
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Native projection requires a finite child count.');
    if (count > limits.maxAstNodes - counters.operations) fail('maxAstNodes');
    const frame = frames.at(-1);
    if (frame) {
      const key = node.id ?? node;
      const previous = frame.containers.get(key) || 0;
      if (count > previous) { reserve(count - previous); frame.reserved += count - previous; frame.containers.set(key, count); }
    } else if (count > limits.maxAstStack - frontier) fail('maxAstStack');
    return count;
  };
  const view = node => {
    if (!node || typeof node !== 'object') return node;
    if (originals.has(node)) return node;
    const prior = views.get(node);
    if (prior) return prior;
    const methods = new Map();
    const wrapped = new Proxy(Object.create(Object.getPrototypeOf(node)), { get(_target, key) {
      const target = node;
      if (key === 'namedChildCount' || key === 'childCount') return countOf(target, key === 'namedChildCount');
      if (key === 'namedChildren' || key === 'children') {
        const count = countOf(target, key === 'namedChildren'); spend('childAccesses', count);
        const values = Reflect.get(target, key, target);
        if (!Array.isArray(values) || values.length > count) throw new TypeError('Native child container exceeds its admitted extent.');
        return values.map(view);
      }
      if (nodeProperties.has(key)) { spend(key === 'parent' ? 'parentAccesses' : 'childAccesses'); return view(Reflect.get(target, key, target)); }
      const value = Reflect.get(target, key, target);
      if (key === 'constructor') return value;
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) methods.set(key, (...args) => {
        if (unsupportedWalks.has(key)) fail('unsupportedBulkProjection');
        const rawArgs = args.map(arg => originals.get(arg) || arg);
        if (key === 'childrenForFieldName' || key === 'childrenForFieldId') {
          const count = countOf(target, true); spend('childAccesses', count);
          const values = Reflect.apply(value, target, rawArgs);
          if (!Array.isArray(values) || values.length > count) throw new TypeError('Native field container exceeds its admitted extent.');
          return values.map(view);
        }
        spend(String(key).includes('Field') ? 'fieldAccesses' : 'childAccesses');
        const result = Reflect.apply(value, target, rawArgs);
        return nodeMethods.has(key) ? view(result) : result;
      });
      return methods.get(key);
    } });
    originals.set(wrapped, node); views.set(node, wrapped);
    return wrapped;
  };
  const project = operation => {
    const frame = { containers: new Map(), reserved: 0 }; frames.push(frame);
    try { check(); return operation(); }
    finally { frames.pop(); release(frame.reserved); }
  };
  const output = () => {
    check(); if (counters.outputRows === limits.maxChunkNodes) fail('maxChunkNodes');
    counters.outputRows++;
  };
  return Object.freeze({ check, spend, reserve, release, view, raw: node => originals.get(node) || node,
    project, output, fail, snapshot, hit: kind => { if (Object.hasOwn(counters, kind)) counters[kind]++; } });
};
