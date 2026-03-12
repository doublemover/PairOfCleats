#!/usr/bin/env node
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

export function createVsCodeFixtureRepo(prefix = 'poc-vscode-fixture-') {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# fixture\n');
  fs.writeFileSync(path.join(repoRoot, 'rules', 'architecture.rules.json'), '{"version":1,"rules":[]}\n');
  return repoRoot;
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
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        return true;
      };
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

export function createVsCodeRuntimeHarness({
  repoRoot,
  workspaceFolders = [{ name: 'repo', path: repoRoot }],
  activeFile = null,
  configValues = {}
} = {}) {
  const normalizedConfig = {
    cliPath: '',
    cliArgs: [],
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
    env: {},
    ...configValues
  };
  const workspaceStateStore = new Map();
  const outputEvents = [];
  const errorMessages = [];
  const infoMessages = [];
  const openExternalCalls = [];
  const registeredCommands = new Map();
  const spawnCalls = [];
  const queuedResults = [];
  const inputQueue = [];
  const quickPickQueue = [];
  const treeViews = [];
  const treeProviders = [];

  const fakeVscode = {
    workspace: {
      workspaceFolders: workspaceFolders.map((folder) => ({
        name: folder.name,
        uri: { scheme: 'file', fsPath: folder.path, path: folder.path.replace(/\\/g, '/') }
      })),
      getWorkspaceFolder(uri) {
        return this.workspaceFolders.find((folder) => uri?.fsPath?.startsWith(folder.uri.fsPath)) || null;
      },
      getConfiguration() {
        return createFakeConfiguration(normalizedConfig);
      },
      async openTextDocument(uri) {
        return { uri };
      }
    },
    window: {
      activeTextEditor: activeFile
        ? { document: { uri: { scheme: 'file', fsPath: activeFile, path: activeFile.replace(/\\/g, '/') } } }
        : null,
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
      showErrorMessage(message) {
        errorMessages.push(message);
      },
      showInformationMessage(message) {
        infoMessages.push(message);
      },
      async showTextDocument(document) {
        return {
          document,
          selection: null,
          revealRange() {}
        };
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
      async executeCommand() {}
    },
    env: {
      async openExternal(uri) {
        openExternalCalls.push(uri);
        return true;
      }
    },
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
    },
    Uri: {
      file(fsPath) {
        return { scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') };
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
    TextEditorRevealType: { InCenter: 1 }
  };

  const extension = loadExtensionWithMocks({
    fakeVscode,
    fakeChildProcess: createFakeSpawn(spawnCalls, queuedResults)
  });

  const context = {
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

  return {
    extension,
    fakeVscode,
    context,
    outputEvents,
    errorMessages,
    infoMessages,
    openExternalCalls,
    registeredCommands,
    spawnCalls,
    queuedResults,
    inputQueue,
    quickPickQueue,
    treeViews,
    treeProviders,
    workspaceStateStore,
    activate() {
      extension.activate(context);
    },
    setActiveFile(filePath) {
      fakeVscode.window.activeTextEditor = filePath
        ? { document: { uri: { scheme: 'file', fsPath: filePath, path: filePath.replace(/\\/g, '/') } } }
        : null;
    },
    async runCommand(commandId, ...args) {
      const handler = registeredCommands.get(commandId);
      if (!handler) {
        throw new Error(`Missing registered command ${commandId}`);
      }
      return handler(...args);
    }
  };
}
