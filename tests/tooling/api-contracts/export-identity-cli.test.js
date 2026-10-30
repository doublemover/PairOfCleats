import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/api-contracts/export-identity-cli/')[1];
const cases = ['js-report', 'ts-report', 'js-fail', 'ts-fail',
  'js-default-anonymous', 'js-default-arrow', 'js-default-class',
  'ts-default-anonymous', 'ts-default-arrow', 'ts-default-class'];
assert.ok(cases.includes(selected));
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./export-identity-cli.test.js.cases.json', import.meta.url))), { schemaVersion: 1, cases });
const [language, operation, defaultKind] = selected.split('-');
const type = language === 'ts' ? ': number' : '';
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`api-export-identity-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); initGitRepo(repo);
if (operation !== 'default') await fs.writeFile(path.join(repo, `api.${language}`), `
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
const defaultSources = {
  anonymous: { stem: 'anonymous', text: `export default function(a${type}, b${type}) { return a+b; }` },
  arrow: { stem: 'arrow-default', text: `export default (a${type}, b${type}) => a+b;` },
  class: { stem: 'class-default', text: 'export default class { method() {} }' }
};
if (operation === 'default') {
  const fixture = defaultSources[defaultKind];
  await fs.writeFile(path.join(repo, `${fixture.stem}.${language}`), fixture.text);
}
// The fixture is a closed source project. Parent checkout ambient @types and
// browser/standard libraries are not inputs to these local callable assertions:
// every declaration and call is in this closed project, with intrinsic numbers.
await fs.writeFile(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  types: [], noLib: true, allowJs: language === 'js'
} }));
// Exact API joins need completed compiler bindings. Default manual/deferred
// enrichment deliberately does not establish lexical call-target authority.
// The semantic compiler pass owns bindings independently of legacy cross-file
// type propagation, which is not an input to these API-contract assertions.
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: createFastIndexingTestConfig({ threads: 1, extraIgnore: ['tsconfig.json'], indexing: { semantic: { enabled: true,
    enrichment: { bindings: 'eager', localFlow: 'off', crossFileFlow: 'off' } }, embeddings: { enabled: false },
  workerPool: { enabled: false } } }),
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
  const report = JSON.parse(result.stdout);
  assert.equal(validateApiContracts(report).ok, true, 'export-only policy failures retain the qualified report');
  assert.ok(report.symbols.length > 0);
  const omitted = report.truncation.find(entry => entry.cap === 'maxWarnings');
  assert.equal(omitted.observed, 5); assert.equal(omitted.omitted, 5);
  assert.equal(report.warnings, null);
} else {
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  const expected = operation === 'default' ? ['default'] : ['aliasApi', 'arrowApi', 'defaultApi', 'inlineApi', 'listedApi'];
  assert.deepEqual(report.symbols.map(entry => entry.symbol.name).sort(), expected,
    'inline/default/listed/aliased APIs must survive; internal declarations must be excluded');
  if (operation === 'default') assert.equal(report.warnings, null);
  else assert.equal(report.warnings.length, 5);
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
  for (const [name, exports] of operation === 'default' ? [] : [['inlineApi', ['inlineApi']], ['defaultApi', ['default']],
    ['listedApi', ['listedApi']], ['aliasApi', ['renamedApi']], ['arrowApi', ['arrowAlias']],
    ['internalApi', []], ['run', []]]) {
    const row = rows.find(entry => entry.name === name); assert.ok(row, `${name}: actual symbol artifact`);
    assert.equal(row.exported, exports.length > 0); assert.deepEqual(row.exportNames, exports);
  }
  for (const stem of operation === 'default' ? [defaultSources[defaultKind].stem] : []) {
    const row = rows.find(entry => entry.file === `${stem}.${language}` && entry.name === 'default');
    assert.ok(row); assert.equal(row.exported, true); assert.deepEqual(row.exportNames, ['default']);
  }
  if (selected === 'js-default-anonymous') {
    const manifestPath = path.join(indexDir, 'pieces/manifest.json');
    const original = await fs.readFile(manifestPath, 'utf8'), manifest = JSON.parse(original);
    assert.equal(manifest.pieces.find(piece => piece.name === 'call_sites').count, 0);
    manifest.pieces = manifest.pieces.filter(piece => !['call_sites', 'call_sites_offsets', 'call_sites_meta'].includes(piece.name));
    try {
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
      const missing = await spawnSubprocess(process.execPath, args, { cwd: root, env, timeoutMs: 5000,
        maxOutputBytes: 65536, rejectOnNonZeroExit: false });
      assert.equal(missing.exitCode, 1, 'missing declaration remains unavailable even when the old empty file is present');
      assert.equal(missing.stdout, ''); assert.match(missing.stderr, /Missing manifest entry for call_sites/);
    } finally { await fs.writeFile(manifestPath, original); }
  }
}
