import assert from 'node:assert/strict';
import { boundedCrashEvent } from '../../src/index/build/crash-evidence.js';

const original = Object.freeze({ token: 'private-value', tokenCount: 7, tokenizer: 'v3',
  nested: Object.freeze({ TOKEN: 'another-private-value', access_token: 'access-private-value' }),
  message: 'request token=message-private-value; phase=search' });
const event = boundedCrashEvent(original);
assert.equal(event.token, '[redacted]');
assert.equal(event.nested.TOKEN, '[redacted]');
assert.equal(event.nested.access_token, '[redacted]');
assert.equal(event.message, 'request token=[redacted]; phase=search');
assert.equal(event.tokenCount, 7); assert.equal(event.tokenizer, 'v3');
assert.ok(!JSON.stringify(event).includes('private-value'));
assert.equal(original.token, 'private-value', 'redaction does not mutate caller evidence');
let visits = 0;
let shared = Object.defineProperty({}, 'note', { enumerable: true, get() { visits += 1; return 'shared leaf witness'; } });
for (let depth = 0; depth < 4; depth += 1) shared = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`branch${index}`, shared]));
const expanded = boundedCrashEvent({ message: 'original graph failure', code: 'GRAPH_PRIMARY', payload: shared });
assert.ok(visits <= 1024, `a compact shared graph must not amplify source inspections: ${visits}`);
assert.equal(expanded.truncated, true); assert.equal(expanded.message, 'original graph failure');
assert.equal(expanded.code, 'GRAPH_PRIMARY');
let messageReads = 0;
const changing = { code: 'ORIGINAL_CODE', payload: Array.from({ length: 9 }, () => 'x'.repeat(8192)) };
Object.defineProperty(changing, 'message', { enumerable: true, get() {
  messageReads += 1;
  if (messageReads > 1) throw new Error('a late diagnostic inspection must not replace the original failure');
  return 'original changing message';
} });
let captured;
assert.doesNotThrow(() => { captured = boundedCrashEvent(changing); });
assert.equal(messageReads, 1); assert.equal(captured.message, 'original changing message');
assert.equal(captured.code, 'ORIGINAL_CODE'); assert.equal(captured.truncated, true);
let hostile;
assert.doesNotThrow(() => { hostile = boundedCrashEvent({ message: { toString: 'inert data', valueOf: 'inert data' },
  code: { toString: 'inert data', valueOf: 'inert data' }, payload: changing.payload }); });
assert.equal(hostile.truncated, true); assert.equal(hostile.code, '');
assert.match(hostile.message, /byte allowance/);
console.log('Crash events retain redaction, bounded shared-graph traversal and once-observed original error fields.');
console.log(JSON.stringify({ sharedLeafInspections: visits, originalMessageInspections: messageReads }));
