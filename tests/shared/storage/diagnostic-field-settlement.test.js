import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';
import { BENCH_MEASUREMENT_SNAPSHOT_VERSION } from '../../../tools/bench/language/metrics/recorded-contract.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/diagnostic-field-settlement/')[1];
assert.ok(['each-field-has-its-own-boundary', 'recorded-source-refusal-retains-work'].includes(mode));
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
  return contains(Object.getOwnPropertyDescriptor(error, 'cause')?.value, target, seen)
    || (Object.getOwnPropertyDescriptor(error, 'errors')?.value ?? []).some(row => contains(row, target, seen));
};
const create = () => {
  const state = { ready: true, codes: 0, messages: 0, originalObservations: 0 };
  const primary = new Error('replace before freeze'); delete primary.stack;
  Object.defineProperties(primary, {
    code: { get() { state.codes++; state.ready = false; return 'EIO'; } },
    // Retention may inspect this presentation field; it cannot undo the refusal
    // already required at the code boundary or mint an ordinary diagnostic.
    message: { get() { state.messages++; state.ready = true; return 'later presentation cannot erase a pending interval'; } },
    cacheOwnershipReleased: { value() { assert.equal(this, primary); state.originalObservations++; return state.ready; } }
  }); Object.freeze(primary);
  return { primary, state };
};
if (mode === 'each-field-has-its-own-boundary') {
  const { primary, state } = create(); let failure;
  assert.throws(() => describeStorageFailure(primary), error => { failure = error; return contains(error, primary); });
  assert.equal(state.codes, 1, 'the original code field is read exactly once');
  assert.ok(state.originalObservations > 1); assert.equal(failure.cacheOwnershipPending, true);
  assert.equal(typeof failure.cacheOwnershipReleased, 'function');
  assert.deepEqual(describeStorageFailure(new Error('ordinary settled diagnostic')), { code: 'ERR_STORAGE', message: 'ordinary settled diagnostic' });
  const zero = Object.assign(new Error('measured code'), { code: '' });
  assert.equal(describeStorageFailure(zero, { defaultCode: 'EXPECTED_DEFAULT' }).code, 'EXPECTED_DEFAULT');
} else {
  // Actual historical-source boundary with an explicit read-owner rejection.
  // This proves propagation, not native descriptor settlement or file authority.
  const source = await fs.readFile(new URL('../../../tools/bench/language/metrics/recorded-evidence.js', import.meta.url), 'utf8');
  const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .flatMap(node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations ?? []);
  const declaration = declarations.find(row => row.id.name === 'readSnapshot')?.init; assert.ok(declaration);
  const { primary, state } = create(); let reads = 0;
  const bindings = { path, BENCH_MEASUREMENT_SNAPSHOT_VERSION, describeStorageFailure,
    referenceFailure: message => new Error(message), readVerifiedContainedFileSync: () => { reads++; throw primary; } };
  const createRead = vm.runInThisContext('"use strict";\n(({' + Object.keys(bindings).join(',') + '}) => '
    + source.slice(declaration.start, declaration.end) + ')');
  const read = createRead(bindings), attemptId = 'attempt-fixture';
  const reference = { schemaVersion: BENCH_MEASUREMENT_SNAPSHOT_VERSION, attemptId, path: 'measurements.json', bytes: 1, sha256: 'a'.repeat(64) };
  assert.throws(() => read(reference, path.resolve('explicit-read-owner-model'), attemptId), error => contains(error, primary));
  assert.equal(reads, 1); assert.equal(state.codes, 1, 'no repeated field lookup can turn the original refusal into a cache miss');
}
console.log('Each diagnostic field retains its original settlement boundary before ordinary report classification.');
