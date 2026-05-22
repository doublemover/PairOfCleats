#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { evaluateBenchVerdict, loadBenchPolicy } from '../../../tools/bench/language/verdict.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('bench-language-waiver-exit');
const waiverPath = path.join(tempRoot, 'waivers.json');
const repoId = 'test/waiver-exit';

await fsPromises.writeFile(
  waiverPath,
  JSON.stringify({
    schemaVersion: 1,
    policyVersion: 'bench-language-policy-v1',
    waivers: [
      {
        id: 'waive-benchmark-failure',
        owner: 'bench-owner',
        justification: 'intentional harness fixture failure for waiver coverage',
        allowedUntil: '2099-01-01T00:00:00.000Z',
        resultClass: 'repo_failed',
        failureClass: 'benchmark_failed',
        repo: repoId
      }
    ]
  }, null, 2)
);

const failedVerdict = evaluateBenchVerdict({
  tasks: [
    {
      repo: repoId,
      language: 'javascript',
      tier: 'small',
      failed: true,
      failureReason: 'bench'
    }
  ],
  policy: await loadBenchPolicy()
});
if (failedVerdict.run.aggregateResultClass !== 'repo_failed') {
  console.error(`expected repo_failed aggregate verdict, got ${failedVerdict.run.aggregateResultClass}`);
  process.exit(1);
}
if ((failedVerdict.run.issues.unwaivedCount || 0) !== 1) {
  console.error(`expected exactly one unwaived issue, got ${failedVerdict.run.issues.unwaivedCount}`);
  process.exit(1);
}

const policy = await loadBenchPolicy({ waiverFile: waiverPath });
const waivedVerdict = evaluateBenchVerdict({
  tasks: failedVerdict.tasks,
  policy
});
if (waivedVerdict.run.aggregateResultClass !== 'passed_with_degradation') {
  console.error(`expected passed_with_degradation verdict, got ${waivedVerdict.run.aggregateResultClass}`);
  process.exit(1);
}
if ((waivedVerdict.run.issues.waivedCount || 0) !== 1) {
  console.error(`expected exactly one waived issue, got ${waivedVerdict.run.issues.waivedCount}`);
  process.exit(1);
}
if (waivedVerdict.run.exitCode !== 0) {
  console.error(`expected waived verdict exit code 0, got ${waivedVerdict.run.exitCode}`);
  process.exit(1);
}
if (!Array.isArray(waivedVerdict.run.policy.matchedWaiverIds) || !waivedVerdict.run.policy.matchedWaiverIds.includes('waive-benchmark-failure')) {
  console.error('expected waiver match recorded in run policy summary');
  process.exit(1);
}

console.log('bench language waiver exit test passed');
