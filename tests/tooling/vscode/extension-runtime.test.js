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
const fakeVscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: repoRoot } }],
    getConfiguration() {
      return createFakeConfiguration(configValues);
    }
  },
  window: {
    async showInputBox() {
      return 'symbol';
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

const invalidCliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-cli-dir-'));
configValues.cliPath = invalidCliDir;
await extension._test.runSearch();
assert.equal(errorMessages.length, 1);
assert.match(errorMessages[0], /not a file/i);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /resolved to/i.test(event.line)));
assert.ok(outputEvents.some((event) => event.kind === 'show'));

console.log('vscode extension runtime test passed');
