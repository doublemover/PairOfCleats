import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { createQueryWorkInput, queryWorkOptions, loadQueryWorkArm, writeQueryWork, readQueryWork } from '../../helpers/semantic-query-work.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const [, kind, scenario] = selected?.match(/^(query|operation)-(memory|merged|reuse|mutation|duplicate|unordered|oversize)$/) || [];
assert.ok(kind && scenario);
const { dir } = await prepareIsolatedTestCacheDir('query-encoded-batch');
try {
  const input = createQueryWorkInput(kind);
  if (scenario === 'memory' || scenario === 'merged') {
    const actual = await writeQueryWork(writeSemanticQueryIndex, path.join(dir, 'actual'), input, scenario);
    const control = await writeQueryWork(await loadQueryWorkArm('reencoded'), path.join(dir, 'control'), input, scenario);
    assert.deepEqual(actual.projection, control.projection);
    assert.equal(actual.diskBytes, control.diskBytes);
    assert.equal(actual.diskHighWater, control.diskHighWater);
  } else {
    const expected = structuredClone(input.entries.slice(0, 3));
    const account = createSemanticDiskAccount(1024 * 1024);
    const reused = structuredClone(expected[0]);
    const orderedEntries = scenario === 'reuse' ? (async function* () {
      for (const entry of expected) {
        for (const key of Object.keys(reused)) delete reused[key]; Object.assign(reused, structuredClone(entry));
        yield reused;
      }
      if (kind === 'query') reused.owner.localId = 999; else reused.value = 'last mutated after yield';
    })() : scenario === 'duplicate' ? [expected[0], expected[0]]
      : scenario === 'unordered' ? [expected[1], expected[0]] : structuredClone(expected);
    let mutated = false;
    const options = queryWorkOptions(input, { root: dir, diskAccount: account, orderedEntries,
      batchRows: scenario === 'mutation' ? 1 : 64, batchBytes: scenario === 'oversize' ? 1 : 65536,
      scheduleIo: async run => {
        if (scenario === 'mutation' && !mutated) {
          mutated = true;
          if (kind === 'query') orderedEntries[0].owner.localId = 999; else orderedEntries[0].value = 'mutated during flush';
        }
        return run();
      } });
    if (scenario === 'duplicate' || scenario === 'unordered' || scenario === 'oversize') {
      await assert.rejects(writeSemanticQueryIndex(options), scenario === 'oversize' ? /Query index row exceeds allowance/ : /Duplicate or unordered query index row/);
      assert.equal(account.used, 0); assert.deepEqual(await fs.readdir(dir), []);
    } else {
      const index = await writeSemanticQueryIndex(options), actual = await readQueryWork(dir, index);
      assert.deepEqual(actual.rows, expected);
      assert.deepEqual(index.pieces[0].firstKey, expected[0]);
      assert.deepEqual(index.pieces.at(-1).lastKey, expected.at(-1));
      assert.equal(actual.rows.map(row => canonicalSemanticJson(row) + '\n').join(''), expected.map(row => canonicalSemanticJson(row) + '\n').join(''));
      assert.equal(account.used, index.pieces.reduce((sum, piece) => sum + piece.bytes + 8 * piece.count, 0));
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`${kind} ${scenario} retains exact encoded batches, keys, order and credits`);
