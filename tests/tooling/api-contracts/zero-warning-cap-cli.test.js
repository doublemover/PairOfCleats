import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';

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
  const artifactDir = path.join(dir, `report-artifact-${cap}`);
  if (selected === 'violation' && cap === 1) await fs.mkdir(artifactDir);
  const result = await spawnSubprocess(process.execPath,
    [path.join(root, 'bin/pairofcleats.js'), 'api-contracts', '--repo', repo,
      '--json', '--failOnWarn', '--maxWarnings', String(cap),
      ...(selected === 'violation' && cap === 1 ? ['--emitArtifact', '--artifactDir', artifactDir] : [])], {
      cwd: root, env, timeoutMs: 5000, maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false
    });
  await fs.writeFile(path.join(dir, `command-cap-${cap}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ selected, cap, exitCode: result.exitCode, stderr: result.stderr, dir }));
  if (selected === 'violation') {
    assert.equal(result.exitCode, 2, 'the real indexed violation must fail at both one and zero detail caps');
    assert.equal(result.stderr.trim(), 'API contracts warnings detected.');
    const report = JSON.parse(result.stdout);
    assert.equal(validateApiContracts(report).ok, true, 'policy failure emits one complete parseable report');
    if (cap === 1) {
      const warning = report.warnings.find(entry => entry.code === 'ARITY_MISMATCH');
      assert.ok(warning, 'retained mismatch survives policy failure output');
      const symbol = report.symbols.find(entry => entry.symbol.symbolId === warning.data.symbolId);
      const call = symbol.observedCalls.find(entry => entry.callSiteId === warning.data.callSiteId);
      assert.equal(call.file, 'input.js'); assert.equal(call.startLine, 2);
      assert.ok(Number.isInteger(call.startCol) && call.startCol >= 0);
      assert.equal(call.join.indexSignature, report.provenance.indexSignature);
      const artifact = (await fs.readFile(path.join(artifactDir, 'api_contracts.jsonl'), 'utf8')).trim().split('\n').map(row => JSON.parse(row));
      assert.deepEqual(artifact, report.symbols, 'explicit artifact emission also completes on policy failure');
    } else {
      assert.equal(report.warnings, null);
      const counts = report.truncation.find(entry => entry.cap === 'maxWarnings');
      assert.equal(counts.observed, 1); assert.equal(counts.omitted, 1);
    }
  } else {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.ok(report.symbols.length >= 2, 'the real index supplies both declarations');
    assert.ok(report.symbols.some(entry => entry.observedCalls.length > 0), 'the real call is inspected');
    assert.equal(report.warnings, null); assert.equal(report.truncation, null);
  }
}
if (selected === 'violation') {
  const occupied = path.join(dir, 'artifact-parent-file'); await fs.writeFile(occupied, 'owned fixture file');
  const result = await spawnSubprocess(process.execPath,
    [path.join(root, 'bin/pairofcleats.js'), 'api-contracts', '--repo', repo, '--json', '--failOnWarn',
      '--emitArtifact', '--artifactDir', occupied],
    { cwd: root, env, timeoutMs: 5000, maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false });
  assert.equal(result.exitCode, 1, 'a real artifact-write error remains an ordinary failure');
  assert.equal(result.stdout, '', 'artifact-write failure cannot emit a completed analyzed policy report');
  assert.ok(result.stderr.trim() && result.stderr.trim() !== 'API contracts warnings detected.');
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
