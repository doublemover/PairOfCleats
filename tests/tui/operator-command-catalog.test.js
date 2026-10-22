import assert from 'node:assert/strict';
import { listCommandRegistry } from '../../src/shared/command-registry-query.js';
import { validateConfig } from '../../src/config/validate.js';
import { describeIndexWorkflows, describeWorkflowCoverage, buildIndexWorkflowArgv } from '../../tools/tui/operator/index-catalog.js';
import { assertTuiWorkflowRequest } from '../../src/contracts/validators/tui-workflow.js';
import { SETUP_OPTIONS, TOOLING_DOCTOR_OPTIONS, ARCHITECTURE_CHECK_OPTIONS } from '../../tools/shared/operator-cli-options.js';

const catalog = describeIndexWorkflows();
assert.equal(catalog.some(command => command.supportTier === 'experimental'), false);
const complete = describeIndexWorkflows({ includeExperimental: true });
const coverage = describeWorkflowCoverage();
const registered = listCommandRegistry({ supportTiers: ['stable', 'operator', 'experimental'] });
assert.deepEqual(new Set(coverage.map(row => row.registryId)), new Set(registered.map(row => row.id)),
  'every visible registry command has an explicit adapter or reviewed concrete reason');
for (const row of coverage) {
  assert.ok(['typed-adapter', 'unsupported'].includes(row.disposition));
  if (row.disposition === 'unsupported') assert.ok(row.reason.length > 24);
}
for (const [id, options] of [['setup', SETUP_OPTIONS], ['tooling.doctor', TOOLING_DOCTOR_OPTIONS], ['architecture-check', ARCHITECTURE_CHECK_OPTIONS]]) {
  const command = catalog.find(command => command.id === id);
  for (const field of command.fields) assert.equal(field.schema.type, options[field.name].type);
}
const scope = { kind: 'repo', target: 'C:/selected repository', configRoot: 'C:/selected repository' };
const api = catalog.find(command => command.id === 'service.api');
for (const name of ['host', 'auth-token', 'allow-unauthenticated', 'allowed-repo-roots']) {
  assert.equal(api.fields.some(field => field.name === name), false);
  assert.equal(validateConfig(api.schema, { [name]: name === 'host' ? '0.0.0.0' : true }).ok, false);
}
assert.deepEqual(buildIndexWorkflowArgv(api, { port: '7347' }, scope),
  ['service', 'api', '--port=7347', '--repo=C:/selected repository', '--host=127.0.0.1', '--json']);
const setup = catalog.find(command => command.id === 'setup');
const setupArgv = buildIndexWorkflowArgv(setup, { 'skip-index': true, 'skip-install': true }, scope);
assert.ok(setupArgv.includes('--non-interactive=true'));
assert.ok(setupArgv.includes('--skip-index=true'));
assert.ok(setupArgv.includes('--json'));
const semantic = complete.find(command => command.id === 'semantic.detail');
assert.deepEqual(buildIndexWorkflowArgv(semantic, { request: 'requests/detail.json' }, scope),
  ['semantic', 'detail', '--request=requests/detail.json']);
assert.equal(semantic.fields.some(field => field.name === 'all'), false, 'native retains one bounded result page');
const bench = complete.find(command => command.id === 'bench.micro');
assert.equal(validateConfig(bench.schema, { components: 'index-build', runs: 999 }).ok, false);
const benchArgv = buildIndexWorkflowArgv(bench, {}, scope);
assert.ok(benchArgv.includes('--build=false'));
assert.ok(benchArgv.includes('--clean=false'));
assert.ok(benchArgv.includes('--components=sparse,dense,hybrid'));
for (const id of ['sqlite.compact', 'lmdb.build', 'service.mcp', 'service.indexer', 'cache.clear']) {
  assert.ok(catalog.find(command => command.id === id).unsupportedReason, `${id}: no implicit unimplemented ownership handoff`);
}
assertTuiWorkflowRequest('describe', { includeExperimental: true });
assert.throws(() => assertTuiWorkflowRequest('describe', { includeInternal: true }), { code: 'ERR_TUI_WORKFLOW_REQUEST' });
console.log('Native command coverage, canonical options, bounded argv and unsupported ownership dispositions');
