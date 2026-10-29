import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureRecordSamplePrefix, sampleRecordContent } from '../../../src/index/build/record-sample.js';
import { createRecordsClassifier } from '../../../src/index/build/records.js';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { createWatchPathClassifier } from '../../../src/index/build/watch/classify-path.js';
import { readRecordSample } from '../../../src/index/build/watch/records.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Named adapters exercise byte admission with the two production handoffs:
// initial scan supplies a prefix, while watch begins without one.
const initialSampleAdapter = async (source, cap, prefix) => {
  const requests = [];
  const result = await sampleRecordContent({ maxBytes: cap, prefix,
    readSample: async bytes => { requests.push(bytes); return source.subarray(0, bytes); } });
  return { ...result, requests };
};
const watchSampleAdapter = (source, cap) => initialSampleAdapter(source, cap, null);
const source = Buffer.from('plain FATAL: incident é');
for (const cap of [0, 5, 10, 11, 12, 23, 100, undefined]) {
  for (const suppliedBytes of [4, 16, 100]) {
    const prefix = captureRecordSamplePrefix(source.subarray(0, suppliedBytes), suppliedBytes);
    const initial = await initialSampleAdapter(source, cap, prefix);
    const watch = await watchSampleAdapter(source, cap);
    const limit = cap ?? 16384;
    assert.deepEqual(initial.bytes, source.subarray(0, limit));
    assert.equal(initial.text, watch.text);
    assert.equal(initial.complete, true);
    assert.deepEqual(initial.requests, limit === 0 || prefix.bytes.length >= limit || prefix.eof ? [] : [limit]);
    assert.deepEqual(watch.requests, limit === 0 ? [] : [limit]);
  }
}
const unknownShort = await initialSampleAdapter(source, 12, { bytes: source.subarray(0, 4), complete: false, eof: false });
assert.deepEqual(unknownShort.requests, [12], 'short unconfirmed prefixes require the bounded reader');
const unicode = Buffer.from('FATALé');
for (const cap of [5, 6, 7]) {
  const initial = await initialSampleAdapter(unicode, cap, captureRecordSamplePrefix(unicode, unicode.length));
  const watch = await watchSampleAdapter(unicode, cap);
  assert.equal(initial.text, watch.text);
  assert.equal(initial.text, unicode.subarray(0, cap).toString('utf8'));
  assert.equal(initial.bytes.length, cap);
}

const { dir: root } = await prepareIsolatedTestCacheDir('records-sniff-sampling-parity');
const file = path.join(root, 'incident.text');
const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: {} });
const originalOpen = fs.open;
// Observe real positioned reads without changing their progress or ownership.
const observeSampleReads = async action => {
  const reads = [];
  fs.open = async (filename, ...args) => {
    const handle = await originalOpen.call(fs, filename, ...args);
    if (path.resolve(String(filename)) !== file) return handle;
    const read = handle.read;
    handle.read = async (...readArgs) => {
      const result = await read.apply(handle, readArgs);
      reads.push({ requested: readArgs[2], position: readArgs[3], actual: result.bytesRead });
      return result;
    };
    return handle;
  };
  try { return { result: await action(), reads }; }
  finally { fs.open = originalOpen; }
};
const actualInitialAdapter = config => observeSampleReads(() => preprocessFiles({
  root, modes: ['records'], recordsConfig: config, ignoreMatcher, concurrency: 1,
  fileScan: { sampleBytes: 8 }
}));
const actualWatchAdapter = config => observeSampleReads(() => createWatchPathClassifier({
  root, canonicalRoot: toRealPathSync(root), normalizedRecordsRoot: null,
  ignoreMatcher, recordsClassifier: createRecordsClassifier({ root, config })
})(file));
const span = (requested, actual = requested, position = 0) => ({ requested, actual, position });
const scenarios = [
  { name: 'zero incidental scanner signal', text: 'FATAL: incident', cap: 0, expected: false,
    initial: [span(8)], watch: [] },
  { name: 'smaller than scanner and signal outside', text: 'xx FATAL: incident', cap: 7, expected: false,
    initial: [span(8)], watch: [span(7)] },
  { name: 'smaller than scanner and signal inside', text: 'FATAL: incident', cap: 5, expected: true,
    initial: [span(8)], watch: [span(5)] },
  { name: 'larger than scanner and signal outside', text: 'plain FATAL: incident', cap: 10, expected: false,
    initial: [span(8), span(10)], watch: [span(10)] },
  { name: 'larger than scanner and signal inside', text: 'plain FATAL: incident', cap: 11, expected: true,
    initial: [span(8), span(11)], watch: [span(11)] },
  { name: 'known EOF before cap', text: 'FATAL', cap: 100, expected: true,
    initial: [span(8, 5), span(3, 0, 5)], watch: [span(100, 5), span(95, 0, 5)] },
  { name: 'empty EOF', text: '', cap: 100, expected: false,
    initial: [span(8, 0)], watch: [span(100, 0)] },
  { name: 'omitted default', text: 'plain FATAL: incident', expected: true,
    initial: [span(8), span(16384, 21), span(16363, 0, 21)],
    watch: [span(16384, 21), span(16363, 0, 21)] },
  { name: 'multibyte split', text: 'FATALé end', cap: 6, expected: true,
    initial: [span(8)], watch: [span(6)] },
  { name: 'complete multibyte at cap', text: 'FATALé end', cap: 7, expected: true,
    initial: [span(8)], watch: [span(7)] }
];
for (const scenario of scenarios) {
  await fs.writeFile(file, scenario.text);
  const config = scenario.cap == null ? {} : { sniffBytes: scenario.cap };
  const initial = await actualInitialAdapter(config);
  const watch = await actualWatchAdapter(config);
  assert.equal(initial.result.entriesByMode.records.some(entry => entry.rel === 'incident.text'), scenario.expected, scenario.name);
  assert.equal(Boolean(watch.result.record), scenario.expected, scenario.name);
  assert.deepEqual(initial.reads, scenario.initial, `${scenario.name}: actual preprocess byte requests/progress`);
  assert.deepEqual(watch.reads, scenario.watch, `${scenario.name}: actual watch byte requests/progress`);
}
// Explicit path routing survives zero without records-specific sample I/O.
const included = { sniffBytes: 0, includeGlobs: ['incident.text'] };
assert.equal((await actualInitialAdapter(included)).result.entriesByMode.records.length, 1);
const includedWatch = await actualWatchAdapter(included);
assert.ok(includedWatch.result.record);
assert.deepEqual(includedWatch.reads, []);
// Ordinary unavailable samples remain optional; unconfirmed resource ownership
// must survive the watch diagnostic boundary.
fs.open = async () => { throw Object.assign(new Error('pending resource'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => false
}); };
try { await assert.rejects(readRecordSample(file, 10), error => error.cacheOwnershipPending === true); }
finally { fs.open = originalOpen; }
console.log('Records samples preserve byte caps, completeness, EOF and UTF-8 parity through actual preprocess/watch adapters.');
