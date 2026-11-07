import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { withBenchParitySources } from '../../helpers/bench-parity-sources.js';
import { discoverReportStreams, createReportStreamContext, REPORT_STREAM_INVENTORY_LIMITS } from '../../../tools/bench/language/report-streams.js';
import { buildBenchParityCoverage } from '../../../tools/bench/language/report-coverage.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/bench-stream-inventory-bounds/')[1];
assert.ok(['complete-quiet-inventory', 'entry-and-captured-byte-bounds', 'path-and-directory-bounds',
  'original-directory-close-failure'].includes(mode));
const coverageFor = (inventory, context) => buildBenchParityCoverage({ tasks: [],
  logFiles: inventory.entries.filter(row => row.path.endsWith('.log')).map(row => row.path),
  diagnosticFiles: inventory.entries.filter(row => row.path.endsWith('.diagnostics.jsonl')).map(row => row.path),
  diagnosticsStream: { malformedLines: 0, unknownTypeCount: 0 }, streamRead: context.summary() });
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(Object.getOwnPropertyDescriptor(error, 'cause')?.value, target, seen)
    || (Object.getOwnPropertyDescriptor(error, 'errors')?.value ?? []).some(row => contains(row, target, seen));
};
if (mode === 'original-directory-close-failure') {
  // Explicit owner model executes the original discovery function. It tests
  // classification, not native descriptor retirement or a forged lease receipt.
  const source = await fs.readFile(new URL('../../../tools/bench/language/report-streams.js', import.meta.url), 'utf8');
  const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .flatMap(node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations ?? []);
  const declaration = declarations.find(row => row.id.name === 'discoverReportStreams')?.init; assert.ok(declaration);
  const trace = { opens: 0, closes: 0, codeReads: 0, observationCalls: 0 }, primary = new Error('original modeled directory close failure');
  Object.defineProperties(primary, { cacheOwnershipPending: { value: true },
    cacheOwnershipReleased: { value() { trace.observationCalls++; return false; } },
    code: { get() { trace.codeReads++; throw new Error('unavailable code accessor'); } } });
  Object.freeze(primary);
  const discover = vm.runInNewContext('(' + source.slice(declaration.start, declaration.end) + ')', {
    Buffer, path, performance, REPORT_STREAM_INVENTORY_LIMITS, describeStorageFailure, throwIfAborted,
    assertNoSymlinkPath() {},
    withStorageDirectory: async (_directory, action) => {
      trace.opens++; await action({ read: async () => null }); trace.closes++; throw primary;
    }
  });
  await assert.rejects(discover('explicit-owner-model'), error => contains(error, primary));
  assert.equal(trace.opens, 1); assert.equal(trace.closes, 1); assert.equal(trace.codeReads, 0);
  assert.ok(trace.observationCalls > 0, 'the original observation prevents ordinary warning classification');
} else await withBenchParitySources(async source => {
  await source.writeQuiet();
  if (mode === 'complete-quiet-inventory') {
    const inventory = await discoverReportStreams(source.root), context = createReportStreamContext(inventory);
    for (const entry of inventory.entries) await context.consume(entry.path, () => {});
    assert.equal(inventory.entries.length, 2); assert.equal(inventory.directoryVisits, 1);
    assert.equal(inventory.errorCount, 0); assert.equal(inventory.stopped, false);
    assert.equal(inventory.entriesVisited, 2); assert.equal(context.summary().incomplete, false);
    assert.equal(coverageFor(inventory, context).state, 'complete');
    assert.equal(inventory.capturedBytes, (await fs.stat(source.logPath)).size);
    assert.equal(context.summary().metrics.bytesRead, inventory.capturedBytes);
    const controller = new AbortController(); controller.abort(null);
    await assert.rejects(discoverReportStreams(source.root, { signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
    for (const limits of [{ entries: 0 }, { entries: REPORT_STREAM_INVENTORY_LIMITS.entries + 1 }, { unknown: 1 }]) {
      await assert.rejects(discoverReportStreams(source.root, { limits }), { name: 'RangeError' });
    }
  } else {
    const nested = path.join(source.logsRoot, 'one', 'two'); await fs.mkdir(nested, { recursive: true });
    const limits = mode === 'entry-and-captured-byte-bounds' ? [{ entries: 1 }, { capturedBytes: 1 }]
      : [{ pathBytes: Buffer.byteLength(source.logsRoot) }, { directories: 1 }, { depth: 1 }];
    for (const limit of limits) {
      const reason = Object.keys(limit)[0], inventory = await discoverReportStreams(source.root, { limits: limit });
      const context = createReportStreamContext(inventory), summary = context.summary();
      assert.equal(inventory.stopped, true); assert.equal(summary.incomplete, true);
      assert.ok(inventory.errors.some(row => row.code === 'ERR_REPORT_INVENTORY_LIMIT' && row.reason === reason));
      assert.equal(inventory.errorCount, inventory.errors.length + inventory.errorsOmitted);
      assert.notEqual(coverageFor(inventory, context).state, 'complete', reason);
      assert.equal(summary.metrics.fileOpens, 0, 'discovery does not open selected file contents');
      if (reason === 'entries') assert.equal(inventory.entriesVisited, 1);
      if (reason === 'capturedBytes') assert.ok(inventory.capturedBytes <= limit.capturedBytes);
      if (reason === 'pathBytes') assert.ok(inventory.retainedPathBytes <= limit.pathBytes);
      if (reason === 'directories') assert.equal(inventory.directoryVisits, 1);
      if (reason === 'depth') assert.ok(inventory.directoryVisits <= 2);
    }
  }
});
console.log('Report discovery retains bounded coverage and original directory failure observations.');
