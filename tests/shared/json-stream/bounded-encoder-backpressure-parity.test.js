#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { writeJsonValue, stringifyJsonValue } from '../../../src/shared/json-stream/encode.js';
const shared = { a: 1 };
const value = { text: 'x'.repeat(65520) + '😀'.repeat(64), list: Array.from({ length: 3000 }, (_, id) => ({ id, nil: undefined, data: [null, NaN, Infinity, shared] })), typed: new Uint16Array([1, 65535]), shared, json: { toJSON: () => ({ date: 'stable' }) } };
const chunks = []; let writes = 0;
const sink = new Writable({ highWaterMark: 32, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); writes += 1; setImmediate(callback); } });
await writeJsonValue(sink, value);
assert.equal(Buffer.concat(chunks).toString('utf8'), stringifyJsonValue(value));
assert.ok(writes < 20, 'bounded chunks replace per-field punctuation writes');
assert.ok(chunks.every(chunk => chunk.length <= 4 * 65536));
await assert.rejects(writeJsonValue(sink, { value: 1n }), TypeError);
const circular = {}; circular.self = circular;
await assert.rejects(writeJsonValue(sink, circular), /Circular/);
sink.end();
