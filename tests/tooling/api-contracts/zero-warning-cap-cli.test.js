import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/api-contracts/zero-warning-cap-cli/')[1];
assert.ok(['violation', 'clean', 'markdown'].includes(selected));
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`api-zero-warning-cap-${selected}`);
const repo = path.join(dir, 'repo');
await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, 'input.js'), `function doThing(a,b) { return a+b; }
export function run() { return doThing(${selected === 'clean' ? '1,2' : '1'}); }
`);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, indexing: { semantic: { enabled: true }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const signal = AbortSignal.timeout(10000);
await buildIndex(repo, { mode: 'code', stage: 'stage2', 'stub-embeddings': true,
  'scm-provider': 'none', threads: 1, abortSignal: signal });
signal.throwIfAborted();
for (const cap of selected === 'violation' ? [1, 0] : selected === 'clean' ? [0] : []) {
  const result = await spawnSubprocess(process.execPath,
    [path.join(root, 'bin/pairofcleats.js'), 'api-contracts', '--repo', repo,
      '--json', '--failOnWarn', '--maxWarnings', String(cap)], {
      cwd: root, env, timeoutMs: 5000, maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false
    });
  await fs.writeFile(path.join(dir, `command-cap-${cap}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ selected, cap, exitCode: result.exitCode, stderr: result.stderr, dir }));
  if (selected === 'violation') {
    assert.equal(result.exitCode, 2, 'the real indexed violation must fail at both one and zero detail caps');
    assert.equal(result.stderr.trim(), 'API contracts warnings detected.');
  } else {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.ok(report.symbols.length >= 2, 'the real index supplies both declarations');
    assert.ok(report.symbols.some(entry => entry.observedCalls.length > 0), 'the real call is inspected');
    assert.equal(report.warnings, null); assert.equal(report.truncation, null);
  }
}
if (selected === 'markdown') {
  const result = await spawnSubprocess(process.execPath,
    [path.join(root, 'bin/pairofcleats.js'), 'api-contracts', '--repo', repo,
      '--format', 'md', '--maxWarnings', '0'], {
      cwd: root, env, timeoutMs: 5000, maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false
    });
  await fs.writeFile(path.join(dir, 'command-markdown-cap-0.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ selected, exitCode: result.exitCode, stderr: result.stderr, dir }));
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, '');
  assert.match(result.stdout, /doThing/); assert.match(result.stdout, /run/);
  assert.match(result.stdout, /Warnings detected: 1; details retained: 0; omitted: 1/,
    'human-readable reports must expose the known violation even without retained details');
}
