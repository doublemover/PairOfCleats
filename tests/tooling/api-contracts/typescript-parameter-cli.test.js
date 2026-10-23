import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/api-contracts/typescript-parameter-cli/')[1];
assert.ok(['policy', 'clean'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`typescript-parameter-cli-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, 'input.ts'), `export function required(callback: () => void) {}
export function optional(callback?: () => void) {}
export function defaulted(callback: () => void = () => {}) {}
export function receiver(this: void, value: number) {}
export function onlyThis(this: void) {}
required(() => {}); optional(); defaulted(); receiver(1); onlyThis();
${selected === 'policy' ? 'required(); receiver();' : ''}
`);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, indexing: { semantic: { enabled: true }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } }, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const signal = AbortSignal.timeout(10000);
await buildIndex(repo, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none', threads: 1, abortSignal: signal });
signal.throwIfAborted();
const result = await spawnSubprocess(process.execPath, [path.join(process.cwd(), 'bin/pairofcleats.js'),
  'api-contracts', '--repo', repo, '--json', '--onlyExports', '--failOnWarn'],
{ cwd: process.cwd(), env, timeoutMs: 5000, maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false });
assert.equal(result.exitCode, selected === 'policy' ? 2 : 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.equal(validateApiContracts(report).ok, true);
assert.equal(report.version, '1.1.0');
assert.equal(report.callEvidence.qualifiedCallCount, selected === 'policy' ? 7 : 5);
if (selected === 'policy') {
  assert.equal(report.warnings.length, 2);
  assert.ok(report.warnings.every(warning => warning.code === 'ARITY_MISMATCH'));
  assert.deepEqual(report.warnings.map(warning => report.symbols.find(entry => entry.symbol.symbolId === warning.data.symbolId).symbol.name).sort(),
    ['receiver', 'required']);
} else { assert.equal(report.warnings, null); assert.equal(result.stderr, ''); }
for (const name of ['required', 'optional', 'defaulted', 'receiver', 'onlyThis']) {
  const entry = report.symbols.find(entry => entry.symbol.name === name);
  assert.ok(entry.observedCalls.length > 0);
  assert.equal(entry.signature.parameters.arity.state, 'complete', name);
}
console.log('actual-index TypeScript callable parameter CLI test passed');
