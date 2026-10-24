import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const manifest = require('../../../extensions/vscode/package.json');
const installation = createVsCodeRuntimeTempRepo({ prefix: 'poc-editor-install-' });
const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-editor-first-' });
const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-editor-second-' });
const cli = path.join(installation, 'bin', 'pairofcleats.js');
const user = { cliPath: cli, nodePath: process.execPath, apiExecutionMode: 'cli', env: {}, cliArgs: [], extraSearchArgs: [] };
const byRoot = new Map([[first, { searchMode: 'code', searchBackend: 'memory', searchFilter: 'lang:javascript' }],
  [second, { searchMode: 'records', searchBackend: 'memory', searchFilter: 'type:record' }]]);
const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
  workspaceFolders: [{ name: 'same-name', path: first }, { name: 'same-name', path: second }],
  globalConfigValues: user,
  workspaceState: { 'pairofcleats.selectedRepo': { repoRoot: second, workspacePath: second } } });
const resourceCalls = [];
harness.fakeVscode.workspace.getConfiguration = (namespace, resource) => {
  assert.equal(namespace, 'pairofcleats');
  resourceCalls.push(resource?.fsPath);
  const root = resource?.fsPath?.startsWith(second) ? second : first;
  const folder = byRoot.get(root);
  const inspect = key => ({ defaultValue: manifest.contributes.configuration.properties[`pairofcleats.${key}`]?.default,
    globalValue: user[key], workspaceFolderValue: key === 'cliPath' ? path.join(root, 'malicious-cli.js') : folder[key] });
  return { inspect, get: key => folder[key] ?? user[key] ?? inspect(key).defaultValue };
};
const generation = 'a'.repeat(64);
const page = (chunkUid, hasMore) => ({ code: [], prose: [], extractedProse: [],
  records: [{ file: 'src/app.ts', chunkUid, name: 'same spelling', startLine: 1 }],
  pagination: { kind: 'filter', order: 'indexed-order', generation, total: 2, returned: 1,
    hasMore, nextCursor: hasMore ? 'opaque' : null, coverage: 'indexed-metadata' } });
try {
  harness.activate();
  assert.equal(harness.extension._test.resolvePassiveRepoContext().repoRoot, second,
    'the explicitly saved repository owns enumeration before dispatch');
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(page('one', true)) });
  await harness.extension._test.executeSearchCommand({ enumeration: true, optionOverrides: { filter: 'type:record' } });
  assert(resourceCalls.includes(second), 'selected target URI is passed into getConfiguration');
  const firstArgs = harness.spawnCalls[0].args;
  assert.equal(firstArgs[0], cli, 'application installation is distinct from the selected target');
  assert.equal(firstArgs[firstArgs.indexOf('--repo') + 1], second,
    `the selected repository survives dispatch: ${JSON.stringify({ errors: harness.errorMessages, resourceCalls })}`);
  assert.equal(firstArgs[firstArgs.indexOf('--mode') + 1], 'records');
  assert(!firstArgs.some(value => value.includes('malicious-cli.js')), 'resource-scoped runtime override has no authority');
  const original = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
  assert.equal(original.query, '');
  assert.equal(original.pagination.generation, generation);

  byRoot.get(second).searchMode = 'all';
  byRoot.get(second).searchFilter = 'changed-filter';
  harness.setActiveFile(path.join(first, 'src', 'app.ts'));
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(page('two', false)) });
  await harness.runCommand('pairofcleats.loadMoreResults');
  const continuation = harness.spawnCalls[1].args;
  assert.equal(continuation[continuation.indexOf('--mode') + 1], 'records', 'continuation owns frozen mode membership');
  assert.equal(continuation[continuation.indexOf('--filter') + 1], 'type:record');
  assert.equal(continuation[continuation.indexOf('--cursor') + 1], 'opaque');
  const merged = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
  assert.equal(merged.resultSetId, original.resultSetId);
  assert.deepEqual(merged.hits.map(hit => hit.chunkUid), ['one', 'two']);
  assert.equal(merged.pagination.hasMore, false);

  const doctor = harness.extension._test.OPERATOR_COMMAND_SPECS.find(spec => spec.id === 'pairofcleats.doctor');
  const resolved = harness.extension._test.resolveCli(second, harness.extension._test.getExtensionConfiguration({ repoUri: harness.fakeVscode.Uri.file(second) }));
  const invocation = harness.extension._test.resolveOperatorInvocation(doctor, { repoRoot: second }, resolved);
  assert.deepEqual(invocation.args, [cli, 'tooling', 'doctor', '--json', '--repo', second]);
  const denied = harness.extension._test.resolveOperatorInvocation({ title: 'Unsupported script', invocation: 'script', scriptParts: ['tools', 'evil.js'] },
    { repoRoot: second }, resolved);
  assert.equal(denied.ok, false, 'target repositories cannot become operator script installations');

  const count = harness.spawnCalls.length;
  harness.fakeVscode.workspace.isTrusted = false;
  await harness.extension._test.executeSearchCommand({ query: 'trust-negative' });
  assert.equal(harness.spawnCalls.length, count, 'trusted User runtime settings do not bypass workspace trust');
} finally {
  await harness.extension.deactivate();
  harness.restoreGlobals();
  for (const directory of [installation, first, second]) fs.rmSync(directory, { recursive: true, force: true });
}
console.log('Resource-scoped enumeration, frozen continuation, installation ownership and authority negatives passed');
