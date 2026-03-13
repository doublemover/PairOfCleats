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

function createRepo(rootName) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${rootName}-`));
  fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'tools', 'config'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(repoRoot, 'tools', 'config', 'dump.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n');
  return repoRoot;
}

const repoA = createRepo('poc-vscode-session-a');
const repoB = createRepo('poc-vscode-session-b');
const configValues = {
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
  env: {}
};

const outputEvents = [];
const infoMessages = [];
const errorMessages = [];
const spawnCalls = [];
const queuedResults = [];
const quickPickQueue = [];
const registeredCommands = new Map();
const editorHandlers = [];
const workspaceHandlers = [];
const workspaceStateStore = new Map();
workspaceStateStore.set('pairofcleats.workflowSessions', [
  {
    sessionId: 'stale-running-session',
    commandId: 'pairofcleats.configDump',
    title: 'PairOfCleats: Config Dump',
    repoRoot: repoA,
    status: 'running',
    startedAt: '2026-03-12T00:00:00.000Z',
    invocation: {
      kind: 'operator',
      command: process.execPath,
      args: [path.join(repoA, 'tools', 'config', 'dump.js'), '--json', '--repo', repoA],
      timeoutMs: 60000
    }
  }
]);
const statusBar = {
  text: '',
  tooltip: '',
  command: '',
  shown: 0,
  show() {
    this.shown += 1;
  },
  hide() {},
  dispose() {}
};

const fakeVscode = {
  workspace: {
    workspaceFolders: [
      { name: 'repo-a', uri: { scheme: 'file', fsPath: repoA, path: repoA.replace(/\\/g, '/') } },
      { name: 'repo-b', uri: { scheme: 'file', fsPath: repoB, path: repoB.replace(/\\/g, '/') } }
    ],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => folder.uri.fsPath === uri?.fsPath || uri?.fsPath?.startsWith(`${folder.uri.fsPath}${path.sep}`)) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    },
    onDidChangeWorkspaceFolders(handler) {
      workspaceHandlers.push(handler);
      return { dispose() {} };
    },
    workspaceState: null
  },
  window: {
    activeTextEditor: { document: { uri: { scheme: 'file', fsPath: path.join(repoA, 'src', 'app.ts') } } },
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return { dispose() {} };
        }
      };
      return task({}, token);
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
      return statusBar;
    },
    onDidChangeActiveTextEditor(handler) {
      editorHandlers.push(handler);
      return { dispose() {} };
    }
  },
  commands: {
    registerCommand(id, handler) {
      registeredCommands.set(id, handler);
      return { id, handler, dispose() {} };
    }
  },
  Uri: {
    file(fsPath) {
      return { scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') };
    }
  },
  StatusBarAlignment: {
    Left: 1
  },
  ProgressLocation: {
    Notification: 1
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
await new Promise((resolve) => setImmediate(resolve));

for (const commandId of [
  'pairofcleats.showWorkflowStatus',
  'pairofcleats.rerunLastWorkflow',
  'pairofcleats.showRecentWorkflows'
]) {
  assert.ok(registeredCommands.has(commandId), `missing registered command ${commandId}`);
}

let storedSessions = workspaceStateStore.get('pairofcleats.workflowSessions');
assert.equal(storedSessions[0].status, 'interrupted');
assert.match(statusBar.text, /PairOfCleats: .*interrupted/i);
assert.equal(statusBar.command, 'pairofcleats.showWorkflowStatus');

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot: repoA,
    policy: { quality: { value: 'max', source: 'config' } },
    derived: { cacheRoot: path.join(repoA, '.cache'), repoCacheRoot: path.join(repoA, '.cache', 'repo') }
  })
});
await registeredCommands.get('pairofcleats.configDump')();
assert.equal(infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
storedSessions = workspaceStateStore.get('pairofcleats.workflowSessions');
assert.equal(storedSessions[0].status, 'succeeded');
assert.equal(storedSessions[0].repoRoot, repoA);
assert.equal(storedSessions[0].commandId, 'pairofcleats.configDump');
assert.deepEqual(
  storedSessions[0].invocation.args,
  [path.join(repoA, 'tools', 'config', 'dump.js'), '--json', '--repo', repoA]
);
assert.match(statusBar.text, /PairOfCleats: .*succeeded/i);

fakeVscode.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: path.join(repoB, 'src', 'app.ts') } } };
for (const handler of editorHandlers) {
  handler(fakeVscode.window.activeTextEditor);
}
assert.equal(statusBar.text, `PairOfCleats: ${path.basename(repoB)}`);

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot: repoA,
    policy: { quality: { value: 'max', source: 'config' } },
    derived: { cacheRoot: path.join(repoA, '.cache'), repoCacheRoot: path.join(repoA, '.cache', 'repo') }
  })
});
await registeredCommands.get('pairofcleats.rerunLastWorkflow')();
assert.equal(infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
assert.deepEqual(spawnCalls[1].args, spawnCalls[0].args);

quickPickQueue.push((items) => items.find((item) => item.action === 'output'));
await registeredCommands.get('pairofcleats.showWorkflowStatus')();
assert.ok(outputEvents.some((event) => event.kind === 'show'));

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot: repoA,
    policy: { quality: { value: 'max', source: 'config' } },
    derived: { cacheRoot: path.join(repoA, '.cache'), repoCacheRoot: path.join(repoA, '.cache', 'repo') }
  })
});
quickPickQueue.push((items) => items.find((item) => item.session));
await registeredCommands.get('pairofcleats.showRecentWorkflows')();
assert.equal(infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
assert.deepEqual(spawnCalls[2].args, spawnCalls[0].args);
assert.equal(errorMessages.length, 0, `unexpected errors: ${errorMessages.join('; ')}`);

console.log('vscode session runtime test passed');
