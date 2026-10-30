import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// <manifest> <fresh-output> truncation|stage2|stage3|query-cache|generation
// Stage3/query-cache take a prior real seed receipt as argument5;query-cache
// additionally takes its raw judged-query reference as argument6.
await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2] && process.argv[3] && process.argv[4]);
const manifest = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]), selection = process.argv[4];
assert.ok(['truncation', 'stage2', 'stage3', 'query-cache', 'generation'].includes(selection));
const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision'); await fs.mkdir(output);
const observations = [];
const run = async (name, script, args) => {
  const destination = path.join(output, name);
  const actual = await runQualificationCapsule({ args: [script, '--manifest', manifest, '--out', destination, ...args],
    receiptPath: path.join(output, name + '-invocation.json') });
  const receipt = JSON.parse(await fs.readFile(path.join(destination, 'receipt.json'), 'utf8'));
  assert.ok(['passed', 'numerical-reference'].includes(receipt.status)); assert.ok(receipt.elapsedMs < 30000);
  assert.deepEqual(receipt.source, source); assert.equal(receipt.modelArtifact.status, 'verified');
  assert.equal(actual.stderr.replace(/\r\n/g, '\n').trim(), receipt.expectedWarning || '');
  observations.push({ name, capsuleMs: actual.durationMs, receipt });
  console.log(JSON.stringify({ name, capsuleMs: actual.durationMs }));
  return path.join(destination, 'receipt.json');
};
if (selection === 'truncation') {
  for (const kind of ['documents', 'queries']) {
    const reference = await run('raw-' + kind, 'tests/embeddings/actual-export-qualification.js',
      ['--route', 'upstream-reference', '--cohort', 'truncation-' + kind]);
    await run('product-' + kind, 'tests/embeddings/actual-export-qualification.js',
      ['--route', kind === 'documents' ? 'batch' : 'query', '--cohort', 'truncation-' + kind, '--numerical-reference', reference]);
  }
} else {
  const worker = 'tests/embeddings/e5-generation-qualification.js';
  if (selection === 'generation') {
    assert.ok(process.argv[5], 'An independently completed raw judged-query receipt is required.');
    const stage2 = await run('stage2', worker, ['--operation', 'stage2']);
    const stage3 = await run('stage3', worker, ['--operation', 'stage3', '--seed', stage2]);
    await run('query-cache', worker, ['--operation', 'query-cache', '--seed', stage3, '--numerical-reference', path.resolve(process.argv[5])]);
  } else await run(selection, worker, ['--operation', selection,
    ...(selection === 'stage2' ? [] : (assert.ok(process.argv[5]), ['--seed', path.resolve(process.argv[5])])),
    ...(selection === 'query-cache' ? (assert.ok(process.argv[6]), ['--numerical-reference', path.resolve(process.argv[6])]) : [])]);
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, historicalAuthorWorkspace: true, issue: 1542,
  source, selection, observations, scope: 'Original E5 tokenizer/model,one-file Stage2,source-pinned Stage3 and process query-vector-result cache;eachchild30seconds;zero retries.',
  limits: ['Query-vector cache observations do not measure ranked-search-result caches.', 'Stage3 cache-only observations remain labeled cache-only.',
    'No representative retrieval/performance improvement or general truncation-normalizer equivalence claim.'] }, { createOnly: true });
