import assert from 'node:assert/strict';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';

// AUTHORED real account/constructor controls; no child is launched.
for (const value of [NaN, Infinity, -1, '1024', Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => createProcessMemoryAccount(value), { code: 'ERR_PROCESS_TASK_BUDGET' });
}
const account = createProcessMemoryAccount(process.memoryUsage().rss + 512 * 1024 * 1024);
const before = account.stats();
for (const bytes of [NaN, Infinity, -1, '1', Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => account.reserve(bytes), { code: 'ERR_PROCESS_TASK_BUDGET' });
  assert.equal(account.stats().reservedBytes, 0, 'invalid reservation cannot poison aggregate accounting');
}
const release = account.reserve(1.5);
assert.equal(account.stats().reservedBytes, 2);
release(); release();
assert.equal(account.stats().reservedBytes, 0);
for (const options of [{ maxThreads: NaN }, { maxThreads: 0 }, { maxThreads: 1.5 },
  { oldSpaceMb: Infinity }, { taskTimeout: 0 }, { maxMessageBytes: NaN }, { maxMessageBytes: 1 }, { maxRestartAttempts: -1 }]) {
  assert.throws(() => new IndexerProcessPool({ ...options, budgetAccount: account }), { code: 'ERR_PROCESS_TASK_BUDGET' });
  assert.equal(account.stats().reservedBytes, 0);
}
assert.equal(account.stats().limitBytes, before.limitBytes);
for (const value of [undefined, null, false, 0, '']) {
  const pool = new IndexerProcessPool({ budgetAccount: account });
  pool.pump = () => { throw value; };
  try {
    const failure = await pool.run({ value: 1 }, { name: 'tokenizeChunk' })
      .then(() => assert.fail('expected dispatch failure'), error => ({ error }));
    assert.equal(failure.error, value, 'falsey dispatch failure is not successful task settlement');
    assert.equal(pool.stats().ipcReservedBytes, 0);
    assert.equal(pool.stats().completed, 0);
    assert.equal(pool.stats().failed, 1);
  } finally { await pool.destroy(); }
}
console.log('process budget rejects malformed counts before resource acquisition');
