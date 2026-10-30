import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv({ testing: '1' });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/tree-sitter/parser-session-native-consumer/')[1];
if (selected === 'tree-worker') {
  const { getTreeSitterWorkerPool: get, shutdownTreeSitterWorkerPool: shutdown } = await import('../../../src/lang/tree-sitter/worker.js');
  const payload = { text: 'export function sentinel(value) { return value + 1; }', languageId: 'javascript', ext: '.js', treeSitter: { enabled: true, strict: true } };
  const config = { enabled: true, maxWorkers: 1, maxQueue: 4 };
  try {
    const [a, b] = await Promise.all([get(config), get(config)]); assert.ok(a); assert.equal(a, b);
    const chunks = await a.run(payload, { name: 'parseTreeSitter' });
    assert.ok(chunks.some(chunk => chunk.name?.includes('sentinel')));
    await shutdown(); assert.equal(a.threads.length, 0);
    await assert.rejects(a.run(payload, { name: 'parseTreeSitter' }), { code: 'ERR_TREE_SITTER_WORKER_RETIRED' });
    assert.equal(a.threads.length, 0, 'the stale public view cannot resurrect workers after acknowledged shutdown');
    const next = await get(config); assert.ok(next); assert.notEqual(next, a);
    assert.ok((await next.run(payload, { name: 'parseTreeSitter' })).length);
  } finally { await shutdown(); }
} else {
  assert.equal(selected, 'python');
  const { getPythonAstPool: get, shutdownPythonAstPool: shutdown } = await import('../../../src/lang/python/pool.js');
  try {
    const config = { workerCount: 1, maxWorkers: 1, maxRetries: 0 }, args = { dataflow: false, controlFlow: false, path: null };
    const pool = await get(null, config); assert.ok(pool, 'prepared actual Python interpreter is required');
    const result = await pool.request('def sentinel(value):\n    return value + 1\n', args);
    assert.ok(result.defs.some(def => def.name === 'sentinel'));
    await shutdown(); assert.equal(await pool.request('def late(): pass', args), null);
    const next = await get(null, config); assert.ok(next); assert.notEqual(next, pool);
    assert.ok((await next.request('def second(): pass\n', args)).defs.some(def => def.name === 'second'));
  } finally { await shutdown(); }
}
console.log('Actual one-worker parser lifecycle consumer: ' + selected);
