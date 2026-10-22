import assert from 'node:assert/strict';
import { runEmbeddingsTool } from '../../../src/integrations/core/embeddings.js';

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
await assert.rejects(runEmbeddingsTool(['-e', `process.stderr.write('partial');process.exitCode=9;`],
  { onLine: () => { throw new Error('flush callback failed'); } }), error => {
  assert.equal(error.result.exitCode, 9);
  assert.match(error.message, /code 9/);
  assert.match(error.cleanupErrors[0].message, /flush callback failed/);
  return true;
});
console.log('Embedding subprocess forwarding preserves bounded stream-local lines and primary failure.');
