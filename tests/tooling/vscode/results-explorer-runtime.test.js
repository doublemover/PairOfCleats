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

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-results-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n');
fs.writeFileSync(path.join(repoRoot, 'README.md'), '# readme\n');
fs.writeFileSync(path.join(repoRoot, 'records.json'), '{}\n');

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
const outputEvents = [];
const spawnCalls = [];
const queuedResults = [];
const inputQueue = [];
const quickPickQueue = [];
const openedPaths = [];
const revealCalls = [];
const clipboardWrites = [];
const infoMessages = [];
const errorMessages = [];
const treeViews = [];
const treeProviders = [];
const shownEditors = [];

const fakeVscode = {
  workspace: {
    workspaceFolders: [{ name: 'repo', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } }],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => uri?.fsPath?.startsWith(folder.uri.fsPath)) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    },
    async openTextDocument(uri) {
      openedPaths.push(uri.fsPath);
      return { uri };
    }
  },
  window: {
    activeTextEditor: { document: { uri: { scheme: 'file', fsPath: path.join(repoRoot, 'src', 'app.ts') } } },
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
    async showTextDocument(document) {
      const editor = {
        document,
        selection: null,
        revealRange(range) {
          shownEditors.push({ document, range });
        }
      };
      shownEditors.push(editor);
      return editor;
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
    },
    createStatusBarItem() {
      return { show() {}, hide() {}, dispose() {}, text: '', tooltip: '', command: '' };
    },
    createTreeView(id, options) {
      treeViews.push({ id, options });
      treeProviders.push(options.treeDataProvider);
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
  env: {
    clipboard: {
      async writeText(value) {
        clipboardWrites.push(value);
      }
    }
  },
  Uri: {
    file(fsPath) {
      return {
        scheme: 'file',
        fsPath,
        path: fsPath.replace(/\\/g, '/'),
        toString() {
          return `file:${this.path}`;
        }
      };
    },
    parse(value) {
      const text = String(value || '');
      const match = text.match(/^([a-z0-9+.-]+):(.*)$/i);
      const scheme = match ? match[1] : 'file';
      const uriPath = match ? match[2] : text;
      return {
        scheme,
        path: uriPath,
        fsPath: scheme === 'file' ? uriPath.replace(/\//g, path.sep) : uriPath,
        toString() {
          return `${this.scheme}:${this.path || this.fsPath || ''}`;
        }
      };
    },
    joinPath(base, ...segments) {
      const joined = path.posix.join(base.path || '', ...segments);
      return {
        ...base,
        path: joined,
        fsPath: base.scheme === 'file' ? joined.replace(/\//g, path.sep) : joined,
        toString() {
          return `${this.scheme}:${this.path || this.fsPath || ''}`;
        }
      };
    }
  },
  Position: class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  Selection: class Selection {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  TextEditorRevealType: { InCenter: 1 },
  ProgressLocation: { Notification: 1 },
  StatusBarAlignment: { Left: 1 },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
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
assert.equal(treeViews[0].id, 'pairofcleats.resultsExplorer');
const provider = treeProviders[0];

inputQueue.push('auth token');
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', score: 1, startLine: 1 }],
    prose: [{ file: 'README.md', score: 2, startLine: 1 }],
    records: [{ file: 'records.json', score: 3, startLine: 1 }]
  })
});
quickPickQueue.push((items) => items[0]);
await registeredCommands.get('pairofcleats.search')();

const history = workspaceStateStore.get('pairofcleats.searchHistory');
assert.equal(history.length, 1);
assert.equal(history[0].query, 'auth token');
assert.equal(history[0].totalHits, 3);
assert.equal(history[0].mode, 'both');
assert.equal(history[0].backend, 'sqlite');
assert.deepEqual(history[0].invocation.args, spawnCalls[0].args);

let roots = provider.getChildren();
assert.deepEqual(roots.map((node) => node.treeItem.label).sort(), ['code', 'prose', 'records']);

await registeredCommands.get('pairofcleats.groupResultsByFile')();
roots = provider.getChildren();
assert.deepEqual(roots.map((node) => node.treeItem.label).sort(), ['README.md', 'records.json', 'src/app.ts']);

await registeredCommands.get('pairofcleats.groupResultsByQuery')();
roots = provider.getChildren();
assert.equal(roots[0].treeItem.label, 'auth token');
const resultNode = roots[0].children[0];
await registeredCommands.get('pairofcleats.copyResultPath')(resultNode);
assert.ok(clipboardWrites[0].endsWith(path.join('src', 'app.ts')));
await registeredCommands.get('pairofcleats.revealResultHit')(resultNode);
assert.equal(revealCalls[0].id, 'revealInExplorer');
await registeredCommands.get('pairofcleats.openResultHit')(resultNode);
assert.ok(openedPaths[0].endsWith(path.join('src', 'app.ts')));
const openedEditor = shownEditors.find((entry) => entry?.selection);
assert.equal(openedEditor.selection.start.line, 0);

const traversalNode = {
  ...resultNode,
  hit: { ...resultNode.hit, file: '../outside.ts' }
};
const errorCountBeforeTraversal = errorMessages.length;
await registeredCommands.get('pairofcleats.copyResultPath')(traversalNode);
await registeredCommands.get('pairofcleats.revealResultHit')(traversalNode);
assert.ok(errorMessages.slice(errorCountBeforeTraversal).some((message) => /outside the repo/i.test(message)));

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
  })
});
quickPickQueue.push((items) => items[0]);
await registeredCommands.get('pairofcleats.showSearchHistory')();
assert.deepEqual(spawnCalls[1].args, spawnCalls[0].args);

await registeredCommands.get('pairofcleats.reopenLastResults')();
assert.ok(infoMessages.some((message) => /reopened results/i.test(message)));

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
  })
});
await registeredCommands.get('pairofcleats.rerunResultSet')(history[0]);
assert.deepEqual(spawnCalls[2].args, spawnCalls[0].args);
assert.equal(errorMessages.length, errorCountBeforeTraversal + 2, `unexpected errors: ${errorMessages.join('; ')}`);

console.log('vscode results explorer runtime test passed');
