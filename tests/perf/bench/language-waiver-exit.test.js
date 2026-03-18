#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { evaluateBenchVerdict, loadBenchPolicy } from '../../../tools/bench/language/verdict.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-waiver-exit');
const reposRoot = path.join(tempRoot, 'repos');
const cacheRoot = path.join(tempRoot, 'cache');
const resultsRoot = path.join(tempRoot, 'results');
const configPath = path.join(tempRoot, 'repos.json');
const queriesPath = path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt');
const waiverPath = path.join(tempRoot, 'waivers.json');
const repoId = 'test/waiver-exit';
const repoPath = path.join(reposRoot, 'javascript', repoId.replace('/', '__'));

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoPath, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoPath, 'README.md'), 'bench waiver exit test');

const config = {
  javascript: {
    label: 'JavaScript',
    queries: queriesPath,
    repos: {
      small: [repoId]
    }
  }
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));
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

const scriptPath = path.join(root, 'tools', 'bench', 'language-repos.js');
const baseArgs = [
  scriptPath,
  '--config',
  configPath,
  '--root',
  reposRoot,
  '--cache-root',
  cacheRoot,
  '--results',
  resultsRoot,
  '--no-clone',
  '--build-index',
  '--backend',
  'sqlite',
  '--json'
];

const failedRun = spawnSync(process.execPath, baseArgs, {
  encoding: 'utf8',
  timeout: 30000
});
if (!failedRun.stdout) {
  console.error(failedRun.stderr || 'expected bench-language JSON output on unwaived failure');
  process.exit(1);
}
if ((failedRun.status ?? 0) === 0) {
  console.error('expected unwaived benchmark failure to exit non-zero');
  process.exit(1);
}
const failedPayload = JSON.parse(failedRun.stdout);
if (failedPayload.run.aggregateResultClass !== 'repo_failed') {
  console.error(`expected repo_failed aggregate verdict, got ${failedPayload.run.aggregateResultClass}`);
  process.exit(1);
}
if ((failedPayload.run.issues.unwaivedCount || 0) !== 1) {
  console.error(`expected exactly one unwaived issue, got ${failedPayload.run.issues.unwaivedCount}`);
  process.exit(1);
}

const policy = await loadBenchPolicy({ waiverFile: waiverPath });
const waivedVerdict = evaluateBenchVerdict({
  tasks: failedPayload.tasks,
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
