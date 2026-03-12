#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
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

function loadExtensionWithMocks({ fakeVscode, fakeChildProcess }) {
  const originalLoad = Module._load;
  delete require.cache[extensionPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return fakeVscode;
    if (request === 'node:child_process') return fakeChildProcess;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(extensionPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createFakeSpawn(spawnCalls, queuedResults) {
  return {
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const result = queuedResults.shift();
      setImmediate(() => {
        if (!result) {
          child.emit('close', 0);
          return;
        }
        if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
        if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
        if (result.error) {
          child.emit('error', result.error);
          return;
        }
        child.emit('close', result.code ?? 0);
      });
      return child;
    }
  };
}

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-search-entrypoints-'));
const repoCacheRoot = path.join(repoRoot, '.cache', 'repo');
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'tools', 'config'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
fs.mkdirSync(repoCacheRoot, { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'tools', 'config', 'dump.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n');

const configValues = {
  cliPath: '',
  cliArgs: [],
  searchMode: 'both',
  searchBackend: 'sqlite',
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

const workspaceStateStore = new Map();
const registeredCommands = new Map();
const spawnCalls = [];
const queuedResults = [];
const inputQueue = [];
const quickPickQueue = [];
const infoMessages = [];
const errorMessages = [];
const revealCalls = [];

const emptySelection = {
  isEmpty: true,
  start: { line: 0, character: 4 },
  end: { line: 0, character: 4 },
  active: { line: 0, character: 4 }
};
const selectedRange = {
  isEmpty: false,
  start: { line: 0, character: 0 },
  end: { line: 0, character: 14 },
  active: { line: 0, character: 14 }
};
const symbolRange = { kind: 'word' };
const activeDocument = {
  uri: { scheme: 'file', fsPath: path.join(repoRoot, 'src', 'app.ts') },
  getText(range) {
    if (range === selectedRange) return 'selected token';
    if (range === symbolRange) return 'AuthToken';
    return '';
  },
  getWordRangeAtPosition() {
    return symbolRange;
  }
};
const activeEditor = {
  document: activeDocument,
  selection: emptySelection,
  selections: [emptySelection]
};

const fakeVscode = {
  workspace: {
    workspaceFolders: [{ name: 'repo', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } }],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => uri?.fsPath?.startsWith(folder.uri.fsPath)) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    }
  },
  window: {
    activeTextEditor: activeEditor,
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return { dispose() {} };
        }
      };
      return task({}, token);
    },
    async showInputBox() {
      return inputQueue.shift();
    },
    async showQuickPick(items) {
      const next = quickPickQueue.shift();
      if (typeof next === 'function') return next(items);
      return next ?? null;
    },
    showInformationMessage(message) {
      infoMessages.push(message);
    },
    showErrorMessage(message) {
      errorMessages.push(message);
    },
    createOutputChannel() {
      return {
        appendLine() {},
        show() {}
      };
    },
    createTreeView() {
      return { dispose() {} };
    }
  },
  commands: {
    registerCommand(id, handler) {
      registeredCommands.set(id, handler);
      return { dispose() {} };
    },
    async executeCommand(id, arg) {
      revealCalls.push({ id, arg });
    }
  },
  Uri: {
    file(fsPath) {
      return { scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') };
    }
  },
  ProgressLocation: { Notification: 1 },
  StatusBarAlignment: { Left: 1 },
  EventEmitter: class EventEmitterWrapper {
    constructor() {
      this.emitter = new EventEmitter();
      this.event = (listener) => {
        this.emitter.on('change', listener);
        return { dispose: () => this.emitter.off('change', listener) };
      };
    }

    fire(value) {
      this.emitter.emit('change', value);
    }

    dispose() {
      this.emitter.removeAllListeners('change');
    }
  }
};

const fakeContext = {
  subscriptions: [],
  workspaceState: {
    get(key, fallback) {
      return workspaceStateStore.has(key) ? workspaceStateStore.get(key) : fallback;
    },
    async update(key, value) {
      workspaceStateStore.set(key, value);
    }
  }
};

const extension = loadExtensionWithMocks({
  fakeVscode,
  fakeChildProcess: createFakeSpawn(spawnCalls, queuedResults)
});
extension.activate(fakeContext);

quickPickQueue.push(null);
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
activeEditor.selection = selectedRange;
activeEditor.selections = [selectedRange];
await registeredCommands.get('pairofcleats.searchSelection')();
assert.equal(spawnCalls[0].args.at(-1), 'selected token');
assert.ok(!spawnCalls[0].args.includes('--explain'));

quickPickQueue.push(null);
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
activeEditor.selection = emptySelection;
activeEditor.selections = [emptySelection];
await registeredCommands.get('pairofcleats.searchSymbolUnderCursor')();
assert.equal(spawnCalls[1].args.at(-1), 'AuthToken');
assert.ok(!spawnCalls[1].args.includes('--explain'));

inputQueue.push('why auth matters');
quickPickQueue.push(null);
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
await registeredCommands.get('pairofcleats.explainSearch')();
assert.equal(spawnCalls[2].args.at(-1), 'why auth matters');
assert.ok(spawnCalls[2].args.includes('--explain'));

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
await registeredCommands.get('pairofcleats.repeatLastSearch')();
assert.deepEqual(spawnCalls[3].args, spawnCalls[2].args);
assert.ok(infoMessages.some((message) => /reran "why auth matters"/i.test(message)));

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
quickPickQueue.push((items) => items.find((item) => item.label === 'selected token'));
await registeredCommands.get('pairofcleats.showSearchHistory')();
assert.deepEqual(spawnCalls[4].args, spawnCalls[0].args);

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot,
    derived: {
      cacheRoot: path.join(repoRoot, '.cache'),
      repoCacheRoot,
      mcp: { mode: 'auto', modeSource: 'default', sdkAvailable: true }
    },
    policy: { quality: { value: 'max', source: 'config' } }
  })
});
await registeredCommands.get('pairofcleats.openIndexDirectory')();
assert.equal(revealCalls.at(-1).id, 'revealInExplorer');
assert.equal(revealCalls.at(-1).arg.fsPath, repoCacheRoot);
assert.equal(errorMessages.length, 0, `unexpected errors: ${errorMessages.join('; ')}`);

console.log('vscode search entrypoints runtime test passed');
