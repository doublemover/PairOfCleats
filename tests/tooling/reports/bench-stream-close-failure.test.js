import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'acorn';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/bench-stream-close-failure/')[1];
assert.ok(['close-failure-is-not-coverage', 'falsey-primary-and-original-close'].includes(mode));
// Explicit non-native owner controls execute the actual production function.
// They do not qualify OS descriptor retirement or fabricate native receipts.
const source = await fs.readFile(new URL('../../../tools/bench/language/report-streams.js', import.meta.url), 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const declarations = ast.body.flatMap(node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations ?? []);
const expression = name => {
  const value = declarations.find(row => row.id.type === 'Identifier' && row.id.name === name)?.init;
  assert.ok(value, 'actual production declaration required: ' + name); return '(' + source.slice(value.start, value.end) + ')';
};
const contains = (error, target, seen = new Set()) => {
  if (Object.is(error, target)) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause'), errors = Object.getOwnPropertyDescriptor(error, 'errors');
  return Boolean(cause && Object.hasOwn(cause, 'value') && contains(cause.value, target, seen))
    || Boolean(errors && Array.isArray(errors.value) && errors.value.some(value => contains(value, target, seen)));
};
const create = () => {
  const bytes = Buffer.from('line\n'), stat = { dev: 1n, ino: 2n, size: 5n, mtimeNs: 1n, ctimeNs: 1n };
  const trace = { closes: 0, closed: false, codeReads: 0 }, closeError = new Error('explicit fixture close rejection');
  Object.defineProperty(closeError, 'code', { get() { trace.codeReads++; throw new Error('unsafe diagnostic accessor'); } }); Object.freeze(closeError);
  const context = { Buffer, TextDecoder, throwIfAborted, addStorageFailureContext,
    openContainedFile: async () => ({ stat: async () => stat, close: async () => { trace.closes++; throw closeError; } }),
    verifyContainedFileHandle: () => {}, readExactAt: async (_handle, target, offset, length, position) => {
      bytes.copy(target, offset, position, position + length); return { bytesRead: length };
    } };
  for (const name of ['READ_BYTES', 'REPORT_UTF8_DECODER', 'REPORT_MAX_LINE_BYTES', 'stamp', 'sameStamp']) context[name] = vm.runInNewContext(expression(name), context);
  const read = vm.runInNewContext(expression('readReportStream'), context);
  return { read: consumer => read({ root: 'explicit-model-root' }, { path: 'explicit-model-root/log', bytes: bytes.length,
    identity: { dev: '1', ino: '2' }, stamp: context.stamp(stat) }, consumer), closeError, trace };
};
if (mode === 'close-failure-is-not-coverage') {
  const fixture = create(), rows = [];
  await assert.rejects(fixture.read(line => rows.push(line)), error => error === fixture.closeError);
  assert.deepEqual(rows, ['line']); assert.equal(fixture.trace.closes, 1); assert.equal(fixture.trace.closed, false);
  assert.equal(fixture.trace.codeReads, 0);
} else {
  for (const primary of [Object.freeze(new Error('original frozen reducer failure')), null, undefined, false, 0, '']) {
    const fixture = create();
    await assert.rejects(fixture.read(() => { throw primary; }), error => {
      assert.ok(contains(error, primary), 'exact primary value survives'); assert.ok(contains(error, fixture.closeError), 'original close survives'); return true;
    });
    assert.equal(fixture.trace.closes, 1); assert.equal(fixture.trace.closed, false);
    assert.equal(fixture.trace.codeReads, 0);
  }
}
console.log('Report streams propagate original close failure and preserve frozen/falsey reducer errors without retries.');
