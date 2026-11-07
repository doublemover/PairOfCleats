import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-presentation-original-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
try {
  harness.activate(); harness.inputQueue.push('file:src/app.ts', '2');
  harness.quickPickQueue.push(items => items.find(item => item.value === 'markdown'));
  const primary = Object.freeze({ message: 'Preview rejected with its original retained owner', cacheOwnershipReleased: () => false });
  const execute = harness.fakeVscode.commands.executeCommand;
  harness.fakeVscode.commands.executeCommand = async (id, ...args) => {
    if (id === 'markdown.showPreviewToSide') throw primary;
    return execute(id, ...args);
  };
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ primary: { ref: { chunkUid: 'retained' } }, warnings: [] }) });
  const evidence = await harness.runCommand('pairofcleats.contextPack');
  assert.equal(evidence.primaryError, primary, 'plain-text fallback cannot erase the original preview failure');
  assert.equal(primary.cacheOwnershipReleased(), false);
  assert(harness.openedDocuments.some(document => document.uri?.fsPath?.endsWith('.md')), 'bounded evidence remains inspectable after preview fallback');
  assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'failed');
  assert(!harness.infoMessages.some(message => /Context Pack completed/.test(message)));
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered operator presentation fallback preserves original failure and refuses successful terminal state; execution deferred.');
