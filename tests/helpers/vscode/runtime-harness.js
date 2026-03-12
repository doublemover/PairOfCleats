#!/usr/bin/env node
import path from 'node:path';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { copyFixtureToTemp } from '../fixtures.js';

const require = createRequire(import.meta.url);
const extensionPath = path.resolve('extensions/vscode/extension.js');

function createFakeConfiguration(values) {
  return {
    get(key) {
      return values[key];
    }
  };
}

export async function prepareVsCodeFixtureWorkspace(
  fixtureName = 'vscode/workspace-root',
  { prefix = 'poc-vscode-fixture-' } = {}
) {
  const root = await copyFixtureToTemp(fixtureName, { prefix });
  return {
    root,
    resolvePath(...segments) {
      return path.join(root, ...segments);
    }
  };
}

export async function createVsCodeFixtureRepo(
  fixtureName = 'vscode/workspace-root',
  options = {}
) {
  return (await prepareVsCodeFixtureWorkspace(fixtureName, options)).root;
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

function createFakeSpawn(spawnCalls, queuedResults, killCalls) {
  return {
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = (signal) => {
        child.killed = true;
        killCalls.push({ command, args, signal });
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
        if (!result.persistent) {
          child.emit('close', result.code ?? 0);
        }
      });
      return child;
    }
  };
}

function normalizeFileUri(filePath) {
  return { scheme: 'file', fsPath: filePath, path: filePath.replace(/\\/g, '/') };
}

function createTrackedStatusBarItem(statusBarItems) {
  const item = {
    text: '',
    tooltip: '',
    command: '',
    shown: 0,
    hidden: 0,
    disposed: false,
    show() {
      this.shown += 1;
    },
    hide() {
      this.hidden += 1;
    },
    dispose() {
      this.disposed = true;
    }
  };
  statusBarItems.push(item);
  return item;
}

export function createVsCodeRuntimeHarness({
  repoRoot,
  workspaceFolders = [{ name: 'repo', path: repoRoot }],
  activeFile = null,
  activeEditor = null,
  configValues = {},
  workspaceState = {}
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
    searchAsOf: '',
    searchSnapshot: '',
    searchFilter: '',
    searchAuthor: '',
    searchModifiedAfter: '',
    searchModifiedSince: '',
    searchChurn: '',
    searchCaseSensitive: false,
    extraSearchArgs: [],
    env: {},
    ...configValues
  };
  const workspaceStateStore = new Map(Object.entries(workspaceState));
  const outputEvents = [];
  const errorMessages = [];
  const infoMessages = [];
  const openExternalCalls = [];
  const registeredCommands = new Map();
  const executeCommandCalls = [];
  const spawnCalls = [];
  const killCalls = [];
  const queuedResults = [];
  const inputQueue = [];
  const quickPickQueue = [];
  const treeViews = [];
  const treeProviders = [];
  const statusBarItems = [];
  const openedDocuments = [];
  const clipboardWrites = [];
  const editorHandlers = [];
  const workspaceHandlers = [];

  const resolveWorkspaceFolderPath = (folder) => {
    if (!folder) return null;
    if (folder.path) return path.resolve(folder.path);
    if (repoRoot && folder.relativePath != null) {
      return path.resolve(repoRoot, folder.relativePath);
    }
    return null;
  };

  const buildWorkspaceFolders = (folders) => (
    folders.map((folder, index) => {
      const folderPath = resolveWorkspaceFolderPath(folder);
      return {
        name: folder.name || path.basename(folderPath || `workspace-${index + 1}`),
        uri: normalizeFileUri(folderPath)
      };
    })
  );

  const defaultActiveEditor = activeFile
    ? { document: { uri: normalizeFileUri(path.resolve(activeFile)) } }
    : null;

  const fakeVscode = {
    workspace: {
      workspaceFolders: buildWorkspaceFolders(workspaceFolders),
      getWorkspaceFolder(uri) {
        return this.workspaceFolders.find((folder) => uri?.fsPath?.startsWith(folder.uri.fsPath)) || null;
      },
      getConfiguration() {
        return createFakeConfiguration(normalizedConfig);
      },
      async openTextDocument(uri) {
        const document = { uri };
        openedDocuments.push(document);
        return document;
      },
      onDidChangeWorkspaceFolders(handler) {
        workspaceHandlers.push(handler);
        return { dispose() {} };
      }
    },
    window: {
      activeTextEditor: activeEditor || defaultActiveEditor,
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
        openedDocuments.push(document);
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
        return createTrackedStatusBarItem(statusBarItems);
      },
      createTreeView(id, options) {
        treeViews.push({ id, options });
        treeProviders.push(options.treeDataProvider);
        return { dispose() {} };
      },
      onDidChangeActiveTextEditor(handler) {
        editorHandlers.push(handler);
        return { dispose() {} };
      }
    },
    commands: {
      registerCommand(id, handler) {
        registeredCommands.set(id, handler);
        return { dispose() {} };
      },
      async executeCommand(id, arg) {
        executeCommandCalls.push({ id, arg });
      }
    },
    env: {
      async openExternal(uri) {
        openExternalCalls.push(uri);
        return true;
      },
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
        }
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
      file: normalizeFileUri
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
    fakeChildProcess: createFakeSpawn(spawnCalls, queuedResults, killCalls)
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
    clipboardWrites,
    registeredCommands,
    executeCommandCalls,
    spawnCalls,
    killCalls,
    queuedResults,
    inputQueue,
    quickPickQueue,
    treeViews,
    treeProviders,
    statusBarItems,
    openedDocuments,
    workspaceStateStore,
    activate() {
      extension.activate(context);
    },
    resolvePath(...segments) {
      if (!repoRoot) throw new Error('resolvePath requires repoRoot');
      return path.join(repoRoot, ...segments);
    },
    setActiveEditor(editor) {
      fakeVscode.window.activeTextEditor = editor;
      for (const handler of editorHandlers) handler(editor);
    },
    setActiveFile(filePath) {
      const nextEditor = filePath
        ? { document: { uri: normalizeFileUri(path.resolve(filePath)) } }
        : null;
      this.setActiveEditor(nextEditor);
    },
    setWorkspaceFolders(folders) {
      fakeVscode.workspace.workspaceFolders = buildWorkspaceFolders(folders);
      const event = {
        added: fakeVscode.workspace.workspaceFolders,
        removed: []
      };
      for (const handler of workspaceHandlers) handler(event);
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
