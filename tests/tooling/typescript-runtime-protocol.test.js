#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import {
  createRecordWriter, measureJsonRecord, readRecords, resolveProtocolLimits
} from '../../src/index/tooling/typescript/runtime/protocol.js';
import { createResultAssembler, writeProviderResult } from '../../src/index/tooling/typescript/runtime/result.js';
import { readProviderRequest } from '../../src/index/tooling/typescript/runtime/entry.js';

const limits = resolveProtocolLimits({ maxRecordBytes: 4096, maxInputBytes: 16384, maxOutputBytes: 16384 });
const reason = expected => error => error.code === 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE' && error.reason === expected;
const collect = async chunks => {
  const records = [];
  for await (const value of readRecords(Readable.from(chunks), limits, limits.maxInputBytes)) records.push(value);
  return records;
};
const samples = [null, true, 3.1, -0, '\n\r\t\b\f\u0001"\\é😀\ud800\udfff', { a: undefined, b: [undefined, 'x'] }];
for (const sample of samples) assert.equal(measureJsonRecord(sample, limits), Buffer.byteLength(`${JSON.stringify(sample)}\n`));
const unicode = Buffer.from(`${JSON.stringify({ type: 'unicode', value: 'é😀\ud800' })}\n`);
assert.deepEqual(await collect([...unicode].map(byte => Buffer.from([byte]))), [{ type: 'unicode', value: 'é😀\ud800' }]);
await assert.rejects(collect([Buffer.from('{bad}\n')]), reason('malformed-record'));
await assert.rejects(collect([Buffer.from('{"x":1}')]), reason('unterminated-record'));
await assert.rejects(collect([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from('"}\n')]), reason('malformed-record'));
await assert.rejects(collect([Buffer.from('x'.repeat(4096))]), reason('record-byte-limit'));
await assert.rejects(collect([Buffer.from('[]\n')]), reason('malformed-record'));
assert.throws(() => measureJsonRecord({ callback() {} }, limits), reason('non-json-value'));
assert.throws(() => measureJsonRecord({ get x() { throw new Error('must not invoke getter'); } }, limits), reason('non-json-accessor'));
const cyclic = {}; cyclic.self = cyclic;
assert.throws(() => measureJsonRecord(cyclic, limits), reason('cyclic-record'));
let alias = { x: 'x' };
for (let i = 0; i < 30; i += 1) alias = { left: alias, right: alias };
assert.throws(() => measureJsonRecord(alias, limits), reason('record-byte-limit'), 'preflight must not stringify an exponentially expanded alias object');
assert.throws(() => resolveProtocolLimits({ maxRecordBytes: Infinity }), reason('invalid-limit'));

const written = [];
let pending = 0, peakPending = 0;
const sink = new Writable({ highWaterMark: 8, write(chunk, encoding, callback) {
  pending += 1; peakPending = Math.max(peakPending, pending); written.push(Buffer.from(chunk));
  setImmediate(() => { pending -= 1; callback(); });
} });
const write = createRecordWriter(sink, limits, limits.maxOutputBytes);
for (let i = 0; i < 100; i += 1) await write({ type: 'number', value: i });
assert.equal(peakPending, 1, 'writer must await each record instead of buffering the complete message');
assert.equal((await collect(written)).length, 100);
assert.equal(write.tryWrite({ type: 'log', value: 'x'.repeat(100) }, 16), false, 'synchronous telemetry cannot overfill its pending-write allowance');
const neverWritten = new Writable({ write() { throw new Error('oversized record must fail before stream write'); } });
await assert.rejects(createRecordWriter(neverWritten, limits, limits.maxOutputBytes)({ value: 'x'.repeat(4096) }), reason('record-byte-limit'));
await assert.rejects(createRecordWriter(neverWritten, limits, 1)({ value: 1 }), reason('total-byte-limit'));
const brokenPipe = new Writable({ write(chunk, encoding, callback) { callback(new Error('owned pipe failure')); } });
await assert.rejects(createRecordWriter(brokenPipe, limits, limits.maxOutputBytes)({ value: 1 }), /owned pipe failure/);

const sampleResult = {
  provider: { id: 'typescript', version: 'test' },
  byChunkUid: { a: { payload: { returnType: 'number' } }, b: { payload: { returnType: 'string' } } },
  diagnostics: { checks: [{ name: 'kept' }] },
  symbolicTypeGraphs: [{ graphId: 'g', graph: { contextKey: 'ctx', rootIds: ['n'], nodes: [{ id: 'n', kind: 'Literal', value: 'hello' }] } }],
  extraVersionedField: { preserved: true }
};
const records = [];
await writeProviderResult(sampleResult, async record => { records.push(record); });
assert.ok(records.some(record => record.type === 'graph-node'));
const assembler = createResultAssembler();
for (const record of records) assembler.accept(record);
assert.deepEqual(JSON.parse(JSON.stringify(assembler.finish())), sampleResult);
assert.throws(() => assembler.accept({ type: 'complete' }), reason('record-after-complete'));
const missing = createResultAssembler();
missing.accept({ type: 'result-start', version: 1 });
assert.throws(() => missing.finish(), reason('missing-completion'));
missing.accept({ type: 'chunk', chunkUid: 'a', value: {} });
assert.throws(() => missing.accept({ type: 'chunk', chunkUid: 'a', value: {} }), reason('duplicate-or-invalid-chunk'));
const request = values => Readable.from(values.map(value => Buffer.from(`${JSON.stringify(value)}\n`)));
await assert.rejects(readProviderRequest(request([{ type: 'init', version: 1, context: { repoRoot: '/' }, documents: 1, targets: 0 }, { type: 'end' }]), limits), reason('request-count-mismatch'));
await assert.rejects(readProviderRequest(request([{ type: 'init', version: 1, context: { repoRoot: '/' }, documents: 0, targets: 0 }, { type: 'end' }, { type: 'end' }]), limits), reason('request-after-end'));
console.log('TypeScript runtime protocol accounts bytes, preserves graphs and rejects incomplete or malformed messages.');
