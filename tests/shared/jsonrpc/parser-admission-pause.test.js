import assert from 'node:assert/strict';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';

const frame = value => {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};
const values = [{ id: 1, text: '🙂' }, { id: '1', text: 'second' }, { id: 3 }];
const observed = [], errors = [];
const parser = createFramedJsonRpcParser({ maxBufferBytes: 1024,
  onMessage: value => { observed.push(value); return false; }, onError: error => errors.push(error) });
parser.push(Buffer.concat(values.slice(0, 2).map(frame)));
assert.deepEqual(observed, values.slice(0, 1));
assert.equal(parser.getState().paused, true);
assert.equal(parser.getState().bufferedBytes, frame(values[1]).length);
parser.push(frame(values[2]));
assert.equal(observed.length, 1, 'push cannot bypass the paused admission owner');
assert.equal(parser.resume(), false); assert.deepEqual(observed, values.slice(0, 2));
assert.equal(parser.resume(), false); assert.deepEqual(observed, values);
assert.equal(parser.resume(), true); assert.equal(parser.getState().bufferedBytes, 0);
parser.push(frame(values[0])); assert.equal(parser.getState().paused, true);
parser.push(Buffer.alloc(1025));
assert.equal(errors.length, 1); assert.equal(parser.getState().closed, true);
assert.equal(parser.getState().bufferedBytes, 0); assert.equal(parser.resume(), false);
parser.dispose(); assert.equal(parser.getState().paused, false);
const synchronous = [];
const ordinary = createFramedJsonRpcParser({ onMessage: value => { synchronous.push(value); } });
ordinary.push(Buffer.concat(values.map(frame))); assert.deepEqual(synchronous, values);
ordinary.dispose();
console.log('JSON-RPC admission pause retains bounded coalesced bytes and preserves synchronous consumers.');
