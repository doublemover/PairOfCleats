import assert from 'node:assert/strict';
import { projectIndexFormatError } from '../../../src/shared/index-format-error.js';
import { classifySemanticDetailError } from '../../../src/integrations/tooling/semantic-errors.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/error-projection-originals/')[1];
assert.ok(['pending-originals', 'metadata-observers', 'inspection-and-falsey', 'bounded-and-reentrant'].includes(mode));
const details = () => ({ operation: 'read', component: 'fixture', expectedVersion: 1, foundVersion: 0,
  repoRoot: 'fixture-root', indexPath: 'fixture-index', rebuildCommand: 'rebuild fixture' });
const formatError = () => Object.assign(new Error('unsupported fixture format'), { code: 'ERR_INDEX_FORMAT_UNSUPPORTED', details: details() });
const thrown = run => { try { run(); } catch (error) { return error; } assert.fail('projection unexpectedly reported ordinary success'); };
const contains = (root, target) => {
  const pending = [root], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (Object.is(value, target)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); assert.ok(seen.size < 1024);
    for (const key of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) {
        if (key === 'errors' && Array.isArray(descriptor.value)) pending.push(...descriptor.value);
        else pending.push(descriptor.value);
      }
    }
  }
  return false;
};
if (mode === 'pending-originals') {
  for (const project of [projectIndexFormatError, classifySemanticDetailError]) for (const nested of [false, true]) {
    let settled = false, reads = 0;
    const original = formatError();
    Object.defineProperties(original, { cacheOwnershipPending: { value: true },
      cacheOwnershipReleased: { value() { assert.equal(this, original); return settled; } },
      code: { get() { reads++; return 'ERR_INDEX_FORMAT_UNSUPPORTED'; }, configurable: true } });
    const input = nested ? new Error('cleanup wrapper', { cause: original }) : original;
    const failure = thrown(() => project(input));
    assert.equal(reads, 0, 'pending native work is observed before even reading its code');
    assert.ok(contains(failure, input)); assert.ok(contains(failure, original));
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true, 'late actual settlement is observable without retrying an operation');
    const result = project(input);
    assert.equal(project === projectIndexFormatError ? result.nativeCode : result.semanticCode, 'ERR_INDEX_FORMAT_UNSUPPORTED');
    assert.equal(project === classifySemanticDetailError ? result.status : 409, 409);
  }
} else if (mode === 'metadata-observers') {
  let settled = true, captures = 0, reads = 0, mutate = true;
  const metadata = details(), original = formatError(); original.details = metadata;
  const actual = function () { assert.equal(this, metadata); return settled; };
  Object.defineProperty(metadata, 'cacheOwnershipReleased', { configurable: true, get() { captures++; return actual; } });
  metadata.cacheOwnershipPending = true;
  Object.defineProperty(metadata, 'operation', { configurable: true, get() {
    reads++;
    if (mutate) {
      settled = false;
      Object.defineProperty(metadata, 'cacheOwnershipReleased', { configurable: true, value: () => true });
    }
    return 'read';
  } });
  const failure = thrown(() => projectIndexFormatError(original));
  assert.equal(captures, 1, 'the actual original observer is captured once with its receiver');
  assert.equal(reads, 1, 'metadata properties are read once and settlement is rechecked immediately');
  assert.equal(failure.cacheOwnershipReleased(), false, 'replacing a public callback cannot clear the captured original');
  settled = true; mutate = false;
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(projectIndexFormatError(original).operation, 'read');
  const pendingMetadata = details(); let ready = false, fieldReads = 0;
  pendingMetadata.cacheOwnershipPending = true; pendingMetadata.cacheOwnershipReleased = () => ready;
  Object.defineProperty(pendingMetadata, 'component', { get() { fieldReads++; return 'fixture'; } });
  original.details = pendingMetadata;
  thrown(() => classifySemanticDetailError(original)); assert.equal(fieldReads, 0);
  ready = true; assert.equal(classifySemanticDetailError(original).status, 409);
} else if (mode === 'inspection-and-falsey') {
  for (const value of [null, undefined, false, 0, '']) {
    assert.equal(projectIndexFormatError(value), null);
    assert.equal(classifySemanticDetailError(value).status, 500);
    const original = new Error('diagnostic accessor failed');
    Object.defineProperty(original, 'code', { get() { throw value; } });
    const failure = thrown(() => classifySemanticDetailError(original));
    assert.ok(contains(failure, original)); assert.ok(contains(failure, value), 'falsey inspection failures retain their exact cause');
  }
  let settled = false;
  const secondary = Object.assign(new Error('original inspection work'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => settled });
  const primary = new Error('primary native operation');
  Object.defineProperty(primary, 'code', { get() { throw secondary; } });
  const retained = thrown(() => projectIndexFormatError(primary));
  assert.ok(contains(retained, primary)); assert.ok(contains(retained, secondary));
  assert.equal(retained.cacheOwnershipReleased(), false); settled = true;
  assert.equal(retained.cacheOwnershipReleased(), true);
  const diagnosticObject = { toJSON() { assert.fail('diagnostic objects cannot become code/message renderers'); } };
  const invalid = classifySemanticDetailError({ code: diagnosticObject, message: diagnosticObject });
  assert.equal(invalid.semanticCode, 'ERR_SEMANTIC_DETAIL'); assert.equal(invalid.message, 'Semantic detail failed.');
  assert.doesNotThrow(() => JSON.stringify(invalid));
} else {
  const root = new Error('root'); let last = root;
  for (let index = 0; index < 129; index++) { last.cause = new Error('cause-' + index); last = last.cause; }
  assert.ok(contains(thrown(() => projectIndexFormatError(root)), root), 'oversized diagnostics throw with the original failure instead of a partial format claim');
  const cycle = new Error('cycle'); cycle.cause = cycle;
  assert.equal(projectIndexFormatError(cycle), null);
  let reenter = true, codeReads = 0;
  const original = formatError();
  original.cacheOwnershipPending = true;
  original.cacheOwnershipReleased = () => reenter ? projectIndexFormatError(original) : true;
  Object.defineProperty(original, 'code', { get() { codeReads++; return 'ERR_INDEX_FORMAT_UNSUPPORTED'; } });
  assert.ok(contains(thrown(() => classifySemanticDetailError(original)), original));
  assert.equal(codeReads, 0, 'reentrant settlement cannot project a partially checked diagnostic');
  reenter = false;
  assert.equal(classifySemanticDetailError(original).status, 409, 'the active projection guard is retired after failure');
}
console.log('Error projections retain original resource and inspection prerequisites.');
