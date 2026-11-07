import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-search-actions-a-' });
const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-search-actions-b-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
  workspaceFolders: [{ path: first }, { path: second }],
  globalConfigValues: { cliPath: path.join(first, 'bin', 'pairofcleats.js') } });
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
try {
  harness.activate(); harness.inputQueue.push('first query');
  harness.quickPickQueue.push(items => {
    assert(Object.isFrozen(items[0])); assert(Object.isFrozen(items[0].hit));
    return { ...items[0], hit: { ...items[0].hit, file: 'README.md' } };
  });
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ code: [{ file: 'src/app.ts', startLine: 1 }] }) });
  await harness.runCommand('pairofcleats.search');
  assert.equal(harness.openedDocuments.length, 0, 'copied picker results cannot retarget source opening');
  assert.match(harness.errorMessages.at(-1), /original result/);

  let resolveAction;
  harness.fakeVscode.window.showInformationMessage = (message, ...actions) => {
    harness.infoMessages.push(message);
    if (actions.includes('Tooling Doctor')) return new Promise(resolve => { resolveAction = resolve; });
    return undefined;
  };
  harness.inputQueue.push('empty original target');
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ code: [], retrieval: { diagnostics: {
    schemaVersion: 1, state: 'recorded', summary: 'Recorded empty result',
    reasons: [{ code: 'no-indexed-metadata-match', message: 'No retained match' }], actions: ['tooling-doctor'] } } }) });
  await harness.runCommand('pairofcleats.search'); assert(resolveAction);
  harness.setActiveFile(path.join(second, 'src', 'app.ts'));
  harness.queuedResults.push({ code: 0, stdout: '{}' }); resolveAction('Tooling Doctor'); await flush();
  assert.equal(harness.spawnCalls.length, 3);
  const diagnostic = harness.spawnCalls.at(-1);
  assert.equal(diagnostic.args[diagnostic.args.indexOf('--repo') + 1], first,
    'deliberately selected diagnostics retain the empty response repository through a focus change');
  assert.equal(diagnostic.options.cwd, first);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); for (const root of [first, second]) fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered search picker membership and captured diagnostic target controls authored; execution deferred.');
