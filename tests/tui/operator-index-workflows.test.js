import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiIndexWorkflows } from '../../tools/tui/operator/index-workflows.js';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { describeIndexWorkflows, buildIndexWorkflowArgv } from '../../tools/tui/operator/index-catalog.js';
import { INDEX_BUILD_OPTIONS } from '../../src/shared/cli-option-sets.js';
import { SNAPSHOT_COMMANDS } from '../../src/shared/index-tool-options.js';
import { describeCommandRegistryEntry } from '../../src/shared/command-registry-query.js';
import { assertTuiWorkflowRequest } from '../../src/contracts/validators/tui-workflow.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('operator-index-workflows');
const root = process.cwd(), repo = path.join(dir, 'repo'); await fs.mkdir(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1,"quality":"fast"}');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', syncProcess: true,
  testConfig: { threads: 1 },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const scopes = createTuiSettingsSession({ toolRoot: root, env });
let clock = 0;
const launches = [];
const actor = createTuiIndexWorkflows({ scopes, env, now: () => clock, startJob: async (...args) => { launches.push(args); } });
const scope = await scopes.selectScope({ kind: 'repo', target: repo });
const catalog = actor.describe({}).commands;
assert.equal(catalog.filter(command => command.registryId.startsWith('index.') && command.registryId !== 'index.diff'
  || command.registryId === 'workspace.build').length, 6 + Object.keys(SNAPSHOT_COMMANDS).length);
for (const command of catalog) {
  const registered = describeCommandRegistryEntry(command.registryId);
  assert.equal(command.supportTier, registered.supportTier);
  assert.deepEqual(command.commandPath.slice(0, registered.commandPath.length), registered.commandPath);
}
const builder = catalog.find(command => command.id === 'index.build');
for (const field of builder.fields) assert.equal(field.schema.type, INDEX_BUILD_OPTIONS[field.name].type);
const prepared = await actor.preview({ scopeId: scope.id, commandId: 'index.build',
  values: { mode: 'code', sqlite: false, 'watch-poll': 0, 'stub-embeddings': true, threads: 1 } });
assert.equal(prepared.launchable, true);
assert.ok(prepared.canonicalArgv.includes('--sqlite=false'));
assert.ok(prepared.canonicalArgv.includes('--watch-poll=0'));
assert.equal(prepared.observations[0].embeddings.useStubEmbeddings, true);
assert.equal(prepared.observations[0].embeddings.runtimeQualified, false);
assert.equal(prepared.observations[0].publication.ready, false);
assert.equal(launches.length, 0, 'preview performs no build');
assert.throws(() => assertTuiWorkflowRequest('launch', { scopeId: scope.id, previewId: prepared.previewId, confirmed: false }), { code: 'ERR_TUI_WORKFLOW_REQUEST' });
await actor.launch({ scopeId: scope.id, previewId: prepared.previewId, confirmed: true });
assert.equal(launches.length, 1);
assert.equal(launches[0][0].retry.maxAttempts, 1);
assert.match(launches[0][0].jobId, /^workflow-/);
assert.equal(launches[0][0].jobId, prepared.plannedJobId);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":3,"quality":"fast"}');
await assert.rejects(launches[0][1].beforeRun({ signal: new AbortController().signal }),
  { code: 'ERR_TUI_WORKFLOW_STALE' }, 'a changed source must invalidate a preview even when an overlay shadows its value');
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1,"quality":"fast"}');
await assert.rejects(actor.launch({ scopeId: scope.id, previewId: prepared.previewId, confirmed: true }), { code: 'ERR_TUI_WORKFLOW_STALE' });
for (const values of [{ repo: dir }, { threads: '1' }, { sqlite: null }, { mode: '\0' }, JSON.parse('{"__proto__":{}}')]) {
  const rejected = await actor.preview({ scopeId: scope.id, commandId: 'index.build', values });
  assert.equal(rejected.launchable, false); assert.equal(rejected.previewId, undefined);
}
for (const kind of ['constructor', 'toString', '__proto__']) assert.throws(() => assertTuiWorkflowRequest(kind, {}), { code: 'ERR_TUI_WORKFLOW_REQUEST' });
assert.throws(() => assertTuiWorkflowRequest('preview', { scopeId: scope.id, commandId: 'index.build', values: {}, command: process.execPath }), { code: 'ERR_TUI_WORKFLOW_REQUEST' });
const snapshot = catalog.find(command => command.id === 'index.snapshot.create');
assert.ok(buildIndexWorkflowArgv(snapshot, { tag: ['first', 'second'], 'wait-ms': 0 }, scope).includes('--tag=second'));
const show = catalog.find(command => command.id === 'index.snapshot.show');
assert.throws(() => buildIndexWorkflowArgv(show, { snapshotId: '--help' }, scope), /Invalid positional snapshotId/);
assert.deepEqual(buildIndexWorkflowArgv(show, { snapshotId: 'snap-native-created' }, scope),
  ['index', 'snapshot', 'show', 'snap-native-created', `--repo=${repo}`, '--json']);
const invalidSnapshot = await actor.preview({ scopeId: scope.id, commandId: show.id, values: { snapshotId: '--help' } });
assert.equal(invalidSnapshot.launchable, false);
assert.equal(invalidSnapshot.previewId, undefined);
const expired = await actor.preview({ scopeId: scope.id, commandId: 'index.stats', values: {} });
clock = 300001;
await assert.rejects(actor.launch({ scopeId: scope.id, previewId: expired.previewId, confirmed: true }), { code: 'ERR_TUI_WORKFLOW_STALE' });
const cancelled = await actor.preview({ scopeId: scope.id, commandId: 'index.stats', values: {} });
assert.deepEqual(actor.discard({ scopeId: scope.id, previewId: cancelled.previewId }), { discarded: true });
await assert.rejects(actor.launch({ scopeId: scope.id, previewId: cancelled.previewId, confirmed: true }), { code: 'ERR_TUI_WORKFLOW_STALE' });
const old = await actor.preview({ scopeId: scope.id, commandId: 'index.stats', values: {} });
await scopes.selectScope({ kind: 'repo', target: repo });
await assert.rejects(actor.launch({ scopeId: scope.id, previewId: old.previewId, confirmed: true }), { code: 'ERR_TUI_SCOPE_CHANGED' });
actor.dispose(); scopes.dispose();
assert.equal(launches.length, 1);
console.log('Typed index catalog, value preservation, one-use confirmation and scope/expiry authority passed.');
