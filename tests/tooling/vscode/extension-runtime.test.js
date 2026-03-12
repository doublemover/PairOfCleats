#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const extensionPath = path.resolve('extensions/vscode/extension.js');

function createFakeConfiguration(values) {
  return {
    get(key) {
      return values[key];
    }
  };
}

function loadExtensionWithVscode(fakeVscode) {
  const originalLoad = Module._load;
  delete require.cache[extensionPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(extensionPath);
  } finally {
    Module._load = originalLoad;
  }
}

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-ext-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');

const configValues = {
  'cliPath': '',
  'cliArgs': ['--trace'],
  'searchMode': 'code',
  'searchBackend': '',
  'searchAnn': true,
  'maxResults': 25,
  'searchContextLines': 0,
  'searchFile': '',
  'searchPath': '',
  'searchLang': '',
  'searchExt': '',
  'searchType': '',
  'searchCaseSensitive': false,
  'extraSearchArgs': [],
  'env': {}
};

const outputEvents = [];
const errorMessages = [];
const infoMessages = [];
let quickPickCalls = 0;
const fakeVscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: repoRoot } }],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => folder.uri.fsPath === uri?.fsPath) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    }
  },
  window: {
    activeTextEditor: null,
    async showInputBox() {
      return 'symbol';
    },
    async showQuickPick(items) {
      quickPickCalls += 1;
      return items[1];
    },
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return { dispose() {} };
        }
      };
      return task({}, token);
    },
    showErrorMessage(message) {
      errorMessages.push(message);
    },
    showInformationMessage(message) {
      infoMessages.push(message);
    },
    createOutputChannel(name) {
      return {
        name,
        appendLine(line) {
          outputEvents.push({ kind: 'append', line });
        },
        show(preserveFocus) {
          outputEvents.push({ kind: 'show', preserveFocus });
        }
      };
    }
  },
  commands: {
    registerCommand() {
      return { dispose() {} };
    }
  },
  ProgressLocation: {
    Notification: 1
  }
};

const extension = loadExtensionWithVscode(fakeVscode);

const cliResolution = extension._test.resolveCli(repoRoot, createFakeConfiguration(configValues));
assert.equal(cliResolution.ok, true);
assert.equal(cliResolution.command, process.execPath);
assert.deepEqual(
  cliResolution.argsPrefix,
  [path.join(repoRoot, 'bin', 'pairofcleats.js'), '--trace']
);

const repoContextSingle = await extension._test.resolveRepoContext();
assert.equal(repoContextSingle.ok, true);
assert.equal(repoContextSingle.repoRoot, repoRoot);
assert.equal(repoContextSingle.source, 'single-workspace');

const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-other-'));
fakeVscode.workspace.workspaceFolders = [
  { name: 'alpha', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } },
  { name: 'beta', uri: { scheme: 'file', fsPath: otherRoot, path: otherRoot.replace(/\\/g, '/') } }
];
fakeVscode.window.activeTextEditor = {
  document: {
    uri: { scheme: 'file', fsPath: otherRoot, path: otherRoot.replace(/\\/g, '/') }
  }
};
const repoContextActive = await extension._test.resolveRepoContext();
assert.equal(repoContextActive.ok, true);
assert.equal(repoContextActive.repoRoot, otherRoot);
assert.equal(repoContextActive.source, 'active-editor');

fakeVscode.window.activeTextEditor = null;
const repoContextPicked = await extension._test.resolveRepoContext();
assert.equal(repoContextPicked.ok, true);
assert.equal(repoContextPicked.repoRoot, otherRoot);
assert.equal(repoContextPicked.source, 'workspace-picker');
assert.equal(quickPickCalls, 1);

fakeVscode.workspace.workspaceFolders = [
  { name: 'remote', uri: { scheme: 'vscode-remote', fsPath: '/workspace/repo', path: '/workspace/repo' } }
];
const remoteContext = await extension._test.resolveRepoContext();
assert.equal(remoteContext.ok, false);
assert.equal(remoteContext.kind, 'unsupported-workspace');
assert.match(remoteContext.message, /local file workspaces/i);

const invalidCliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-cli-dir-'));
configValues.cliPath = invalidCliDir;
fakeVscode.workspace.workspaceFolders = [
  { name: 'local', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } }
];
await extension._test.runSearch();
assert.equal(errorMessages.length, 1);
assert.match(errorMessages[0], /not a file/i);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /resolved to/i.test(event.line)));
assert.ok(outputEvents.some((event) => event.kind === 'show'));
assert.equal(infoMessages.length, 0);

console.log('vscode extension runtime test passed');
