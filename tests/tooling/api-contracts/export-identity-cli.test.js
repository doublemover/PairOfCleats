import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/api-contracts/export-identity-cli/')[1];
assert.ok(['js-report', 'ts-report', 'js-fail', 'ts-fail'].includes(selected));
const [language, operation] = selected.split('-');
const type = language === 'ts' ? ': number' : '';
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`api-export-identity-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, `api.${language}`), `
export function inlineApi(a${type}, b${type}) { return a+b; }
export default function defaultApi(a${type}, b${type}) { return a+b; }
function listedApi(a${type}, b${type}) { return a+b; }
function aliasApi(a${type}, b${type}) { return a+b; }
const arrowApi = (a${type}, b${type}) => a+b;
function internalApi(a${type}, b${type}) { return a+b; }
export { listedApi, aliasApi as renamedApi, arrowApi as arrowAlias };
function run() {
  inlineApi(1); defaultApi(1); listedApi(1); aliasApi(1); arrowApi(1); internalApi(1);
}
`);
await fs.writeFile(path.join(repo, `anonymous.${language}`), `export default function(a${type}, b${type}) { return a+b; }`);
await fs.writeFile(path.join(repo, `arrow-default.${language}`), `export default (a${type}, b${type}) => a+b;`);
await fs.writeFile(path.join(repo, `class-default.${language}`), 'export default class { method() {} }');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, indexing: { semantic: { enabled: true }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const signal = AbortSignal.timeout(10000);
await buildIndex(repo, { mode: 'code', stage: 'stage2', 'stub-embeddings': true,
  'scm-provider': 'none', threads: 1, abortSignal: signal });
signal.throwIfAborted();
const args = [path.join(root, 'bin/pairofcleats.js'), 'api-contracts', '--repo', repo, '--json', '--onlyExports'];
if (operation === 'fail') args.push('--failOnWarn', '--maxWarnings', '0');
const result = await spawnSubprocess(process.execPath, args, { cwd: root, env, timeoutMs: 5000,
  maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false });
await fs.writeFile(path.join(dir, 'command.json'), JSON.stringify({ args, ...result }, null, 2));
console.log(JSON.stringify({ selected, exitCode: result.exitCode, stderr: result.stderr, dir }));
if (operation === 'fail') {
  assert.equal(result.exitCode, 2, 'bad exported calls must fail even with zero retained warning details');
  assert.equal(result.stderr.trim(), 'API contracts warnings detected.');
} else {
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  const expected = ['aliasApi', 'arrowApi', 'default', 'default', 'default', 'defaultApi', 'inlineApi', 'listedApi'];
  assert.deepEqual(report.symbols.map(entry => entry.symbol.name).sort(), expected,
    'inline/default/listed/aliased APIs must survive; internal declarations must be excluded');
  assert.equal(report.warnings.length, 5);
  for (const entry of report.symbols) {
    if (entry.symbol.name === 'default') {
      assert.equal(entry.observedCalls.length, 0); assert.equal(entry.warnings, null);
      continue;
    }
    assert.equal(entry.observedCalls.length, 1, 'every exported API has a real resolved call');
    assert.equal(entry.warnings.length, 1);
    assert.equal(entry.warnings[0].code, 'ARITY_MISMATCH');
  }
  const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
  const rows = [];
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'symbols', { strict: true })) rows.push(row);
  assert.equal(validateArtifact('symbols', rows).ok, true);
  assert.equal(validateArtifact('symbols', [{ ...rows[0], exported: 'true' }]).ok, false);
  assert.equal(validateArtifact('symbols', [{ ...rows[0], exportNames: ['duplicate', 'duplicate'] }]).ok, false);
  for (const [name, exports] of [['inlineApi', ['inlineApi']], ['defaultApi', ['default']],
    ['listedApi', ['listedApi']], ['aliasApi', ['renamedApi']], ['arrowApi', ['arrowAlias']],
    ['internalApi', []], ['run', []]]) {
    const row = rows.find(entry => entry.name === name); assert.ok(row, `${name}: actual symbol artifact`);
    assert.equal(row.exported, exports.length > 0); assert.deepEqual(row.exportNames, exports);
  }
  for (const stem of ['anonymous', 'arrow-default', 'class-default']) {
    const row = rows.find(entry => entry.file === `${stem}.${language}` && entry.name === 'default');
    assert.ok(row); assert.equal(row.exported, true); assert.deepEqual(row.exportNames, ['default']);
  }
}
