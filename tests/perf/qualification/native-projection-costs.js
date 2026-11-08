import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
const [destination, language = 'all', cohort = 'all'] = process.argv.slice(2);
assert.ok(destination, 'A fresh output directory is required;optional selectors: language then cohort.');
assert.ok(['all', 'scala', 'css', 'lua'].includes(language));
assert.ok(['all', 'projection', 'publication'].includes(cohort));
const output = path.resolve(destination); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()), observations = [];
assert.equal(source.state, 'clean-revision');
for (let repetition = 1; repetition <= 3; repetition++) {
  const languages = language === 'all' ? ['scala', 'css', 'lua'] : [language];
  for (const selected of repetition % 2 ? languages : languages.toReversed()) {
    for (const phase of cohort === 'all' ? ['projection', 'publication'] : [cohort]) {
      const name = selected + '-' + phase + '-' + repetition;
      const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/native-projection-costs.js', selected, phase, path.join(output, name)],
        receiptPath: path.join(output, name + '-invocation.json') });
      assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
      const receipt = JSON.parse(await fs.readFile(path.join(output, name, 'receipt.json'), 'utf8'));
      assert.equal(receipt.status, 'passed'); assert.equal(receipt.report.language, selected); assert.equal(receipt.report.cohort, phase);
      const previous = observations.find(row => row.language === selected && row.cohort === phase);
      if (previous) assert.deepEqual(receipt.report.inputs, previous.receipt.report.inputs, 'each repetition preserves the full source corpus');
      observations.push({ repetition, language: selected, cohort: phase, capsuleMs: result.durationMs, receipt });
      console.log(JSON.stringify({ name, capsuleMs: result.durationMs }));
    }
  }
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, issue: 1484, historicalAuthorWorkspace: true,
  source, language, cohort, repetitions: 3, observations,
  scope: 'serial fresh children bounded30seconds each;three repetitions of each selected language/cohort;separate clean/work/allocation passes',
  limits: 'source fixture corpus and canonical publication consumers;no historical speedup/full-index/native-peak claim;CSS/Lua reparse explicitly;gzip positioned pages explicitly unavailable' }, { createOnly: true });
