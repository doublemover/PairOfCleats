import assert from 'node:assert/strict';
import { prepareSearchOutput, renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { createSearchOutputOptions } from '../helpers/search-output-fixture.js';
import { color } from '../../../src/retrieval/cli/ansi.js';

const writes = [], write = process.stdout.write;
process.stdout.write = value => { writes.push(String(value)); return true; };
try {
  const prepared = prepareSearchOutput(createSearchOutputOptions({ emitOutput: true, jsonOutput: true, explain: false }));
  assert.deepEqual(writes, [], 'preparation cannot publish before asynchronous cleanup');
  assert.equal(prepared.payload.backend, 'memory');
  prepared.emit(); assert.ok(writes.length > 0);
  const first = writes.join(''); assert.deepEqual(JSON.parse(first), prepared.payload);
  assert.throws(() => prepared.emit(), { code: 'ERR_SEARCH_OUTPUT_REPLAY' });
  assert.equal(writes.join(''), first);
  writes.length = 0;
  const synchronous = renderSearchOutput(createSearchOutputOptions({ emitOutput: true, jsonOutput: true, explain: false }));
  assert.deepEqual(JSON.parse(writes.join('')), synchronous);
  assert.deepEqual(synchronous, prepared.payload);
  writes.length = 0;
  let live = true, reads = 0;
  const index = { get chunkMeta() { assert.equal(live, true, 'emission cannot reopen a closed index'); reads++; return { length: 7 }; } };
  const human = prepareSearchOutput(createSearchOutputOptions({ emitOutput: true, jsonOutput: false, showStats: true,
    idxCode: index, color }));
  assert.ok(reads > 0); const before = reads; live = false;
  human.emit(); assert.equal(reads, before);
  assert.match(writes.join(''), /code chunks=7/);
} finally { process.stdout.write = write; }
console.log('Prepared search output waits for publication and retains synchronous JSON/human behavior after backend close');
