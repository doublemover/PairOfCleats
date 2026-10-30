import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';

await requireBootstrap(); applyTestEnv();
const [destination, language = 'all'] = process.argv.slice(2);
assert.ok(destination); assert.ok(['all', 'scala', 'css', 'lua'].includes(language));
const output = path.resolve(destination); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
const observations = [], languages = language === 'all' ? ['scala', 'css', 'lua'] : [language];
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const selected of repetition % 2 ? languages : languages.toReversed()) {
    const name = selected + '-' + repetition, directory = path.join(output, name);
    const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/native-traversal-comparison.js', selected, directory],
      receiptPath: path.join(output, name + '-invocation.json') });
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    const bytes = await fs.readFile(path.join(directory, 'receipt.json')), receipt = JSON.parse(bytes);
    assert.equal(receipt.status, 'passed'); assert.equal(receipt.language, selected); assert.deepEqual(receipt.source, source);
    assert.ok(receipt.elapsedMs < 30000); assert.equal(receipt.owner.interceptions, 1);
    assert.equal(receipt.owner.original.commit, '24230d7960127ab7e4a01f2c040bf3d859f6b46b');
    assert.equal(receipt.observations.length, 4);
    for (const shape of receipt.observations) {
      assert.equal(shape.equivalentCompleteEvidence, true); assert.equal(shape.parseSamples.length, 16);
      for (const arm of ['original', 'current']) {
        assert.equal(shape.clean[arm].length, 16); assert.equal(shape.allocations[arm].iterations, 1);
        const profile = await fs.readFile(shape.allocations[arm].path);
        assert.equal(profile.length, shape.allocations[arm].bytes);
        assert.equal(createHash('sha256').update(profile).digest('hex'), shape.allocations[arm].sha256);
      }
    }
    const previous = observations.find(row => row.language === selected);
    if (previous) { assert.deepEqual(receipt.inputs, previous.receipt.inputs); assert.deepEqual(receipt.grammar, previous.receipt.grammar); }
    observations.push({ repetition, language: selected, capsuleMs: result.durationMs,
      receiptPath: path.join(directory, 'receipt.json'), receiptSha256: createHash('sha256').update(bytes).digest('hex'), receipt });
    console.log(JSON.stringify({ name, capsuleMs: result.durationMs }));
  }
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, issue: 1484, status: 'passed', historicalAuthorWorkspace: true,
  source, language, repetitions: 3, observations,
  scope: 'Three fresh bounded30second children per selected language, paired exact historic/current gather algorithms with current semantic callbacks and independently expected complete evidence.',
  limits: 'Separate algorithm comparator;existing18 current entrypoint/publication observations retained. No historical whole-adapter or universal cursor speedup claim;current algorithm is a pre-expansion-admission stack.' }, { createOnly: true });
