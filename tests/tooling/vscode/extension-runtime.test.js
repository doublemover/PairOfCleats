#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  prepareVsCodeFixtureWorkspace,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-ext-'
});
const otherWorkspace = await prepareVsCodeFixtureWorkspace('vscode/secondary-repo', {
  prefix: 'poc-vscode-other-'
});

const nestedRepoRoot = workspace.resolvePath('packages', 'nested');
const nestedSourceFile = workspace.resolvePath('packages', 'nested', 'src', 'service.ts');
const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  configValues: {
    cliArgs: ['--trace']
  }
});

const { extension } = harness;
harness.activate();

assert.ok(harness.registeredCommands.has('pairofcleats.selectRepo'));
assert.ok(harness.registeredCommands.has('pairofcleats.clearSelectedRepo'));

const cliResolution = extension._test.resolveCli(
  workspace.root,
  harness.fakeVscode.workspace.getConfiguration()
);
assert.equal(cliResolution.ok, true);
assert.equal(cliResolution.command, process.execPath);
assert.deepEqual(
  cliResolution.argsPrefix,
  [workspace.resolvePath('bin', 'pairofcleats.js'), '--trace']
);

const repoContextSingle = await extension._test.resolveRepoContext();
assert.equal(repoContextSingle.ok, true);
assert.equal(repoContextSingle.repoRoot, workspace.root);
assert.equal(repoContextSingle.source, 'single-workspace');

harness.setActiveFile(nestedSourceFile);
const repoContextNested = await extension._test.resolveRepoContext();
assert.equal(repoContextNested.ok, true);
assert.equal(repoContextNested.repoRoot, nestedRepoRoot);
assert.equal(repoContextNested.source, 'active-editor');

harness.setWorkspaceFolders([
  { name: 'alpha', path: workspace.root },
  { name: 'beta', path: otherWorkspace.root }
]);
harness.setActiveFile(otherWorkspace.resolvePath('src', 'worker.ts'));
const repoContextActive = await extension._test.resolveRepoContext();
assert.equal(repoContextActive.ok, true);
assert.equal(repoContextActive.repoRoot, otherWorkspace.root);
assert.equal(repoContextActive.source, 'active-editor');

harness.setActiveEditor(null);
harness.quickPickQueue.push((items) => items[1]);
const repoContextPicked = await extension._test.resolveRepoContext();
assert.equal(repoContextPicked.ok, true);
assert.equal(repoContextPicked.repoRoot, otherWorkspace.root);
assert.equal(repoContextPicked.source, 'repo-picker');

harness.quickPickQueue.push((items) => items[1]);
await harness.runCommand('pairofcleats.selectRepo');
assert.match(harness.infoMessages.pop(), /will use secondary-repo/i);
harness.setActiveFile(workspace.resolvePath('src', 'app.ts'));
const selectedRepoContext = await extension._test.resolveRepoContext();
assert.equal(selectedRepoContext.ok, true);
assert.equal(selectedRepoContext.repoRoot, otherWorkspace.root);
assert.equal(selectedRepoContext.source, 'selected-repo');
assert.ok(String(selectedRepoContext.workspaceUriString || '').includes(otherWorkspace.root.replace(/\\/g, '/')));
assert.ok(harness.statusBarItems[0].text.includes('secondary-repo'));
assert.ok(harness.statusBarItems[0].text.includes('selected'));

await harness.runCommand('pairofcleats.clearSelectedRepo');
assert.match(harness.infoMessages.pop(), /cleared the explicit repository selection/i);
const clearedRepoContext = await extension._test.resolveRepoContext();
assert.equal(clearedRepoContext.ok, true);
assert.equal(clearedRepoContext.repoRoot, workspace.root);
assert.equal(clearedRepoContext.source, 'active-editor');

const persistedHarness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [
    { name: 'alpha', path: workspace.root },
    { name: 'beta', path: otherWorkspace.root }
  ],
  activeEditor: null,
  workspaceState: {
    'pairofcleats.selectedRepo': {
      repoRoot: otherWorkspace.root,
      workspacePath: otherWorkspace.root
    }
  }
});
persistedHarness.activate();
const persistedSelectedContext = await persistedHarness.extension._test.resolveRepoContext();
assert.equal(persistedSelectedContext.ok, true);
assert.equal(persistedSelectedContext.repoRoot, otherWorkspace.root);
assert.equal(persistedSelectedContext.source, 'selected-repo');

persistedHarness.setWorkspaceFolders([
  { name: 'local', path: workspace.root },
  {
    name: 'remote',
    uri: { scheme: 'vscode-remote', fsPath: '/workspace/remote', path: '/workspace/remote' }
  }
]);
persistedHarness.setActiveEditor({
  document: {
    uri: { scheme: 'vscode-remote', fsPath: '/workspace/remote/src/app.ts', path: '/workspace/remote/src/app.ts' }
  }
});
const remotePreferredContext = await persistedHarness.extension._test.resolveRepoContext({ allowRemote: true });
assert.equal(remotePreferredContext.ok, true);
assert.equal(remotePreferredContext.source, 'active-editor');
assert.equal(remotePreferredContext.workspaceUri.scheme, 'vscode-remote');

const remoteFolder = {
  name: 'remote',
  uri: { scheme: 'vscode-remote', fsPath: '/workspace/repo', path: '/workspace/repo' }
};
harness.setWorkspaceFolders([remoteFolder]);
const remoteContext = await extension._test.resolveRepoContext();
assert.equal(remoteContext.ok, false);
assert.equal(remoteContext.kind, 'unsupported-workspace');
assert.match(remoteContext.message, /local file workspaces/i);
assert.match(remoteContext.detail, /vscode-remote/i);

harness.setWorkspaceFolders([
  { name: 'remote', uri: { scheme: 'vscode-remote', fsPath: '/workspace/remote', path: '/workspace/remote' } },
  { name: 'local', path: workspace.root }
]);
harness.setActiveEditor({ document: { uri: { scheme: 'vscode-remote', fsPath: '/workspace/remote/src/app.ts', path: '/workspace/remote/src/app.ts' } } });
const mixedPassive = extension._test.resolvePassiveRepoContext();
assert.equal(mixedPassive.ok, true);
assert.equal(mixedPassive.repoRoot, workspace.root);
assert.equal(mixedPassive.source, 'single-workspace');

harness.setActiveFile(workspace.resolvePath('src', 'app.ts'));
const mixedActive = await extension._test.resolveRepoContext();
assert.equal(mixedActive.ok, true);
assert.equal(mixedActive.repoRoot, workspace.root);
assert.equal(mixedActive.source, 'active-editor');

const mixedPathHint = await extension._test.resolveRepoContext({
  pathHint: { scheme: 'file', fsPath: workspace.resolvePath('src', 'app.ts'), path: workspace.resolvePath('src', 'app.ts').replace(/\\/g, '/') }
});
assert.equal(mixedPathHint.ok, true);
assert.equal(mixedPathHint.repoRoot, workspace.root);
assert.equal(mixedPathHint.source, 'path-hint');

const invalidCliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-cli-dir-'));
harness.fakeVscode.workspace.workspaceFolders = [
  { name: 'local', uri: { scheme: 'file', fsPath: workspace.root, path: workspace.root.replace(/\\/g, '/') } }
];
harness.setActiveEditor(null);
harness.inputQueue.push('symbol');
harness.fakeVscode.workspace.getConfiguration = () => ({
  get(key) {
    const values = {
      cliPath: invalidCliDir,
      cliArgs: ['--trace'],
      searchMode: 'code',
      searchBackend: '',
      searchAnn: true,
      maxResults: 25,
      searchContextLines: 0,
      searchFile: '',
      searchPath: '',
      searchLang: '',
      searchExt: '',
      searchType: '',
      searchCaseSensitive: false,
      extraSearchArgs: [],
      env: {}
    };
    return values[key];
  }
});
await extension._test.runSearch();
assert.equal(harness.errorMessages.length, 1);
assert.match(harness.errorMessages[0], /not a file/i);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /resolved to/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'show'));
assert.equal(harness.infoMessages.length, 0);

console.log('vscode extension runtime test passed');
