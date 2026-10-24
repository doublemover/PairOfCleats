import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRecordsClassifier, normalizeRecordsConfig } from '../../../src/index/build/records.js';
import { readRecordSample } from '../../../src/index/build/watch/records.js';

const originalOpen = fs.open;
let opens = 0;
fs.open = async () => { opens += 1; throw new Error('zero cap must not touch the filesystem'); };
try {
  assert.equal(normalizeRecordsConfig({ sniffBytes: 0 }).sniffBytes, 0);
  assert.equal(await readRecordSample('unused-file.text', 0), '');
  assert.equal(opens, 0);
} finally { fs.open = originalOpen; }
const input = { relPath: 'incident.text', ext: '.text', sampleText: 'FATAL: original incident evidence' };
for (const config of [{}, { sniffBytes: 20 }]) {
  assert.ok(createRecordsClassifier({ config }).classify(input), 'positive/default samples keep content detection');
}
assert.equal(createRecordsClassifier({ config: { sniffBytes: 0 } }).classify(input), null,
  'incidental initial-scan bytes cannot bypass disabled content sniffing');
assert.ok(createRecordsClassifier({ config: { sniffBytes: 0 } }).classify({ ...input, relPath: 'incident.log', ext: '.log' }),
  'zero content cap preserves explicit path-based record routing');
assert.equal(normalizeRecordsConfig({}).sniffBytes, 16384);
console.log('Initial/watch record classification preserves explicit zero, default and positive sniff caps.');
