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
console.log('Structured crash credentials and message assignments are redacted without losing token metrics.');
