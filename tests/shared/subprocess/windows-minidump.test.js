import assert from 'node:assert/strict';
import { inspectWindowsMinidump, WINDOWS_MINIDUMP_MAX_BYTES } from '../../../tools/shared/windows-minidump.js';
import { createWindowsMinidumpFixture } from '../../helpers/windows-minidump-fixture.js';

// UNVALIDATED: bounded synthetic format controls, no process/debugger/crash.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['valid', 'wrong-pid', 'pid-unavailable', 'bad-signature', 'bad-version', 'oversize', 'short-header',
  'directory-overflow', 'stream-overflow', 'header-overlap', 'duplicate-stream', 'full-memory', 'missing-context',
  'exception-parameters', 'missing-thread', 'thread-overflow', 'thread-context', 'module-overflow', 'module-name', 'pdb-name'];
assert.ok(cases.includes(selected));
let buffer = createWindowsMinidumpFixture();
const expectedPid = selected === 'wrong-pid' ? 4321 : 1234;
if (selected === 'pid-unavailable') buffer.writeUInt32LE(0, 84);
if (selected === 'bad-signature') buffer.writeUInt32LE(0, 0);
if (selected === 'bad-version') buffer.writeUInt32LE(1, 4);
if (selected === 'oversize') buffer = Buffer.alloc(WINDOWS_MINIDUMP_MAX_BYTES + 1);
if (selected === 'short-header') buffer = buffer.subarray(0, 31);
if (selected === 'directory-overflow') buffer.writeUInt32LE(4097, 8);
if (selected === 'stream-overflow') buffer.writeUInt32LE(0xffffffff, 36);
if (selected === 'header-overlap') buffer.writeUInt32LE(32, 40);
if (selected === 'duplicate-stream') buffer.writeUInt32LE(15, 44);
if (selected === 'full-memory') buffer.writeBigUInt64LE(2n, 24);
if (selected === 'missing-context') buffer.writeUInt32LE(0, 264);
if (selected === 'exception-parameters') buffer.writeUInt32LE(16, 136);
if (selected === 'missing-thread') buffer.writeUInt32LE(78, 104);
if (selected === 'thread-overflow') buffer.writeUInt32LE(4097, 272);
if (selected === 'thread-context') buffer.writeUInt32LE(0, 316);
if (selected === 'module-overflow') buffer.writeUInt32LE(4097, 324);
if (selected === 'module-name') buffer.writeUInt32LE(32769, 464);
if (selected === 'pdb-name') buffer.fill(0x61, 568);
if (selected === 'valid') {
  const result = inspectWindowsMinidump(buffer, { expectedPid });
  assert.equal(result.exceptionHex, '0xc0000005'); assert.equal(result.threadId, 77);
  assert.equal(result.processId, 1234); assert.equal(result.threadCount, 1);
  assert.deepEqual(result.exceptionParameters, ['0x1', '0xfeed']);
  assert.equal(result.modules[0].name, 'C:\\owned\\fixture.node');
  assert.equal(result.modules[0].pdb.path, 'fixture.pdb'); assert.equal(result.modules[0].pdb.age, 2);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.modules));
  assert.equal(result.qualification, 'bounded-minidump-structure-and-target-pid');
} else assert.throws(() => inspectWindowsMinidump(buffer, { expectedPid }), { code: 'ERR_WINDOWS_MINIDUMP' });
console.log(`Windows minidump structure control: ${selected}`);
