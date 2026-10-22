import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
import { normalizeNumber } from '../../../src/shared/env/core.js';
for (const value of [undefined, null, '', '   ']) assert.equal(normalizeNumber(value), null);
assert.equal(normalizeNumber('0'), 0);
assert.equal(normalizeNumber('5'), 5);
assert.equal(normalizeNumber('bad'), null);
for (const maxBufferBytes of [32, 128, 0]) {
  const stdin = new PassThrough(), stdout = new PassThrough();
  const service = await startMcpSdkServer({ toolDefs: [], schemaVersion: 1, toolVersion: 'fixture',
    serverInfo: { name: 'fixture', version: '1' }, queueMax: 1, maxBufferBytes, stdin, stdout,
    resolveToolTimeoutMs: () => 1000 });
  const failures = [];
  service.server.onerror = error => failures.push(error);
  try {
    stdin.write('x'.repeat(16)); stdin.write('x'.repeat(17));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failures.length, maxBufferBytes === 32 ? 1 : 0);
    if (failures.length) assert.match(failures[0].message, /maximum size of 32 bytes/);
  } finally { await service.close(); stdin.destroy(); stdout.destroy(); }
}
console.log('SDK configured input buffer bound passed');
