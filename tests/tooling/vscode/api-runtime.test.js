#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-vscode-api-' });
const baseUrl = 'http://127.0.0.1:4311';
const serviceRoot = '/srv/\u96ea repository';
const runtimeManifest = getRuntimeCapabilityManifest();
const apiHarness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root, workspaceFolders: [{ name: 'editor-checkout', path: workspace.root }],
  activeFile: workspace.resolvePath('src', 'app.ts'),
  globalConfigValues: { apiServerUrl: baseUrl, apiExecutionMode: 'require' },
  configValues: { apiTimeoutMs: 4321, searchMode: 'code' }
});
const mapping = prepareServiceMappingFixture(apiHarness, { repoRoot: workspace.root, baseUrl, serviceRoot });
try {
  apiHarness.activate();
  apiHarness.inputQueue.push('AuthToken');
  apiHarness.quickPickQueue.push(null);
  apiHarness.queuedFetchResults.push({ status: 200, json: { ok: true, runtimeManifest } },
    { status: 200, json: mapping.status },
    { status: 200, json: { ok: true, result: { code: [{ file: `${serviceRoot}/src/app.ts`, score: 1, startLine: 1 }] } } });
  await apiHarness.runCommand('pairofcleats.search');
  assert.equal(apiHarness.spawnCalls.length, 0, 'API search never falls back to CLI in require mode');
  assert.equal(apiHarness.fetchCalls.length, 3, 'capabilities and source-qualified status precede search');
  assert.ok(String(apiHarness.fetchCalls[0].url).endsWith('/capabilities'));
  assert.ok(String(apiHarness.fetchCalls[1].url).includes(`/status?repo=${encodeURIComponent(serviceRoot)}`));
  const posted = JSON.parse(String(apiHarness.fetchCalls[2].options.body));
  assert.equal(posted.repo, serviceRoot, 'service-host filesystem root is independent of editor root');
  assert.equal(posted.query, 'AuthToken');
  const history = apiHarness.workspaceStateStore.get('pairofcleats.searchHistory');
  assert.equal(history.length, 1);
  assert.equal(history[0].repoRoot, workspace.root);
  assert.equal(history[0].repoUri, apiHarness.fakeVscode.Uri.file(workspace.root).toString());
  assert.equal(history[0].hits[0].file, 'src/app.ts', 'service absolute path is contained and translated before persistence');
  assert.equal(history[0].invocation.kind, 'api-search');
  assert.equal(history[0].invocation.baseUrl, baseUrl);
  assert.equal(history[0].invocation.timeoutMs, 4321);
  assert.equal(history[0].invocation.payload.repo, serviceRoot);

  apiHarness.queuedFetchResults.push({ status: 200, json: { ok: true,
    result: { code: [{ file: `${serviceRoot}/src/app.ts`, score: 1, startLine: 1 }] } } });
  await apiHarness.runCommand('pairofcleats.rerunResultSet', history[0]);
  assert.equal(apiHarness.fetchCalls.length, 4, 'explicit rerun retains captured service scope');
  apiHarness.queuedFetchResults.push({ status: 200, json: mapping.status }, { status: 200, json: mapping.status });
  await apiHarness.runCommand('pairofcleats.indexHealth');
  assert.equal(apiHarness.fetchCalls.length, 6, 'health mapping is requalified before its scoped status read');
  assert.equal(apiHarness.spawnCalls.length, 0);
  assert.ok(apiHarness.infoMessages.some(message => /Index Health completed/i.test(message)));
  await apiHarness.extension._test.runExplainSearch();
  assert.ok(apiHarness.errorMessages.some(message => /API mode is not supported for explain search/i.test(message)));
} finally { apiHarness.restoreGlobals(); }

const remoteUri = { scheme: 'vscode-remote', path: '/workspace/repo', fsPath: '/workspace/repo',
  toString() { return 'vscode-remote://unqualified/workspace/repo'; } };
const virtual = createVsCodeRuntimeHarness({ repoRoot: workspace.root,
  workspaceFolders: [{ name: 'virtual', uri: remoteUri }], activeEditor: { document: { uri: remoteUri } },
  globalConfigValues: { apiServerUrl: baseUrl, apiExecutionMode: 'require' } });
try {
  virtual.activate();
  virtual.queuedFetchResults.push({ status: 200, json: { ok: true, runtimeManifest } });
  await virtual.runCommand('pairofcleats.search');
  assert.equal(virtual.spawnCalls.length, 0);
  assert.equal(virtual.fetchCalls.length, 0, 'an unsupported source root cannot issue even a capability probe');
  assert.ok(virtual.errorMessages.some(message => /unsupported|local file|Virtual|non-file/i.test(message)));
} finally { virtual.restoreGlobals(); }

const prefer = createVsCodeRuntimeHarness({ repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  globalConfigValues: { apiServerUrl: baseUrl, apiExecutionMode: 'prefer', cliArgs: ['--trace'] } });
try {
  prefer.activate();
  prefer.inputQueue.push('fallback query');
  prefer.quickPickQueue.push(null);
  prefer.queuedFetchResults.push({ status: 500, json: { message: 'capabilities offline' } });
  prefer.queuedResults.push({ code: 0, stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] }) });
  await prefer.runCommand('pairofcleats.search');
  assert.equal(prefer.fetchCalls.length, 1);
  assert.equal(prefer.spawnCalls.length, 1, 'prefer mode retains its declared capability-failure CLI fallback');
  assert.ok(prefer.outputEvents.some(event => event.kind === 'append' && /capabilities offline/i.test(event.line)));
} finally { prefer.restoreGlobals(); }
console.log('VS Code explicit service repository mapping, virtual-workspace admission and transport policy fixtures passed');
