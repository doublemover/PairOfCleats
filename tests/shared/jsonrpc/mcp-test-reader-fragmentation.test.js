import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createMcpTestReader } from '../../helpers/mcp-reader.js';

// Independent wire vectors: neither production framing nor parser helpers are
// imported by this oracle. Byte boundaries include the middle of UTF-8 scalars.
const text = '{"jsonrpc":"2.0","id":7,"result":{"text":"雪😀","empty":""}}';
const response = { jsonrpc: '2.0', id: 7, result: { text: '雪😀', empty: '' } };
const notification = { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 7, progress: 1 } };
const frame = body => Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body]);
const encode = (value, transport) => transport === 'legacy' ? frame(Buffer.from(JSON.stringify(value))) : Buffer.from(JSON.stringify(value) + '\n');
const make = (transport, bounds = {}) => {
  const stream = new PassThrough();
  const events = ['data', 'end', 'close', 'error'];
  const before = events.map(event => stream.listenerCount(event));
  const reader = createMcpTestReader(stream, { transport, ...bounds });
  const detached = () => assert.deepEqual(events.map(event => stream.listenerCount(event)), before);
  return { stream, reader, detached, close() { reader.cancelPending(new Error('fixture cleanup')); stream.destroy(); detached(); } };
};
const assertFailure = async (transport, bytes, reason = null, { end = false, bounds = {} } = {}) => {
  const session = make(transport, bounds);
  try {
    const read = session.reader.readMessage(); read.catch(() => {});
    session.stream.write(bytes);
    if (end) session.stream.end();
    await assert.rejects(read, error => error.code === 'ERR_MCP_TEST_PROTOCOL' && (!reason || error.reason === reason));
    assert.equal(session.reader.getState().reading, false); session.detached();
    assert.ok(session.reader.getState().peakRetainedWireBytes <= (bounds.maxRetainedBytes || 16 * 1024 * 1024));
  } finally { session.close(); }
};

for (const transport of ['legacy', 'line']) {
  const wire = transport === 'legacy' ? frame(Buffer.from(text)) : Buffer.from(text + '\n');
  for (let split = 0; split <= wire.length; split++) {
    const session = make(transport);
    try {
      const read = session.reader.readMessage(); read.catch(() => {});
      session.stream.write(wire.subarray(0, split)); session.stream.write(wire.subarray(split));
      assert.deepEqual(await read, response, transport + ' split ' + split);
      assert.equal(session.reader.getState().delivered, 1);
      assert.equal(session.reader.getState().retainedWireBytes, 0);
    } finally { session.close(); }
  }
  for (const bytewise of [false, true]) {
    const session = make(transport);
    try {
      const last = { jsonrpc: '2.0', id: '7', result: false };
      const burst = Buffer.concat([encode(response, transport), encode(notification, transport), encode(last, transport)]);
      // Input arrives before any pending read and between successive reads.
      if (bytewise) for (let index = 0; index < burst.length; index++) session.stream.write(burst.subarray(index, index + 1));
      else session.stream.write(burst);
      assert.deepEqual(await session.reader.readAnyMessage(), response);
      assert.deepEqual(await session.reader.readAnyMessage(), notification);
      assert.deepEqual(await session.reader.readMessage(), last);
      assert.deepEqual(session.reader.notifications, [notification]);
      session.reader.notifications.length = 0;
      assert.equal(session.reader.getState().retainedWireBytes, 0);
      const eof = session.reader.readMessage(); eof.catch(() => {}); session.stream.end();
      await assert.rejects(eof, { code: 'ERR_MCP_TEST_STREAM_CLOSED' }); session.detached();
    } finally { session.close(); }
  }
  const fragmented = make(transport);
  try {
    const large = { jsonrpc: '2.0', id: 9, result: 'x'.repeat(70000) }, wire = encode(large, transport);
    const read = fragmented.reader.readMessage(); read.catch(() => {});
    for (let index = 0; index < wire.length; index++) fragmented.stream.write(wire.subarray(index, index + 1));
    assert.deepEqual(await read, large);
    assert.equal(fragmented.reader.getState().peakBufferSegments, 2, 'fragment count cannot become a retained buffer-object count');
  } finally { fragmented.close(); }
  await assertFailure(transport, Buffer.from('ordinary startup log\n'));
  await assertFailure(transport, encode([], transport), 'invalid-jsonrpc-envelope');
  await assertFailure(transport, encode({ jsonrpc: '2.0', id: 1 }, transport), 'invalid-response');
  await assertFailure(transport, encode({ jsonrpc: '2.0', id: 1, result: 0, error: {} }, transport), 'invalid-response');
  const concurrent = make(transport);
  try {
    const read = concurrent.reader.readMessage(); read.catch(() => {});
    await assert.rejects(concurrent.reader.readAnyMessage(), { code: 'ERR_MCP_TEST_CONCURRENT_READ' });
    concurrent.stream.write(encode(response, transport)); assert.deepEqual(await read, response);
    const controller = new AbortController(), cause = Object.freeze(new Error('cancel source'));
    const canceled = concurrent.reader.readMessage({ signal: controller.signal }); canceled.catch(() => {});
    controller.abort(cause);
    await assert.rejects(canceled, error => error.code === 'ABORT_ERR' && error.cause === cause);
    concurrent.detached(); assert.equal(concurrent.reader.getState().retainedWireBytes, 0);
    await assert.rejects(concurrent.reader.readMessage(), { code: 'ABORT_ERR' });
  } finally { concurrent.close(); }
  const limited = make(transport, { maxNotifications: 2 });
  try {
    const read = limited.reader.readMessage(); read.catch(() => {});
    limited.stream.write(Buffer.concat([encode(notification, transport), encode(notification, transport),
      encode(notification, transport), encode(response, transport)]));
    await assert.rejects(read, error => error.reason === 'notification-count-limit');
    assert.equal(limited.reader.notifications.length, 2); limited.detached();
  } finally { limited.close(); }
  const queue = make(transport, { maxPendingMessages: 2 });
  try {
    queue.stream.write(Buffer.concat(Array.from({ length: 3 }, () => encode(response, transport))));
    await assert.rejects(queue.reader.readMessage(), error => error.reason === 'pending-message-limit'); queue.detached();
  } finally { queue.close(); }
  const retention = make(transport, { maxRetainedBytes: 256, maxMessageBytes: 128 });
  try {
    retention.stream.write(Buffer.concat(Array.from({ length: 10 }, () => encode(response, transport))));
    await assert.rejects(retention.reader.readMessage(), error => ['retained-byte-limit', 'declared-body-exceeds-retained-limit'].includes(error.reason));
    assert.ok(retention.reader.getState().peakRetainedWireBytes <= 256); retention.detached();
  } finally { retention.close(); }
  const failed = make(transport), original = Object.freeze(new Error('original stream failure'));
  try {
    const read = failed.reader.readMessage(); read.catch(() => {});
    failed.stream.emit('error', original);
    await assert.rejects(read, error => error === original); failed.detached();
  } finally { failed.close(); }
}

const splitHeader = make('legacy');
try {
  let settled = false;
  const read = splitHeader.reader.readMessage(); read.then(() => { settled = true; }, () => { settled = true; });
  const body = Buffer.from(text);
  splitHeader.stream.write(Buffer.from('Content-Length: ' + body.length + '\r\n'));
  await Promise.resolve(); assert.equal(settled, false, 'first CRLF cannot consume the incomplete header');
  splitHeader.stream.write(Buffer.concat([Buffer.from('\r\n'), body])); assert.deepEqual(await read, response);
} finally { splitHeader.close(); }
for (const length of ['0', '-1', '999999999999999999999', '9007199254740992', '8388609', '1e3']) {
  await assertFailure('legacy', Buffer.from('Content-Length: ' + length + '\r\n\r\n'), 'invalid-content-length');
}
await assertFailure('legacy', Buffer.from('Content-Length: 5\r\ncontent-length: 5\r\n\r\n'), 'invalid-or-duplicate-header');
await assertFailure('legacy', Buffer.from('Content-Length: 64\r\n\r\n'), 'declared-body-exceeds-retained-limit', { bounds: { maxRetainedBytes: 32 } });
await assertFailure('legacy', Buffer.from('X'.repeat(33)), 'header-byte-limit', { bounds: { maxHeaderBytes: 32 } });
await assertFailure('legacy', Buffer.from('Content-Length: 10\r\n'), 'eof-mid-header', { end: true });
await assertFailure('legacy', Buffer.from('Content-Length: 10\r\n\r\n{}'), 'eof-mid-body', { end: true });
await assertFailure('line', Buffer.from(text), 'eof-mid-body', { end: true });
await assertFailure('line', Buffer.from('x'.repeat(65)), 'line-byte-limit', { bounds: { maxMessageBytes: 64 } });
await assertFailure('legacy', Buffer.from('{"jsonrpc":"2.0"}\n'), 'invalid-header-line');
await assertFailure('legacy', Buffer.from(text + '\n'), 'invalid-header-encoding');
await assertFailure('line', frame(Buffer.from(text)), 'invalid-utf8-or-json');
await assertFailure('legacy', frame(Buffer.from('{oops}')), 'invalid-utf8-or-json');
const badUtf8 = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"result":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
await assertFailure('legacy', frame(badUtf8), 'invalid-utf8-or-json');
await assertFailure('line', Buffer.concat([badUtf8, Buffer.from('\n')]), 'invalid-utf8-or-json');
assert.throws(() => createMcpTestReader(new PassThrough()), /requires legacy or line/);
console.log('MCP test reader preserves independent framing vectors across every byte split and bounded terminal cleanup');
