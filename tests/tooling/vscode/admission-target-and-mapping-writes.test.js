import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

const capabilities = () => new Response(JSON.stringify({ ok: true, runtimeManifest: getRuntimeCapabilityManifest() }));
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
for (const command of ['search', 'indexHealth']) {
  const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-admission-target-a-' });
  const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-admission-target-b-' });
  let release, entered, firstMapping, secondMapping;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
    workspaceFolders: [{ path: first }, { path: second }],
    globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
    fetchImpl: async (url, options) => {
      if (url.includes('/capabilities')) { entered(); await gate; return capabilities(); }
      if (url.includes('/status')) return new Response(JSON.stringify(url.includes(encodeURIComponent('/srv/A')) ? firstMapping.status : secondMapping.status));
      assert.equal(JSON.parse(options.body).repo, '/srv/A');
      return new Response(JSON.stringify({ ok: true, result: { code: [] } }));
    } });
  firstMapping = prepareServiceMappingFixture(harness, { repoRoot: first, serviceRoot: '/srv/A' });
  const initial = harness.workspaceStateStore.get('pairofcleats.serviceRepositories');
  secondMapping = prepareServiceMappingFixture(harness, { repoRoot: second, serviceRoot: '/srv/B' });
  harness.workspaceStateStore.set('pairofcleats.serviceRepositories', { ...initial, ...harness.workspaceStateStore.get('pairofcleats.serviceRepositories') });
  try {
    harness.activate(); harness.inputQueue.push('original target query');
    const pending = harness.runCommand(`pairofcleats.${command}`); await ready;
    harness.setActiveFile(path.join(second, 'src', 'app.ts')); release(); await pending;
    const values = harness.workspaceStateStore.get(command === 'search' ? 'pairofcleats.searchHistory' : 'pairofcleats.workflowSessions');
    assert.equal(values[0].repoRoot, first, 'capability response latency cannot choose another active repository');
    assert(harness.fetchCalls.filter(call => call.url.includes('/status')).every(call => call.url.includes(encodeURIComponent('/srv/A'))));
    assert.deepEqual(harness.errorMessages, []);
  } finally {
    release(); await harness.extension.deactivate(); harness.restoreGlobals();
    for (const root of [first, second]) fs.rmSync(root, { recursive: true, force: true });
  }
}

const managedA = createVsCodeRuntimeTempRepo({ prefix: 'poc-managed-admission-a-' });
const managedB = createVsCodeRuntimeTempRepo({ prefix: 'poc-managed-admission-b-' });
const managed = createVsCodeRuntimeHarness({ repoRoot: managedA, activeFile: path.join(managedA, 'src', 'app.ts'),
  workspaceFolders: [{ path: managedA }, { path: managedB }],
  globalConfigValues: { cliPath: path.join(managedA, 'bin', 'pairofcleats.js') } });
try {
  managed.activate(); await flush();
  const read = managed.fakeVscode.workspace.getConfiguration; let moved = false;
  managed.fakeVscode.workspace.getConfiguration = (...args) => {
    const configuration = read(...args);
    if (!moved) { moved = true; managed.setActiveFile(path.join(managedB, 'src', 'app.ts')); }
    return configuration;
  };
  managed.queuedResults.push({ persistent: true }); await managed.runCommand('pairofcleats.indexWatchStart');
  assert.equal(managed.spawnCalls[0].options.cwd, managedA, 'managed admission binds the original root before effective configuration lookup');
} finally {
  await managed.extension.deactivate(); managed.restoreGlobals();
  for (const directory of [managedA, managedB]) fs.rmSync(directory, { recursive: true, force: true });
}

const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-mapping-merge-a-' });
const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-mapping-merge-b-' });
let firstMapping, secondMapping;
const gates = new Map(), entered = new Map(), requests = new Map();
for (const name of ['A', 'B']) {
  let release, ready;
  const promise = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { ready = resolve; });
  gates.set(name, { promise, release }); entered.set(name, { reached, ready });
}
const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
  workspaceFolders: [{ path: first }, { path: second }],
  globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
  fetchImpl: async url => {
    if (url.includes('/capabilities')) return capabilities();
    const name = url.includes(encodeURIComponent('/srv/A')) ? 'A' : 'B';
    const count = (requests.get(name) || 0) + 1; requests.set(name, count);
    if (count === 1) { entered.get(name).ready(); await gates.get(name).promise; }
    return new Response(JSON.stringify(name === 'A' ? firstMapping.status : secondMapping.status));
  } });
firstMapping = prepareServiceMappingFixture(harness, { repoRoot: first, serviceRoot: '/srv/A' });
secondMapping = prepareServiceMappingFixture(harness, { repoRoot: second, serviceRoot: '/srv/B' });
harness.workspaceStateStore.delete('pairofcleats.serviceRepositories');
try {
  harness.activate(); harness.fakeVscode.window.showInformationMessage = (message, ...actions) => {
    harness.infoMessages.push(message); return actions.includes('Use repository mapping') ? 'Use repository mapping' : undefined;
  };
  harness.inputQueue.push('/srv/A', '/srv/B');
  const a = harness.runCommand('pairofcleats.indexHealth'); await entered.get('A').reached;
  harness.setActiveFile(path.join(second, 'src', 'app.ts'));
  const b = harness.runCommand('pairofcleats.indexHealth'); await entered.get('B').reached;
  gates.get('B').release(); await b; gates.get('A').release(); await a;
  const mappings = Object.values(harness.workspaceStateStore.get('pairofcleats.serviceRepositories'));
  assert.deepEqual(mappings.map(mapping => mapping.serviceRoot).sort(), ['/srv/A', '/srv/B'],
    'serialized mapping writes merge against current state rather than overwriting another admitted root');
  assert.deepEqual(harness.errorMessages, []);
} finally {
  for (const gate of gates.values()) gate.release();
  await harness.extension.deactivate(); harness.restoreGlobals();
  for (const root of [first, second]) fs.rmSync(root, { recursive: true, force: true });
}

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-mapping-revision-refresh-' });
let mapping;
const refreshed = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
  fetchImpl: async url => url.includes('/capabilities') ? capabilities() : new Response(JSON.stringify(url.includes('/status')
    ? { ...mapping.status, status: { ...mapping.status.status, coverage: { currentProvenance: {
      head: { commitId: 'b'.repeat(40) }, dirty: false } } } } : { ok: true, result: { code: [] } })) });
mapping = prepareServiceMappingFixture(refreshed, { repoRoot: root, serviceRoot: '/srv/current' });
try {
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40)); refreshed.activate(); refreshed.inputQueue.push('current source');
  await refreshed.runCommand('pairofcleats.search');
  assert.equal(Object.values(refreshed.workspaceStateStore.get('pairofcleats.serviceRepositories'))[0].commit, 'b'.repeat(40));
  await refreshed.runCommand('pairofcleats.repeatLastSearch');
  assert.equal(refreshed.fetchCalls.filter(call => call.url.endsWith('/search')).length, 2,
    'a newly source-qualified search remains replayable against its just-verified mapping');
  assert.deepEqual(refreshed.errorMessages, []);
} finally { await refreshed.extension.deactivate(); refreshed.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
await flush();
console.log('Registered command admission retains its original target; service mapping merge/revision refresh controls authored; execution deferred.');
