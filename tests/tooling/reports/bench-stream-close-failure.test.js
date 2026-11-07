import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'acorn';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { createContainedFileResource, getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { readExactAt } from '../../../src/shared/io/read-exact.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/bench-stream-close-failure/')[1];
assert.ok(['close-failure-is-not-coverage', 'falsey-primary-and-original-close', 'pending-read-blocks-close', 'late-diagnostic-observation'].includes(mode));
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
const create = ({ pendingRead = false, unsafeDiagnostic = false } = {}) => {
  const bytes = Buffer.from('line\n'), stat = { dev: 1n, ino: 2n, size: 5n, mtimeNs: 1n, ctimeNs: 1n };
  const trace = { closes: 0, closed: false, codeReads: 0, nameReads: 0, reads: 0,
      allowClose: pendingRead || unsafeDiagnostic, readReleased: !pendingRead }, closeError = new Error('explicit fixture close rejection');
  Object.defineProperty(closeError, 'code', { get() { trace.codeReads++; throw new Error('unsafe diagnostic accessor'); } }); Object.freeze(closeError);
  const readError = new Error('explicit fixture original read rejection');
  Object.defineProperties(readError, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => trace.readReleased },
    name: { get() { trace.nameReads++; if (unsafeDiagnostic) trace.readReleased = false; throw 0; } },
    code: { get() { trace.codeReads++; throw new Error('unsafe read code'); } } }); Object.freeze(readError);
  const handle = { fd: 37, stat: async () => stat,
    read: async (target, offset, length, position) => {
      trace.reads++; if (pendingRead || unsafeDiagnostic) throw readError;
      bytes.copy(target, offset, position, position + length); return { bytesRead: length, buffer: target };
    }, close: async () => { trace.closes++; if (!trace.allowClose) throw closeError; trace.closed = true; } };
  const context = { Buffer, TextDecoder, throwIfAborted, addStorageFailureContext, observeStorageResource, readExactAt,
    withContainedFile: async (_root, _path, action) => {
      const owner = createContainedFileResource({ handle, sync: false });
      return owner.run(operations => action({ ...operations, verify: () => {} }));
    } };
  for (const name of ['READ_BYTES', 'REPORT_UTF8_DECODER', 'REPORT_MAX_LINE_BYTES', 'stamp', 'sameStamp']) context[name] = vm.runInNewContext(expression(name), context);
  const read = vm.runInNewContext(expression('readReportStream'), context);
  return { read: consumer => read({ root: 'explicit-model-root' }, { path: 'explicit-model-root/log', bytes: bytes.length,
    identity: { dev: '1', ino: '2' }, stamp: context.stamp(stat) }, consumer), closeError, readError, trace };
};
if (mode === 'close-failure-is-not-coverage') {
  const fixture = create(), rows = [];
  let session;
  await assert.rejects(fixture.read(line => rows.push(line)), error => {
    assert.ok(contains(error, fixture.closeError)); session = getContainedFileSession(error); assert.ok(session); return true;
  });
  assert.deepEqual(rows, ['line']); assert.equal(fixture.trace.closes, 1); assert.equal(fixture.trace.closed, false);
  assert.equal(fixture.trace.codeReads, 0);
  assert.equal(session.isSettled(), false); fixture.trace.allowClose = true;
  assert.equal((await session.releaseAfterClose()).settled, true); assert.equal(fixture.trace.closes, 2);
  assert.equal(fixture.trace.reads, 1, 'explicit original close recovery does not replay reads');
} else if (mode === 'falsey-primary-and-original-close') {
  for (const primary of [Object.freeze(new Error('original frozen reducer failure')), null, undefined, false, 0, '']) {
    const fixture = create();
    await assert.rejects(fixture.read(() => { throw primary; }), error => {
      assert.ok(contains(error, primary), 'exact primary value survives'); assert.ok(contains(error, fixture.closeError), 'original close survives'); return true;
    });
    assert.equal(fixture.trace.closes, 1); assert.equal(fixture.trace.closed, false);
    assert.equal(fixture.trace.codeReads, 0);
  }
} else {
  const fixture = create({ pendingRead: mode === 'pending-read-blocks-close', unsafeDiagnostic: mode === 'late-diagnostic-observation' });
  let session;
  await assert.rejects(fixture.read(() => assert.fail('failed read cannot publish lines')), error => {
    assert.ok(contains(error, fixture.readError));
    if (mode === 'late-diagnostic-observation') assert.ok(contains(error, 0), 'falsey original inspection survives');
    session = getContainedFileSession(error);
    if (mode === 'pending-read-blocks-close') assert.ok(session);
    else {
      // The original read was settled when its descriptor closed. Only the
      // later diagnostic getter revokes that observation; it must retain that
      // original guard without inventing another native close obligation.
      assert.equal(session, null);
      session = observeStorageResource(error, { phase: 'fixture-late-diagnostic' });
    }
    assert.equal(Object.getOwnPropertyDescriptor(error, 'reportStreamPath')?.value, 'explicit-model-root/log'); return true;
  });
  const expectedCloses = mode === 'pending-read-blocks-close' ? 0 : 1;
  assert.equal(fixture.trace.reads, 1); assert.equal(fixture.trace.closes, expectedCloses);
  assert.equal(fixture.trace.nameReads, mode === 'pending-read-blocks-close' ? 0 : 1); assert.equal(fixture.trace.codeReads, 0);
  assert.equal(session.isSettled(), false);
  if (mode === 'pending-read-blocks-close') await assert.rejects(session.releaseAfterClose());
  else assert.throws(() => session.requireSettled());
  assert.equal(fixture.trace.closes, expectedCloses);
  fixture.trace.readReleased = true;
  if (mode === 'pending-read-blocks-close') assert.equal((await session.releaseAfterClose()).settled, true);
  else { session.requireSettled(); assert.equal(session.isSettled(), true); }
  assert.equal(fixture.trace.closed, true); assert.equal(fixture.trace.closes, 1); assert.equal(fixture.trace.reads, 1);
}
console.log('Report streams retain original read/close owners and frozen/falsey failures through close-only recovery.');
