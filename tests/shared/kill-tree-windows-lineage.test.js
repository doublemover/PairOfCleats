import assert from 'node:assert/strict';
import { resolveWindowsDescendantPids } from '../../src/shared/kill-tree/windows.js';

const snapshot = '3 2\r\n20 10\r\n2 1\r\n4 2\r\n10 0\r\n5 3\r\n';
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 1), [2, 3, 4, 5], 'a missing parent still owns its recorded descendants');
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 2), [3, 4, 5], 'root itself is never a descendant');
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 10), [20], 'unrelated process trees remain separate');
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 99), []);
assert.deepEqual(resolveWindowsDescendantPids('', 1), []);
assert.deepEqual(resolveWindowsDescendantPids('0 0\n2 1', 1), [2], 'system idle PID zero is not a kill target');
assert.deepEqual(resolveWindowsDescendantPids('2 1\n1 2\n3 2', 1), [2, 3], 'PID cycles cannot revisit the root');
assert.deepEqual(resolveWindowsDescendantPids('4294967295 1\n2 4294967295', 1), [4294967295, 2]);
for (const invalid of ['1', '2 -1', '-2 1', '2.5 1', '2 1\n2 3', '2 1\npartial', '4294967296 1', '2 4294967296']) {
  assert.throws(() => resolveWindowsDescendantPids(invalid, 1), { code: 'ERR_WINDOWS_PROCESS_SNAPSHOT' }, invalid);
}
const count = 10000;
const chain = Array.from({ length: count }, (_, index) => `${index + 2} ${index + 1}`).join('\n');
const descendants = resolveWindowsDescendantPids(chain, 1);
assert.equal(descendants.length, count);
assert.deepEqual([descendants[0], descendants.at(-1)], [2, count + 1]);
console.log('Windows PID snapshot walking preserves orphan lineage, cycles, authority and malformed-input rejection.');
