import assert from 'node:assert/strict';
import { createNativeProjectionWork, isNativeProjectionBudgetFailure } from '../../../src/lang/tree-sitter/chunking/projection-work.js';
import { createNativeProjectionNames, isNativeSemanticTypeKind } from '../../../src/lang/tree-sitter/chunking/projection-names.js';
import { extractSignature } from '../../../src/lang/tree-sitter/chunking.js';

let nextId = 0;
const counts = { children: 0, parents: 0, fields: 0, extents: 0 };
const node = ({ type = 'wrapper', start = 0, end = 1, children = [], name = null, parent = null, declared = null, id = nextId++ } = {}) => {
  let enclosing = parent;
  const result = { ...(id === null ? {} : { id }), type, startIndex: start, endIndex: end,
    get parent() { counts.parents++; return enclosing; },
    get namedChildCount() { counts.extents++; return declared ?? children.length; },
    get childCount() { counts.extents++; return declared ?? children.length; },
    namedChild(index) { counts.children++; return children[index] || null; },
    childForFieldName(field) { counts.fields++; return field === 'name' ? name : null; }
  };
  for (const child of children) child.setParent(result);
  Object.defineProperty(result, 'setParent', { value: value => { enclosing = value; } });
  return Object.freeze(result);
};
const reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
const budget = values => ({ maxAstNodes: 10000, maxAstStack: 10000, maxChunkNodes: 100, ...values });
const config = values => ({ nameFields: ['name'], typeNodes: new Set(['class']), memberNodes: new Set(['function']),
  kindMap: { class: 'ClassDeclaration', function: 'FunctionDeclaration' }, ...values });
const fails = (operation, reason) => assert.throws(operation, error => isNativeProjectionBudgetFailure(error) && error.reason === reason);

for (const maximum of [0, 1]) {
  reset(); const work = createNativeProjectionWork(budget({ maxAstNodes: maximum })), root = work.view(node());
  if (maximum) assert.equal(root.namedChildCount, 0);
  fails(() => root.namedChildCount, 'maxAstNodes');
  assert.equal(counts.extents, maximum); assert.equal(counts.children, 0);
  assert.equal(work.snapshot().operations, maximum);
}
for (const maximum of [0, 1]) {
  const work = createNativeProjectionWork(budget({ maxChunkNodes: maximum }));
  if (maximum) work.output();
  fails(() => work.output(), 'maxChunkNodes'); assert.equal(work.snapshot().outputRows, maximum);
}
reset();
{
  const work = createNativeProjectionWork(budget({ maxAstNodes: 2 ** 30 + 10, maxAstStack: 1 }));
  const root = work.view(node({ declared: 2 ** 30 }));
  fails(() => root.namedChildCount, 'maxAstStack'); assert.equal(counts.children, 0);
  assert.equal(work.snapshot().maxFrontier, 0, 'huge declared width never creates a child frontier');
}
{
  reset(); const text = 'far near', shallow = node({ type: 'identifier', start: 4, end: 8 });
  const wide = node({ declared: 999999 }), root = node({ children: [wide, shallow] });
  const work = createNativeProjectionWork(budget()), names = createNativeProjectionNames({ text, config: config(), work });
  assert.equal(names.name(root), 'near', 'BFS precedence checks all shallow names before expanding an earlier wide sibling');
  assert.equal(counts.children, 2); const after = { ...counts };
  assert.equal(names.name(root), 'near'); assert.deepEqual(counts, after, 'same-tree name memo performs no extra native reads');
}
{
  reset(); const work = createNativeProjectionWork(budget());
  const names = createNativeProjectionNames({ text: 'x', config: config(), work });
  fails(() => names.name(node({ declared: 129 })), 'nameSearchMaxNodes');
  assert.equal(counts.children, 0, 'local name admission precedes every child wrapper');
  assert.equal(work.snapshot().frontier, 0, 'failed name scope returns all frontier reservations');
}
{
  // Native APIs may return distinct JS wrappers for one semantic node. The
  // owner key includes its native ID/type/span, rather than wrapper identity.
  reset(); const text = 'alpha beta';
  const first = node({ type: 'function', start: 0, end: 5, id: 900,
    name: node({ type: 'identifier', start: 0, end: 5 }) });
  const second = node({ type: 'function', start: 0, end: 5, id: 900,
    name: node({ type: 'identifier', start: 0, end: 5 }) });
  assert.notEqual(first, second);
  const work = createNativeProjectionWork(budget()), names = createNativeProjectionNames({ text, config: config(), work });
  assert.equal(names.name(first), 'alpha'); const after = { ...counts };
  assert.equal(names.name(second), 'alpha'); assert.deepEqual(counts, after);
  assert.equal(work.snapshot().nameCacheHits, 1);
  const distinctSpan = node({ type: 'function', start: 6, end: 10, id: 900,
    name: node({ type: 'identifier', start: 6, end: 10 }) });
  assert.equal(names.name(distinctSpan), 'beta', 'native ID alone cannot alias a different semantic extent');
  assert.equal(work.snapshot().frontier, 0);
}
{
  // Missing name fields fall through to actual identifier/BFS discovery. A
  // missing native ID uses the owner's type/span key; distinct spans cannot
  // alias, while equivalent wrappers reuse precisely the same result.
  reset(); const text = 'alpha beta';
  const fallback = (start, end) => node({ type: 'function', start, end, id: null,
    children: [node({ type: 'identifier', start, end, id: null })] });
  const work = createNativeProjectionWork(budget()), names = createNativeProjectionNames({ text, config: config(), work });
  assert.equal(names.name(fallback(0, 5)), 'alpha'); const after = { ...counts };
  assert.equal(names.name(fallback(0, 5)), 'alpha'); assert.deepEqual(counts, after);
  assert.equal(names.name(fallback(6, 10)), 'beta');
  assert.equal(counts.children, 2); assert.equal(counts.fields, 2);
  assert.equal(work.snapshot().nameCacheHits, 1); assert.equal(work.snapshot().frontier, 0);
  const interrupted = createNativeProjectionWork(budget({ maxAstNodes: 1 }));
  const limited = createNativeProjectionNames({ text, config: config(), work: interrupted });
  fails(() => limited.name(fallback(0, 5)), 'maxAstNodes');
  assert.equal(interrupted.snapshot().frontier, 0, 'fallback exhaustion is a failure, never a cached empty name');
}
{
  reset(); const leaf = node({ type: 'identifier' }), middle = node({ children: [leaf] }), root = node({ children: [middle] });
  const work = createNativeProjectionWork(budget()), names = createNativeProjectionNames({ text: 'x',
    config: config({ nameSearchMaxDepth: 1 }), work });
  fails(() => names.name(root), 'nameSearchMaxDepth'); assert.equal(counts.children, 1);
  assert.equal(work.snapshot().frontier, 0);
  const absent = createNativeProjectionNames({ text: 'x', config: config(), work: createNativeProjectionWork(budget()) });
  assert.equal(absent.name(node()), '', 'an exhausted empty tree is a real no-name result, not interrupted work');
}
{
  reset(); const text = 'ABCDEFGHIJ'; let parent = node({ type: 'root' });
  for (let index = 0; index < 8; index++) parent = node({ type: 'class', start: index, end: 10,
    name: node({ type: 'identifier', start: index, end: index + 1 }), parent });
  const work = createNativeProjectionWork(budget()), names = createNativeProjectionNames({ text, config: config(), work });
  const expected = [...'ABCDEFGH'].reverse();
  for (let index = 0; index < 20; index++) {
    const child = node({ type: 'function', start: index, end: index + 1, parent });
    assert.deepEqual(names.scopes(child).map(scope => scope.name), expected);
  }
  assert.ok(counts.parents <= 30, 'native ancestors are admitted once, then shared context links replace repeated native walks');
  assert.equal(counts.fields, 8); assert.ok(work.snapshot().scopeCacheHits >= 19); assert.equal(work.snapshot().frontier, 0);
}
{
  reset(); const controller = new AbortController(); controller.abort();
  const work = createNativeProjectionWork(budget(), { signal: controller.signal });
  assert.throws(() => work.view(node()).namedChildCount, error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
  assert.equal(counts.extents, 0);
  const original = Object.freeze(new Error('original enclosing run-scope refusal'));
  const retired = createNativeProjectionWork(budget(), { assertAccepting() { throw original; } });
  assert.throws(() => retired.view(node()).namedChildCount, error => error === original); assert.equal(counts.extents, 0);
  const expired = createNativeProjectionWork(budget(), { deadlineAt: performance.now() - 1 });
  fails(() => expired.view(node()).namedChildCount, 'maxParseMs'); assert.equal(counts.extents, 0);
}
{
  const original = Object.freeze(Object.assign(new Error('original native callback resource remains held'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => false
  }));
  const work = createNativeProjectionWork(budget()), names = createNativeProjectionNames({ text: 'x',
    config: config({ resolveName() { throw original; } }), work });
  assert.throws(() => names.name(node()), error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false);
  const limited = createNativeProjectionWork(budget({ maxAstNodes: 0 }));
  fails(() => extractSignature('x', 0, 1, limited.view(node())), 'maxAstNodes');
  assert.throws(() => extractSignature('x', 0, 1, { childForFieldName() { throw original; } }),
    error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false);
}
for (const kind of ['ClassDeclaration', 'StructDeclaration', 'ImplDeclaration', 'TraitDeclaration', 'AnnotationDeclaration']) {
  assert.equal(isNativeSemanticTypeKind(kind), true);
}
for (const kind of ['PackageDeclaration', 'ModuleDeclaration', 'NamespaceDeclaration', 'SchemaDeclaration', 'ElementDeclaration', 'FunctionDeclaration']) {
  assert.equal(isNativeSemanticTypeKind(kind), false);
}
console.log('Projection zero/one/exact admission, huge widths, BFS precedence, depth, scope memo and original cancellation/refusal are bounded.');
