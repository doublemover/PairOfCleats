import assert from 'node:assert/strict';
import { runNode as runNodeFixture } from '../helpers/run-node.js';
import { splitUnicodeChunks } from '../../src/shared/unicode-chunks.js';
for (const text of ['', 'ASCII', '界'.repeat(12), 'x😀𐐷é"\\y'.repeat(50)]) {
  for (const size of [2, 3, 4, 17]) {
    const chunks = splitUnicodeChunks(text, size);
    assert.equal(chunks.join(''), text);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= size);
      assert.equal(chunk.isWellFormed(), true);
    }
  }
}
const producer = runNodeFixture(['tests/helpers/tui/unicode-frames.js'], 'isolated Node fixture', process.cwd(), process.env, { allowFailure: true, stdio: 'pipe', spawnOptions: {
  cwd: process.cwd(), encoding: 'utf8', timeout: 8000, maxBuffer: 8 * 1024 * 1024
} });
assert.equal(producer.status, 0, producer.stderr || producer.error?.message);
const expected = new Map(), chunks = new Map();
for (const line of producer.stdout.trim().split('\n')) {
  const frame = JSON.parse(line);
  if (frame.event === 'fixture:expected') expected.set(frame.jobId, frame.value);
  else {
    assert.equal(frame.event, 'event:chunk');
    assert.equal(frame.chunk.isWellFormed(), true, 'every individual wire JSON string is scalar-valid');
    if (!chunks.has(frame.jobId)) chunks.set(frame.jobId, []);
    chunks.get(frame.jobId)[frame.chunkIndex] = frame.chunk;
  }
}
for (const [jobId, pieces] of chunks) {
  const result = JSON.parse(pieces.join(''));
  assert.equal(result.event, 'job:end');
  assert.deepEqual(Buffer.from(result.result.value), Buffer.from(expected.get(jobId)));
}
assert.equal(chunks.size, expected.size);
console.log('Unicode scalar-safe producer frames preserve exact terminal result content; Rust consumer has separate coverage');
