import assert from 'node:assert/strict';
import { runEmbeddingsTool } from '../../../src/integrations/core/embeddings.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const lines = [];
await runEmbeddingsTool(['-e', `process.stdout.write('progress-prefix');process.stderr.write('fatal-error\\n');process.stdout.write(' tail\\rnext\\r\\n');process.stderr.write('partial-error');`],
  { onLine: (line, meta) => lines.push({ line, ...meta }) });
assert.deepEqual(lines.filter(row => row.stream === 'stdout').map(row => row.line), ['progress-prefix tail', 'next']);
assert.deepEqual(lines.filter(row => row.stream === 'stderr').map(row => row.line), ['fatal-error', 'partial-error']);
const overflow = [];
await runEmbeddingsTool(['-e', `process.stdout.write('x'.repeat(2*1024*1024));process.stdout.write(' {"event":"log"}\\n');`],
  { maxLineBytes: 64, onLine: (line, meta) => overflow.push({ line, ...meta }) });
assert.equal(overflow.length, 1);
assert.ok(overflow[0].retainedBytes <= 64);
assert.equal(overflow[0].truncated, true);
assert.equal(overflow[0].event, null);
assert.ok(overflow[0].overflowBytes > 1024 * 1024);
const framed = [];
await runEmbeddingsTool(['-e', `const text=Buffer.from(${JSON.stringify('first🙂\r\nsecond\r\rthird\nlast🙂')});
  let offset=0;const next=()=>{if(offset<text.length){process.stdout.write(text.subarray(offset,++offset));setImmediate(next);}};next();
  process.stderr.write('error🙂\\r');setImmediate(()=>process.stderr.write('\\nerror-final'));`],
{ onLine: (line, meta) => framed.push({ line, ...meta }) });
assert.deepEqual(framed.filter(row => row.stream === 'stdout').map(row => row.line), ['first🙂', 'second', 'third', 'last🙂']);
assert.deepEqual(framed.filter(row => row.stream === 'stderr').map(row => row.line), ['error🙂', 'error-final']);
assert.ok(framed.every(row => !row.line.includes('\ufffd')));
const callbackFailure = new Error('original callback failure');
await assert.rejects(runEmbeddingsTool(['-e', `process.stdout.write('ordinary\\nfinal');`],
  { onLine: () => { throw callbackFailure; } }), error => {
  assert.ok(errorGraphIncludes(error, callbackFailure), 'live callback failure preserves its original owner while the child is terminated');
  assert.ok(error.result); return true;
});
await assert.rejects(runEmbeddingsTool(['-e', `process.stdout.write('final-only');`],
  { onLine: () => { throw callbackFailure; } }), error => {
  assert.equal(error.result.exitCode, 0); assert.ok(error.errors.every(failure => failure === callbackFailure));
  return true;
});
const controller = new AbortController(), cancelled = [];
await assert.rejects(runEmbeddingsTool(['-e', `process.stdout.write('before-cancel\\n');setInterval(()=>{},1000);`],
  { signal: controller.signal, onLine: (line, meta) => {
    cancelled.push({ line, ...meta }); controller.abort(new Error('explicit caller cancellation'));
  } }), error => {
  assert.equal(error.name, 'AbortError'); return true;
});
assert.deepEqual(cancelled.map(row => row.line), ['before-cancel']);
await assert.rejects(runEmbeddingsTool(['-e', `process.stdout.write('separate raw stdout');process.stderr.write('partial');process.exitCode=9;`],
  { onLine: () => { throw new Error('flush callback failed'); } }), error => {
  assert.equal(error.result.exitCode, 9);
  assert.match(error.message, /code 9/);
  assert.match(error.cleanupErrors[0].message, /flush callback failed/);
  assert.equal(error.result.stdout, 'separate raw stdout'); assert.equal(error.result.stderr, 'partial');
  return true;
});
console.log('Embedding subprocess forwarding preserves bounded stream-local lines and primary failure.');
