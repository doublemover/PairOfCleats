const vscode = require('vscode');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveWindowsCmdInvocation } = require('./windows-cmd.js');
const { readSearchOptions, buildSearchArgs, collectSearchHits } = require('./search-contract.js');
const {
  DEFAULT_MAX_BUFFER_BYTES,
  createChunkAccumulator,
  resolveConfiguredCli,
  parseJsonPayload,
  parseSearchPayload,
  summarizeProcessFailure,
  openSearchHit
} = require('./runtime.js');

const DEFAULT_EDITOR_CONFIG_CONTRACT = Object.freeze({
  schemaVersion: 1,
  repoRoot: {
    markers: ['.pairofcleats.json', '.git'],
    vscode: {
      walkUpFromWorkspaceFolder: false
    },
    sublime: {
      walkUpFromHints: true
    }
  },
  cli: {
    defaultCommand: 'pairofcleats',
    repoRelativeEntrypoint: 'bin/pairofcleats.js',
    jsEntrypointExtension: '.js'
  },
  settings: {
    vscode: {
      namespace: 'pairofcleats',
      cliPathKey: 'cliPath',
      cliArgsKey: 'cliArgs',
      extraSearchArgsKey: 'extraSearchArgs',
      modeKey: 'searchMode',
      backendKey: 'searchBackend',
      annKey: 'searchAnn',
      maxResultsKey: 'maxResults',
      contextLinesKey: 'searchContextLines',
      fileKey: 'searchFile',
      pathKey: 'searchPath',
      langKey: 'searchLang',
      extKey: 'searchExt',
      typeKey: 'searchType',
      caseSensitiveKey: 'searchCaseSensitive',
      envKey: 'env'
    },
    sublime: {
      cliPathKey: 'pairofcleats_path',
      nodePathKey: 'node_path',
      envKey: 'env'
    }
  },
  env: {
    mergeOrder: ['process', 'settings'],
    stringifyValues: true
  }
});

const DEFAULT_VSCODE_SETTINGS = Object.freeze(DEFAULT_EDITOR_CONFIG_CONTRACT.settings.vscode);

/**
 * Load editor config contract from docs, falling back to embedded defaults.
 *
 * @returns {object}
 */
function loadEditorConfigContract() {
  const contractPath = path.resolve(
    __dirname,
    '..',
    '..',
    'docs',
    'tooling',
    'editor-config-contract.json'
  );
  try {
    const loaded = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    if (loaded && typeof loaded === 'object') {
      return loaded;
    }
  } catch {}
  return DEFAULT_EDITOR_CONFIG_CONTRACT;
}

const EDITOR_CONFIG_CONTRACT = loadEditorConfigContract();

/**
 * Read nested contract value by path with fallback.
 *
 * @param {string[]} pathParts
 * @param {unknown} fallback
 * @returns {unknown}
 */
function readContract(pathParts, fallback) {
  let current = EDITOR_CONFIG_CONTRACT;
  for (const key of pathParts) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }
  return current === undefined ? fallback : current;
}

const VSCODE_SETTINGS = Object.freeze({
  namespace: String(readContract(['settings', 'vscode', 'namespace'], DEFAULT_VSCODE_SETTINGS.namespace)),
  cliPathKey: String(readContract(['settings', 'vscode', 'cliPathKey'], DEFAULT_VSCODE_SETTINGS.cliPathKey)),
  cliArgsKey: String(readContract(['settings', 'vscode', 'cliArgsKey'], DEFAULT_VSCODE_SETTINGS.cliArgsKey)),
  extraSearchArgsKey: String(readContract(
    ['settings', 'vscode', 'extraSearchArgsKey'],
    DEFAULT_VSCODE_SETTINGS.extraSearchArgsKey
  )),
  modeKey: String(readContract(['settings', 'vscode', 'modeKey'], DEFAULT_VSCODE_SETTINGS.modeKey)),
  backendKey: String(readContract(['settings', 'vscode', 'backendKey'], DEFAULT_VSCODE_SETTINGS.backendKey)),
  annKey: String(readContract(['settings', 'vscode', 'annKey'], DEFAULT_VSCODE_SETTINGS.annKey)),
  maxResultsKey: String(readContract(['settings', 'vscode', 'maxResultsKey'], DEFAULT_VSCODE_SETTINGS.maxResultsKey)),
  contextLinesKey: String(readContract(
    ['settings', 'vscode', 'contextLinesKey'],
    DEFAULT_VSCODE_SETTINGS.contextLinesKey
  )),
  fileKey: String(readContract(['settings', 'vscode', 'fileKey'], DEFAULT_VSCODE_SETTINGS.fileKey)),
  pathKey: String(readContract(['settings', 'vscode', 'pathKey'], DEFAULT_VSCODE_SETTINGS.pathKey)),
  langKey: String(readContract(['settings', 'vscode', 'langKey'], DEFAULT_VSCODE_SETTINGS.langKey)),
  extKey: String(readContract(['settings', 'vscode', 'extKey'], DEFAULT_VSCODE_SETTINGS.extKey)),
  typeKey: String(readContract(['settings', 'vscode', 'typeKey'], DEFAULT_VSCODE_SETTINGS.typeKey)),
  caseSensitiveKey: String(readContract(
    ['settings', 'vscode', 'caseSensitiveKey'],
    DEFAULT_VSCODE_SETTINGS.caseSensitiveKey
  )),
  envKey: String(readContract(['settings', 'vscode', 'envKey'], DEFAULT_VSCODE_SETTINGS.envKey))
});

const CLI_DEFAULT_COMMAND = String(readContract(
  ['cli', 'defaultCommand'],
  DEFAULT_EDITOR_CONFIG_CONTRACT.cli.defaultCommand
));
const CLI_REPO_ENTRYPOINT = String(readContract(
  ['cli', 'repoRelativeEntrypoint'],
  DEFAULT_EDITOR_CONFIG_CONTRACT.cli.repoRelativeEntrypoint
));
const CLI_REPO_ENTRYPOINT_PARTS = CLI_REPO_ENTRYPOINT.split(/[\\/]+/).filter(Boolean);
const CLI_JS_EXTENSION = String(readContract(
  ['cli', 'jsEntrypointExtension'],
  DEFAULT_EDITOR_CONFIG_CONTRACT.cli.jsEntrypointExtension
)).toLowerCase();
const WORKFLOW_SESSION_STORAGE_KEY = 'pairofcleats.workflowSessions';
const MAX_WORKFLOW_SESSIONS = 20;

const REPO_MARKERS_RAW = readContract(['repoRoot', 'markers'], DEFAULT_EDITOR_CONFIG_CONTRACT.repoRoot.markers);
const REPO_MARKERS = Array.isArray(REPO_MARKERS_RAW)
  ? REPO_MARKERS_RAW.map((value) => String(value)).filter(Boolean)
  : DEFAULT_EDITOR_CONFIG_CONTRACT.repoRoot.markers;
const VSCODE_REPO_WALKUP = readContract(['repoRoot', 'vscode', 'walkUpFromWorkspaceFolder'], false) === true;
const VALID_ENV_SOURCES = new Set(['process', 'settings']);

/**
 * Normalize env merge order to valid unique sources.
 *
 * @param {unknown} order
 * @returns {string[]}
 */
function normalizeEnvMergeOrder(order) {
  const normalized = [];
  if (Array.isArray(order)) {
    for (const value of order) {
      const key = String(value || '').trim().toLowerCase();
      if (!VALID_ENV_SOURCES.has(key)) continue;
      if (normalized.includes(key)) continue;
      normalized.push(key);
    }
  }
  return normalized.length > 0 ? normalized : ['process', 'settings'];
}

const VSCODE_ENV_MERGE_ORDER = Object.freeze(normalizeEnvMergeOrder(
  readContract(['env', 'mergeOrder'], DEFAULT_EDITOR_CONFIG_CONTRACT.env.mergeOrder)
));
const VSCODE_ENV_STRINGIFY_VALUES = readContract(
  ['env', 'stringifyValues'],
  DEFAULT_EDITOR_CONFIG_CONTRACT.env.stringifyValues
) !== false;

/**
 * Normalize settings values that are expected to be arrays of strings.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/**
 * Return extension-scoped workspace configuration.
 *
 * @returns {import('vscode').WorkspaceConfiguration}
 */
function getExtensionConfiguration() {
  return vscode.workspace.getConfiguration(VSCODE_SETTINGS.namespace);
}

/**
 * Check whether one directory matches any repository root marker.
 *
 * @param {string} candidatePath
 * @returns {boolean}
 */
function hasRepoMarker(candidatePath) {
  return REPO_MARKERS.some((marker) => fs.existsSync(path.join(candidatePath, marker)));
}

/**
 * Walk upward from a start path to find the nearest repository root marker.
 *
 * @param {string|null|undefined} startPath
 * @returns {string|null}
 */
function findRepoRoot(startPath) {
  if (!startPath) return null;
  let candidate = path.resolve(startPath);
  while (true) {
    if (hasRepoMarker(candidate)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return null;
}

/**
 * Resolve repository root for current workspace settings.
 *
 * @returns {string|null}
 */
async function resolveRepoContext() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    return {
      ok: false,
      kind: 'no-workspace',
      message: 'PairOfCleats: open a workspace to search.'
    };
  }
  const activeUri = vscode.window.activeTextEditor?.document?.uri || null;
  const activeFolder = activeUri && typeof vscode.workspace.getWorkspaceFolder === 'function'
    ? vscode.workspace.getWorkspaceFolder(activeUri)
    : null;
  let selectedFolder = activeFolder || null;
  if (!selectedFolder && folders.length === 1) {
    selectedFolder = folders[0];
  }
  if (!selectedFolder) {
    const picked = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name || folder.uri?.fsPath || folder.uri?.path || String(folder.uri),
        description: folder.uri?.fsPath || folder.uri?.path || folder.uri?.scheme || '',
        folder
      })),
      {
        title: 'PairOfCleats workspace',
        placeHolder: 'Select the workspace folder to search'
      }
    );
    if (!picked) {
      return { ok: false, kind: 'cancelled', message: null };
    }
    selectedFolder = picked.folder;
  }
  const repoUri = selectedFolder?.uri || null;
  const repoScheme = String(repoUri?.scheme || 'file');
  if (repoScheme !== 'file') {
    return {
      ok: false,
      kind: 'unsupported-workspace',
      message: `PairOfCleats search only supports local file workspaces right now (got ${repoScheme}:).`,
      detail: 'Open a local checkout or run the CLI directly for remote workspaces.'
    };
  }
  const workspacePath = repoUri?.fsPath || null;
  if (!workspacePath) {
    return {
      ok: false,
      kind: 'unsupported-workspace',
      message: 'PairOfCleats could not resolve a local filesystem path for the selected workspace.',
      detail: 'Open a local file-based workspace or run the CLI directly.'
    };
  }
  const repoRoot = VSCODE_REPO_WALKUP ? (findRepoRoot(workspacePath) || workspacePath) : workspacePath;
  return {
    ok: true,
    repoRoot,
    repoUri,
    workspaceFolder: selectedFolder,
    source: activeFolder ? 'active-editor' : (folders.length === 1 ? 'single-workspace' : 'workspace-picker')
  };
}

/**
 * Resolve CLI executable + argument prefix from extension settings and repo.
 *
 * @param {string|null} repoRoot
 * @param {import('vscode').WorkspaceConfiguration} config
 * @returns {{command:string,argsPrefix:string[]}}
 */
function resolveCli(repoRoot, config) {
  const configuredPath = String(config.get(VSCODE_SETTINGS.cliPathKey) || '').trim();
  const extraArgs = normalizeStringArray(config.get(VSCODE_SETTINGS.cliArgsKey));

  if (configuredPath) {
    return resolveConfiguredCli(repoRoot, configuredPath, extraArgs, {
      command: CLI_DEFAULT_COMMAND,
      jsExtension: CLI_JS_EXTENSION
    });
  }

  if (repoRoot) {
    const localCli = path.join(repoRoot, ...CLI_REPO_ENTRYPOINT_PARTS);
    if (fs.existsSync(localCli)) {
      return { ok: true, command: process.execPath, argsPrefix: [localCli, ...extraArgs] };
    }
  }

  return { ok: true, command: CLI_DEFAULT_COMMAND, argsPrefix: extraArgs };
}

/**
 * Build child-process env from configured merge order (`process` + settings).
 *
 * @param {import('vscode').WorkspaceConfiguration} config
 * @returns {Record<string,string>}
 */
function buildSpawnEnv(config) {
  const extraEnv = config.get(VSCODE_SETTINGS.envKey);
  const settingsEnv = extraEnv && typeof extraEnv === 'object' && !Array.isArray(extraEnv)
    ? extraEnv
    : null;
  const env = {};
  for (const source of VSCODE_ENV_MERGE_ORDER) {
    if (source === 'process') {
      Object.assign(env, process.env);
      continue;
    }
    if (source === 'settings' && settingsEnv) {
      for (const [key, value] of Object.entries(settingsEnv)) {
        if (!key) continue;
        const normalizedValue = VSCODE_ENV_STRINGIFY_VALUES ? String(value) : value;
        if (normalizedValue === undefined) continue;
        env[String(key)] = normalizedValue;
      }
    }
  }
  return env;
}

function formatRepoLabel(repoRoot) {
  const normalized = String(repoRoot || '').trim();
  if (!normalized) return 'no repo';
  return path.basename(normalized) || normalized;
}

function buildRepoSnapshot(repoContext) {
  if (!repoContext?.repoRoot) return null;
  return {
    repoRoot: repoContext.repoRoot,
    repoLabel: formatRepoLabel(repoContext.repoRoot),
    workspacePath: repoContext?.workspaceFolder?.uri?.fsPath || repoContext.repoRoot
  };
}

function normalizeWorkflowSession(rawSession) {
  if (!rawSession || typeof rawSession !== 'object') return null;
  const sessionId = String(rawSession.sessionId || '').trim();
  const commandId = String(rawSession.commandId || '').trim();
  const title = String(rawSession.title || '').trim();
  const repoRoot = String(rawSession.repoRoot || '').trim();
  if (!sessionId || !commandId || !title || !repoRoot) return null;
  const status = new Set(['running', 'succeeded', 'failed', 'cancelled', 'interrupted']).has(rawSession.status)
    ? rawSession.status
    : 'failed';
  const invocation = rawSession.invocation && typeof rawSession.invocation === 'object'
    ? {
      kind: String(rawSession.invocation.kind || 'operator'),
      command: String(rawSession.invocation.command || '').trim(),
      args: Array.isArray(rawSession.invocation.args) ? rawSession.invocation.args.map((value) => String(value)) : [],
      timeoutMs: Number.isFinite(rawSession.invocation.timeoutMs) ? rawSession.invocation.timeoutMs : 60000
    }
    : null;
  return {
    sessionId,
    commandId,
    title,
    repoRoot,
    repoLabel: formatRepoLabel(repoRoot),
    status,
    startedAt: String(rawSession.startedAt || ''),
    finishedAt: rawSession.finishedAt ? String(rawSession.finishedAt) : null,
    summaryLine: rawSession.summaryLine ? String(rawSession.summaryLine) : '',
    outputHint: rawSession.outputHint ? String(rawSession.outputHint) : '',
    invocation
  };
}

function normalizeWorkflowSessions(rawSessions) {
  return Array.isArray(rawSessions)
    ? rawSessions.map((entry) => normalizeWorkflowSession(entry)).filter(Boolean).slice(0, MAX_WORKFLOW_SESSIONS)
    : [];
}

function readWorkspaceState(key, fallback) {
  return extensionContext?.workspaceState?.get?.(key, fallback) ?? fallback;
}

async function writeWorkspaceState(key, value) {
  if (typeof extensionContext?.workspaceState?.update !== 'function') return;
  await extensionContext.workspaceState.update(key, value);
}

async function persistWorkflowSessions() {
  workflowSessions = workflowSessions.slice(0, MAX_WORKFLOW_SESSIONS);
  await writeWorkspaceState(WORKFLOW_SESSION_STORAGE_KEY, workflowSessions);
}

function getMostRecentWorkflowSession() {
  return workflowSessions[0] || null;
}

function getMostRecentRunningWorkflowSession() {
  return workflowSessions.find((session) => session.status === 'running') || null;
}

function resolvePassiveRepoContext() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    return { ok: false, kind: 'no-workspace', repoLabel: 'no repo' };
  }
  const activeUri = vscode.window.activeTextEditor?.document?.uri || null;
  const activeFolder = activeUri && typeof vscode.workspace.getWorkspaceFolder === 'function'
    ? vscode.workspace.getWorkspaceFolder(activeUri)
    : null;
  let selectedFolder = activeFolder || null;
  if (!selectedFolder && lastWorkflowRepoSnapshot?.workspacePath) {
    selectedFolder = folders.find((folder) => folder?.uri?.fsPath === lastWorkflowRepoSnapshot.workspacePath) || null;
  }
  if (!selectedFolder && folders.length === 1) {
    selectedFolder = folders[0];
  }
  if (!selectedFolder) {
    return {
      ok: false,
      kind: 'ambiguous-workspace',
      repoLabel: `${folders.length} workspaces`
    };
  }
  const repoRoot = VSCODE_REPO_WALKUP
    ? (findRepoRoot(selectedFolder.uri?.fsPath || '') || selectedFolder.uri?.fsPath || '')
    : (selectedFolder.uri?.fsPath || '');
  if (!repoRoot) {
    return { ok: false, kind: 'unsupported-workspace', repoLabel: 'no repo' };
  }
  return {
    ok: true,
    repoRoot,
    repoLabel: formatRepoLabel(repoRoot),
    workspaceFolder: selectedFolder
  };
}

function updateWorkflowStatusBar() {
  if (!workflowStatusBar) return;
  const runningSession = getMostRecentRunningWorkflowSession();
  const passiveRepo = resolvePassiveRepoContext();
  if (runningSession) {
    workflowStatusBar.text = `PairOfCleats: ${runningSession.repoLabel} • ${runningSession.title.replace(/^PairOfCleats:\s*/, '')}`;
    workflowStatusBar.tooltip = `${runningSession.title}\n${runningSession.repoRoot}\nStatus: running`;
  } else if (passiveRepo.ok) {
    const lastSession = getMostRecentWorkflowSession();
    const suffix = lastSession && lastSession.repoRoot === passiveRepo.repoRoot && lastSession.status !== 'running'
      ? ` • ${lastSession.status}`
      : '';
    workflowStatusBar.text = `PairOfCleats: ${passiveRepo.repoLabel}${suffix}`;
    workflowStatusBar.tooltip = `${passiveRepo.repoRoot}${suffix ? `\nLast workflow: ${lastSession.title} (${lastSession.status})` : ''}`;
  } else {
    workflowStatusBar.text = `PairOfCleats: ${passiveRepo.repoLabel || 'no repo'}`;
    workflowStatusBar.tooltip = 'Open a repository workspace or focus an editor to establish PairOfCleats repo context.';
  }
  workflowStatusBar.command = 'pairofcleats.showWorkflowStatus';
  workflowStatusBar.show?.();
}

async function restoreWorkflowSessions() {
  workflowSessions = normalizeWorkflowSessions(readWorkspaceState(WORKFLOW_SESSION_STORAGE_KEY, []));
  let changed = false;
  for (const session of workflowSessions) {
    if (session.status !== 'running') continue;
    session.status = 'interrupted';
    session.finishedAt = new Date().toISOString();
    session.summaryLine = session.summaryLine || 'VS Code session ended before the workflow completed.';
    changed = true;
  }
  if (changed) {
    await persistWorkflowSessions();
  }
  updateWorkflowStatusBar();
}

function noteRepoContext(repoContext) {
  lastWorkflowRepoSnapshot = buildRepoSnapshot(repoContext);
  updateWorkflowStatusBar();
}

async function beginWorkflowSession(spec, repoContext, invocation) {
  noteRepoContext(repoContext);
  const session = {
    sessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    commandId: spec.id,
    title: spec.title,
    repoRoot: repoContext.repoRoot,
    repoLabel: formatRepoLabel(repoContext.repoRoot),
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summaryLine: '',
    outputHint: 'PairOfCleats output',
    invocation: invocation
      ? {
        kind: 'operator',
        command: invocation.command,
        args: invocation.args.map((value) => String(value)),
        timeoutMs: spec.timeoutMs
      }
      : null
  };
  workflowSessions = [session, ...workflowSessions.filter((entry) => entry.sessionId !== session.sessionId)].slice(0, MAX_WORKFLOW_SESSIONS);
  await persistWorkflowSessions();
  updateWorkflowStatusBar();
  return session;
}

async function finishWorkflowSession(sessionId, patch) {
  const session = workflowSessions.find((entry) => entry.sessionId === sessionId);
  if (!session) return;
  if (patch.status) session.status = patch.status;
  if (patch.summaryLine !== undefined) session.summaryLine = patch.summaryLine || '';
  if (patch.outputHint !== undefined) session.outputHint = patch.outputHint || '';
  session.finishedAt = new Date().toISOString();
  await persistWorkflowSessions();
  updateWorkflowStatusBar();
}

async function rerunWorkflowSession(session) {
  if (!session?.invocation?.command || !Array.isArray(session?.invocation?.args)) {
    vscode.window.showErrorMessage('PairOfCleats cannot rerun that workflow because its invocation was not preserved.');
    return;
  }
  const spec = OPERATOR_COMMANDS_BY_ID.get(session.commandId) || {
    id: session.commandId,
    title: session.title,
    progressTitle: session.title,
    timeoutMs: session.invocation.timeoutMs || 60000
  };
  const repoContext = {
    ok: true,
    repoRoot: session.repoRoot,
    workspaceFolder: { uri: vscode.Uri.file(session.repoRoot) }
  };
  return executeOperatorWorkflow(spec, repoContext, {
    command: session.invocation.command,
    args: session.invocation.args.slice()
  });
}

async function showRecentWorkflows() {
  const sessions = workflowSessions.slice(0, 10);
  if (!sessions.length || typeof vscode.window.showQuickPick !== 'function') {
    vscode.window.showInformationMessage('PairOfCleats has no recent workflows to show.');
    return;
  }
  const selection = await vscode.window.showQuickPick(
    sessions.map((session) => ({
      label: `${session.title} (${session.status})`,
      description: session.repoLabel,
      detail: session.summaryLine || session.finishedAt || session.startedAt,
      session
    })),
    {
      title: 'PairOfCleats recent workflows',
      placeHolder: 'Select a workflow to rerun'
    }
  );
  if (!selection?.session) return;
  await rerunWorkflowSession(selection.session);
}

async function showWorkflowStatus() {
  const items = [
    {
      label: 'Reopen PairOfCleats output',
      description: 'Show the output channel',
      action: 'output'
    }
  ];
  if (getMostRecentWorkflowSession()) {
    items.push({
      label: 'Rerun last workflow',
      description: getMostRecentWorkflowSession().title,
      action: 'rerun-last'
    });
    items.push({
      label: 'Show recent workflows',
      description: `${Math.min(workflowSessions.length, 10)} saved session(s)`,
      action: 'recent'
    });
  }
  const selection = typeof vscode.window.showQuickPick === 'function'
    ? await vscode.window.showQuickPick(items, {
      title: 'PairOfCleats workflow status',
      placeHolder: 'Choose an action'
    })
    : null;
  if (!selection) return;
  if (selection.action === 'output') {
    getOutputChannel().show?.(true);
    return;
  }
  if (selection.action === 'rerun-last') {
    const session = getMostRecentWorkflowSession();
    if (!session) {
      vscode.window.showInformationMessage('PairOfCleats has no workflow to rerun.');
      return;
    }
    await rerunWorkflowSession(session);
    return;
  }
  if (selection.action === 'recent') {
    await showRecentWorkflows();
  }
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveRelativeActiveFile(repoContext) {
  const activeUri = vscode.window.activeTextEditor?.document?.uri || null;
  if (!activeUri || activeUri.scheme !== 'file' || !activeUri.fsPath || !repoContext?.repoRoot) {
    return '';
  }
  const rel = path.relative(repoContext.repoRoot, activeUri.fsPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return toPosixPath(rel);
}

async function promptTextInput(options) {
  if (typeof vscode.window.showInputBox !== 'function') return null;
  const value = await vscode.window.showInputBox(options);
  if (value === undefined) return null;
  return String(value).trim();
}

async function promptRulesPath(repoContext) {
  const defaultValue = fs.existsSync(path.join(repoContext.repoRoot, 'architecture.rules.json'))
    ? path.join(repoContext.repoRoot, 'architecture.rules.json')
    : '';
  const value = await promptTextInput({
    prompt: 'Path to architecture rules file',
    placeHolder: 'e.g. architecture.rules.json',
    value: defaultValue
  });
  if (!value) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoContext.repoRoot, value);
}

async function promptWorkspaceConfigPath(repoContext) {
  const workspaceRoot = repoContext?.workspaceFolder?.uri?.fsPath || repoContext?.repoRoot || '';
  const defaultValue = path.join(workspaceRoot, '.pairofcleats-workspace.jsonc');
  const value = await promptTextInput({
    prompt: 'Workspace config path',
    placeHolder: '.pairofcleats-workspace.jsonc',
    value: defaultValue
  });
  if (!value) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function parseDelimitedPaths(rawValue) {
  return String(rawValue || '')
    .split(/[\r\n,]+/)
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) => toPosixPath(entry));
}

async function promptChangedPaths(repoContext, {
  prompt,
  title,
  fallbackActiveFile = true
} = {}) {
  const activeFile = fallbackActiveFile ? resolveRelativeActiveFile(repoContext) : '';
  const value = await promptTextInput({
    title,
    prompt,
    placeHolder: 'src/file.js, src/other.js',
    value: activeFile
  });
  if (!value) return null;
  return parseDelimitedPaths(value);
}

async function promptPositiveInteger({
  prompt,
  value,
  placeHolder
}) {
  const raw = await promptTextInput({
    prompt,
    placeHolder,
    value: String(value)
  });
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    vscode.window.showErrorMessage(`PairOfCleats expected a positive integer, got "${raw}".`);
    return null;
  }
  return Math.max(1, Math.floor(parsed));
}

async function promptImpactInput(repoContext) {
  const activeFile = resolveRelativeActiveFile(repoContext);
  const seed = await promptTextInput({
    prompt: 'Impact seed ref (optional). Leave empty to use changed paths.',
    placeHolder: 'e.g. file:src/app.ts or chunk:chunkUid',
    value: ''
  });
  let changed = [];
  if (!seed) {
    const changedValue = await promptChangedPaths(repoContext, {
      prompt: 'Changed paths for impact analysis',
      title: 'PairOfCleats impact',
      fallbackActiveFile: true
    });
    if (!changedValue || !changedValue.length) return null;
    changed = changedValue;
  }
  const direction = await vscode.window.showQuickPick(
    [
      { label: 'Downstream', value: 'downstream' },
      { label: 'Upstream', value: 'upstream' }
    ],
    {
      title: 'PairOfCleats impact direction',
      placeHolder: 'Select traversal direction'
    }
  );
  if (!direction) return null;
  const depth = await promptPositiveInteger({
    prompt: 'Impact traversal depth',
    value: 2,
    placeHolder: '2'
  });
  if (!depth) return null;
  return {
    seed: seed || '',
    changed,
    direction: direction.value,
    depth,
    activeFile
  };
}

async function promptSuggestTestsInput(repoContext) {
  const changed = await promptChangedPaths(repoContext, {
    prompt: 'Changed paths for suggest-tests',
    title: 'PairOfCleats suggest-tests',
    fallbackActiveFile: true
  });
  if (!changed || !changed.length) return null;
  const maxSuggestions = await promptPositiveInteger({
    prompt: 'Maximum suggested tests',
    value: 10,
    placeHolder: '10'
  });
  if (!maxSuggestions) return null;
  return {
    changed,
    maxSuggestions
  };
}

const OPERATOR_COMMAND_SPECS = Object.freeze([
  {
    id: 'pairofcleats.setup',
    title: 'PairOfCleats: Setup',
    progressTitle: 'PairOfCleats setup',
    timeoutMs: 10 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['setup'],
    buildArgs(repoRoot) {
      return ['--json', '--non-interactive', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.bootstrap',
    title: 'PairOfCleats: Bootstrap',
    progressTitle: 'PairOfCleats bootstrap',
    timeoutMs: 10 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['bootstrap'],
    buildArgs(repoRoot) {
      return ['--json', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.doctor',
    title: 'PairOfCleats: Tooling Doctor',
    progressTitle: 'PairOfCleats tooling doctor',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['tooling', 'doctor'],
    buildArgs(repoRoot) {
      return ['--json', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.configDump',
    title: 'PairOfCleats: Config Dump',
    progressTitle: 'PairOfCleats config dump',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'script',
    scriptParts: ['tools', 'config', 'dump.js'],
    buildArgs(repoRoot) {
      return ['--json', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.indexHealth',
    title: 'PairOfCleats: Index Health',
    progressTitle: 'PairOfCleats index health',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'script',
    scriptParts: ['tools', 'index', 'report-artifacts.js'],
    buildArgs(repoRoot) {
      return ['--json', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.codeMap',
    title: 'PairOfCleats: Code Map',
    progressTitle: 'PairOfCleats code map',
    timeoutMs: 5 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['report', 'map'],
    buildArgs(repoRoot) {
      return [
        '--json',
        '--repo',
        repoRoot,
        '--format',
        'html-iso',
        '--out',
        path.join(repoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html')
      ];
    }
  },
  {
    id: 'pairofcleats.architectureCheck',
    title: 'PairOfCleats: Architecture Check',
    progressTitle: 'PairOfCleats architecture check',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['architecture-check'],
    async resolveInput(repoContext) {
      const rulesPath = await promptRulesPath(repoContext);
      if (!rulesPath) return null;
      return { rulesPath };
    },
    buildArgs(repoRoot, inputContext) {
      return ['--json', '--repo', repoRoot, '--rules', inputContext.rulesPath];
    }
  },
  {
    id: 'pairofcleats.impact',
    title: 'PairOfCleats: Impact Analysis',
    progressTitle: 'PairOfCleats impact analysis',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['impact'],
    async resolveInput(repoContext) {
      return promptImpactInput(repoContext);
    },
    buildArgs(repoRoot, inputContext) {
      const args = [
        '--json',
        '--repo',
        repoRoot,
        '--direction',
        inputContext.direction,
        '--depth',
        String(inputContext.depth)
      ];
      if (inputContext.seed) {
        args.push('--seed', inputContext.seed);
      } else {
        for (const changed of inputContext.changed) {
          args.push('--changed', changed);
        }
      }
      return args;
    }
  },
  {
    id: 'pairofcleats.suggestTests',
    title: 'PairOfCleats: Suggest Tests',
    progressTitle: 'PairOfCleats suggest tests',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['suggest-tests'],
    async resolveInput(repoContext) {
      return promptSuggestTestsInput(repoContext);
    },
    buildArgs(repoRoot, inputContext) {
      const args = [
        '--json',
        '--repo',
        repoRoot,
        '--max',
        String(inputContext.maxSuggestions)
      ];
      for (const changed of inputContext.changed) {
        args.push('--changed', changed);
      }
      return args;
    }
  },
  {
    id: 'pairofcleats.workspaceManifest',
    title: 'PairOfCleats: Workspace Manifest',
    progressTitle: 'PairOfCleats workspace manifest',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['workspace', 'manifest'],
    async resolveInput(repoContext) {
      const workspacePath = await promptWorkspaceConfigPath(repoContext);
      if (!workspacePath) return null;
      return { workspacePath };
    },
    buildArgs(_repoRoot, inputContext) {
      return ['--json', '--workspace', inputContext.workspacePath];
    }
  },
  {
    id: 'pairofcleats.workspaceStatus',
    title: 'PairOfCleats: Workspace Status',
    progressTitle: 'PairOfCleats workspace status',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['workspace', 'status'],
    async resolveInput(repoContext) {
      const workspacePath = await promptWorkspaceConfigPath(repoContext);
      if (!workspacePath) return null;
      return { workspacePath };
    },
    buildArgs(_repoRoot, inputContext) {
      return ['--json', '--workspace', inputContext.workspacePath];
    }
  },
  {
    id: 'pairofcleats.workspaceBuild',
    title: 'PairOfCleats: Workspace Build',
    progressTitle: 'PairOfCleats workspace build',
    timeoutMs: 10 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['workspace', 'build'],
    async resolveInput(repoContext) {
      const workspacePath = await promptWorkspaceConfigPath(repoContext);
      if (!workspacePath) return null;
      const concurrency = await promptPositiveInteger({
        prompt: 'Workspace build concurrency',
        value: 2,
        placeHolder: '2'
      });
      if (!concurrency) return null;
      return { workspacePath, concurrency };
    },
    buildArgs(_repoRoot, inputContext) {
      return [
        '--json',
        '--workspace',
        inputContext.workspacePath,
        '--concurrency',
        String(inputContext.concurrency)
      ];
    }
  },
  {
    id: 'pairofcleats.workspaceCatalog',
    title: 'PairOfCleats: Workspace Catalog',
    progressTitle: 'PairOfCleats workspace catalog',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['workspace', 'catalog'],
    async resolveInput(repoContext) {
      const workspacePath = await promptWorkspaceConfigPath(repoContext);
      if (!workspacePath) return null;
      return { workspacePath };
    },
    buildArgs(_repoRoot, inputContext) {
      return ['--json', '--workspace', inputContext.workspacePath];
    }
  }
]);

const OPERATOR_COMMANDS_BY_ID = new Map(OPERATOR_COMMAND_SPECS.map((spec) => [spec.id, spec]));

function resolveOperatorInvocation(spec, repoContext, cliResolution, inputContext) {
  const repoRoot = repoContext.repoRoot;
  const extraArgs = typeof spec.buildArgs === 'function' ? spec.buildArgs(repoRoot, inputContext, repoContext) : [];
  if (spec.invocation === 'script') {
    const scriptPath = path.join(repoRoot, ...spec.scriptParts);
    if (!fs.existsSync(scriptPath)) {
      return {
        ok: false,
        message: `${spec.title} requires ${scriptPath}, but that file was not found in the selected repo.`,
        detail: 'Open a PairOfCleats checkout or use the CLI directly for this workspace.'
      };
    }
    return {
      ok: true,
      command: process.execPath,
      args: [scriptPath, ...extraArgs]
    };
  }
  return {
    ok: true,
    command: cliResolution.command,
    args: [...cliResolution.argsPrefix, ...spec.cliArgs, ...extraArgs]
  };
}

function appendOutputLines(output, lines) {
  for (const line of lines) {
    output.appendLine(line);
  }
}

function appendJsonBlock(output, payload) {
  const text = JSON.stringify(payload, null, 2);
  for (const line of text.split(/\r?\n/)) {
    output.appendLine(line);
  }
}

function formatStatusLabel(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === null || value === undefined || value === '') return 'n/a';
  return String(value);
}

function formatStepSummary(step) {
  if (!step || typeof step !== 'object') return 'n/a';
  const parts = [];
  if (step.skipped === true) parts.push('skipped');
  if ('ok' in step) parts.push(step.ok === true ? 'ok' : 'issues');
  if ('installed' in step) parts.push(step.installed ? 'installed' : 'not-installed');
  if ('built' in step) parts.push(step.built ? 'built' : 'not-built');
  if ('ready' in step) parts.push(step.ready ? 'ready' : 'not-ready');
  if ('restored' in step && step.restored) parts.push('restored');
  if ('present' in step) parts.push(`present=${formatStatusLabel(step.present)}`);
  if ('downloaded' in step && step.downloaded) parts.push('downloaded');
  if (Array.isArray(step.missing) && step.missing.length) parts.push(`missing=${step.missing.join(', ')}`);
  if (!parts.length) parts.push('ok');
  return parts.join(' | ');
}

function summarizeSetupLikePayload(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const stepEntries = Object.entries(payload?.steps || {});
  const lines = [
    `- status: ${errors.length ? 'issues' : 'ok'}`,
    `- repo: ${payload?.root || 'unknown'}`,
    `- incremental: ${payload?.incremental === true ? 'yes' : 'no'}`
  ];
  if ('restoredArtifacts' in (payload || {})) {
    lines.push(`- restored artifacts: ${payload?.restoredArtifacts === true ? 'yes' : 'no'}`);
  }
  if (stepEntries.length) {
    lines.push('- steps:');
    for (const [name, step] of stepEntries) {
      lines.push(`  - ${name}: ${formatStepSummary(step)}`);
    }
  }
  if (errors.length) {
    lines.push('- errors:');
    for (const error of errors) {
      lines.push(`  - ${error.step || 'unknown'}: ${error.message || error.status || 'failed'}`);
    }
  }
  lines.push('- next: PairOfCleats: Tooling Doctor');
  lines.push('- next: PairOfCleats: Index Health');
  return lines;
}

function summarizeDoctorPayload(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const warnCount = providers.filter((provider) => provider?.status === 'warn').length;
  const errorCount = providers.filter((provider) => provider?.status === 'error').length;
  const lines = [
    `- status: ${payload?.summary?.status || 'unknown'}`,
    `- repo: ${payload?.repoRoot || 'unknown'}`
  ];
  if (payload?.scm) {
    lines.push(`- scm: ${payload.scm.provider || 'unknown'} (${payload.scm.annotateEnabled ? 'annotate:on' : 'annotate:off'})`);
  }
  lines.push(`- providers: ${providers.length} total, ${warnCount} warn, ${errorCount} error`);
  lines.push(`- chunkUid: ${payload?.identity?.chunkUid?.available ? 'ok' : 'missing'}`);
  lines.push(`- xxhash: ${payload?.xxhash?.backend || 'unknown'}`);
  if (errorCount || warnCount) {
    lines.push('- next: review provider checks in the PairOfCleats output channel');
    lines.push('- next: rerun PairOfCleats: Setup or install missing tooling');
  } else {
    lines.push('- next: PairOfCleats tooling looks healthy');
  }
  return lines;
}

function summarizeConfigDumpPayload(payload) {
  const policy = payload?.policy || {};
  return [
    `- repo: ${payload?.repoRoot || 'unknown'}`,
    `- cache root: ${payload?.derived?.cacheRoot || 'unknown'}`,
    `- repo cache root: ${payload?.derived?.repoCacheRoot || 'unknown'}`,
    `- quality: ${policy?.quality?.value || 'unknown'} (${policy?.quality?.source || 'unknown'})`,
    `- mcp mode: ${payload?.derived?.mcp?.mode || 'unknown'} (${payload?.derived?.mcp?.modeSource || 'unknown'})`,
    `- mcp sdk: ${payload?.derived?.mcp?.sdkAvailable ? 'available' : 'missing'}`,
    '- next: adjust .pairofcleats.json or VS Code settings, then rerun this command'
  ];
}

function summarizeIndexHealthPayload(payload) {
  const lines = [
    `- status: ${(Array.isArray(payload?.health?.issues) && payload.health.issues.length) || payload?.corruption?.ok === false ? 'issues' : 'ok'}`,
    `- repo: ${payload?.repo?.root || 'unknown'}`,
    `- cache root: ${payload?.repo?.cacheRoot || 'unknown'}`,
    `- total cache bytes: ${payload?.repo?.totalBytes ?? 'n/a'}`
  ];
  if (payload?.repo?.sqlite) {
    lines.push(`- sqlite code: ${payload.repo.sqlite.code ? 'present' : 'missing'}`);
    lines.push(`- sqlite prose: ${payload.repo.sqlite.prose ? 'present' : 'missing'}`);
    lines.push(`- sqlite extracted-prose: ${payload.repo.sqlite.extractedProse ? 'present' : 'missing'}`);
    lines.push(`- sqlite records: ${payload.repo.sqlite.records ? 'present' : 'missing'}`);
  }
  if (payload?.corruption) {
    lines.push(`- integrity: ${payload.corruption.ok ? 'ok' : 'issues'}`);
  }
  if (Array.isArray(payload?.health?.issues) && payload.health.issues.length) {
    lines.push(`- health issues: ${payload.health.issues.length}`);
  }
  if (Array.isArray(payload?.health?.hints) && payload.health.hints.length) {
    for (const hint of payload.health.hints.slice(0, 3)) {
      lines.push(`- hint: ${hint}`);
    }
  }
  lines.push('- next: rerun PairOfCleats: Bootstrap or rebuild indexes if health is not ok');
  return lines;
}

function summarizeCodeMapPayload(payload) {
  const counts = payload?.summary?.counts || {};
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  return [
    `- status: ${warnings.length ? 'warnings' : 'ok'}`,
    `- format: ${payload?.format || 'unknown'}`,
    `- output: ${payload?.outPath || 'n/a'}`,
    `- files: ${counts.files ?? 0}`,
    `- members: ${counts.members ?? 0}`,
    `- edges: ${counts.edges ?? 0}`,
    `- warnings: ${warnings.length}`
  ];
}

function summarizeArchitecturePayload(payload) {
  const rules = Array.isArray(payload?.rules) ? payload.rules : [];
  const violations = Array.isArray(payload?.violations) ? payload.violations : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  return [
    `- status: ${violations.length ? 'violations' : 'ok'}`,
    `- rules: ${rules.length}`,
    `- violations: ${violations.length}`,
    `- warnings: ${warnings.length}`
  ];
}

function summarizeImpactPayload(payload) {
  const impacted = Array.isArray(payload?.impacted) ? payload.impacted : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const truncation = Array.isArray(payload?.truncation) ? payload.truncation : [];
  return [
    `- direction: ${payload?.direction || 'unknown'}`,
    `- depth: ${payload?.depth ?? 'n/a'}`,
    `- impacted: ${impacted.length}`,
    `- warnings: ${warnings.length}`,
    `- truncation: ${truncation.length}`
  ];
}

function summarizeSuggestTestsPayload(payload) {
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  return [
    `- suggestions: ${suggestions.length}`,
    `- top suggestion: ${suggestions[0]?.testPath || 'n/a'}`,
    `- warnings: ${warnings.length}`
  ];
}

function summarizeWorkspaceManifestPayload(payload) {
  return [
    `- workspace: ${payload?.workspacePath || 'unknown'}`,
    `- manifest: ${payload?.manifestPath || 'n/a'}`,
    `- repoSetId: ${payload?.repoSetId || 'unknown'}`,
    `- manifestHash: ${payload?.manifestHash || 'unknown'}`,
    `- diagnostics: warnings=${payload?.diagnostics?.warnings ?? 0}, errors=${payload?.diagnostics?.errors ?? 0}`
  ];
}

function summarizeWorkspaceStatusPayload(payload) {
  const repos = Array.isArray(payload?.repos) ? payload.repos : [];
  return [
    `- workspace: ${payload?.workspacePath || 'unknown'}`,
    `- manifest: ${payload?.manifestPath || 'n/a'}`,
    `- repoSetId: ${payload?.repoSetId || 'unknown'}`,
    `- repos: ${repos.length}`
  ];
}

function summarizeWorkspaceBuildPayload(payload) {
  return [
    `- workspace: ${payload?.workspacePath || 'unknown'}`,
    `- manifest: ${payload?.manifestPath || 'n/a'}`,
    `- repoSetId: ${payload?.repoSetId || 'unknown'}`,
    `- repos built: ${payload?.diagnostics?.total ?? 0}`,
    `- repos failed: ${payload?.diagnostics?.failed ?? 0}`
  ];
}

function summarizeWorkspaceCatalogPayload(payload) {
  const repos = Array.isArray(payload?.repos) ? payload.repos : [];
  return [
    `- workspace: ${payload?.workspacePath || 'unknown'}`,
    `- workspace name: ${payload?.workspaceName || 'n/a'}`,
    `- repoSetId: ${payload?.repoSetId || 'unknown'}`,
    `- repos: ${repos.length}`,
    `- manifest: ${payload?.cacheRoots?.workspaceManifestPath || 'n/a'}`
  ];
}

function createNavigationTarget(filePath, label, description) {
  const normalized = String(filePath || '').trim();
  if (!normalized) return null;
  return {
    filePath: toPosixPath(normalized),
    label: String(label || normalized),
    description: description ? String(description) : ''
  };
}

function collectOperatorNavigationTargets(spec, payload) {
  const targets = [];
  switch (spec.id) {
    case 'pairofcleats.architectureCheck': {
      for (const violation of payload?.violations || []) {
        const fromPath = violation?.edge?.from?.path || '';
        const toPath = violation?.edge?.to?.path || '';
        const ruleId = violation?.ruleId || 'rule';
        if (fromPath) targets.push(createNavigationTarget(fromPath, fromPath, `${ruleId} source`));
        if (toPath) targets.push(createNavigationTarget(toPath, toPath, `${ruleId} target`));
      }
      break;
    }
    case 'pairofcleats.impact': {
      for (const entry of payload?.impacted || []) {
        const refPath = entry?.ref?.path || '';
        if (refPath) targets.push(createNavigationTarget(refPath, refPath, 'impacted file'));
        for (const node of entry?.witnessPath?.nodes || []) {
          if (node?.path) targets.push(createNavigationTarget(node.path, node.path, 'witness path'));
        }
      }
      break;
    }
    case 'pairofcleats.suggestTests': {
      for (const suggestion of payload?.suggestions || []) {
        if (!suggestion?.testPath) continue;
        targets.push(createNavigationTarget(
          suggestion.testPath,
          suggestion.testPath,
          Number.isFinite(suggestion?.score) ? `score ${suggestion.score.toFixed(3)}` : 'suggested test'
        ));
      }
      break;
    }
    default:
      break;
  }
  const seen = new Set();
  return targets.filter((target) => {
    if (!target) return false;
    const key = `${target.filePath}::${target.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

async function maybeOpenOperatorArtifacts(spec, payload, repoContext, output) {
  if (spec.id === 'pairofcleats.codeMap' && payload?.outPath && typeof vscode.env?.openExternal === 'function') {
    const targetUri = vscode.Uri.file(payload.outPath);
    output.appendLine(`- opening map: ${payload.outPath}`);
    await vscode.env.openExternal(targetUri);
    return;
  }
  const targets = collectOperatorNavigationTargets(spec, payload);
  if (!targets.length || typeof vscode.window.showQuickPick !== 'function') return;
  const selection = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target.label,
      description: target.description,
      target
    })),
    {
      title: `${spec.title} results`,
      placeHolder: 'Select a file to open'
    }
  );
  if (!selection?.target) return;
  const openResult = await openSearchHit(vscode, repoContext, { file: selection.target.filePath });
  if (!openResult.ok) {
    output.appendLine(openResult.detail || openResult.message);
    output.show?.(true);
    vscode.window.showErrorMessage(openResult.message);
  }
}

function summarizeOperatorPayload(spec, payload) {
  switch (spec.id) {
    case 'pairofcleats.setup':
    case 'pairofcleats.bootstrap':
      return summarizeSetupLikePayload(payload);
    case 'pairofcleats.doctor':
      return summarizeDoctorPayload(payload);
    case 'pairofcleats.configDump':
      return summarizeConfigDumpPayload(payload);
    case 'pairofcleats.indexHealth':
      return summarizeIndexHealthPayload(payload);
    case 'pairofcleats.codeMap':
      return summarizeCodeMapPayload(payload);
    case 'pairofcleats.architectureCheck':
      return summarizeArchitecturePayload(payload);
    case 'pairofcleats.impact':
      return summarizeImpactPayload(payload);
    case 'pairofcleats.suggestTests':
      return summarizeSuggestTestsPayload(payload);
    case 'pairofcleats.workspaceManifest':
      return summarizeWorkspaceManifestPayload(payload);
    case 'pairofcleats.workspaceStatus':
      return summarizeWorkspaceStatusPayload(payload);
    case 'pairofcleats.workspaceBuild':
      return summarizeWorkspaceBuildPayload(payload);
    case 'pairofcleats.workspaceCatalog':
      return summarizeWorkspaceCatalogPayload(payload);
    default:
      return [];
  }
}

async function runBufferedJsonCommand({
  spec,
  repoRoot,
  command,
  args,
  env,
  output
}) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: spec.progressTitle,
      cancellable: true
    },
    (_, token) => new Promise((resolve) => {
      const useShellWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
      const invocation = useShellWrapper
        ? resolveWindowsCmdInvocation(command, args)
        : { command, args };
      const child = cp.spawn(invocation.command, invocation.args, {
        cwd: repoRoot,
        env: invocation.env ? { ...env, ...invocation.env } : env,
        shell: false,
        windowsHide: true
      });
      const stdoutAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
      const stderrAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        output.appendLine(`[command] timeout after ${spec.timeoutMs}ms`);
        try {
          child.kill('SIGKILL');
        } catch {}
      }, spec.timeoutMs);
      timeout.unref?.();
      const cancelSub = token.onCancellationRequested(() => {
        output.appendLine('[command] cancellation requested');
        try {
          child.kill('SIGKILL');
        } catch {}
      });
      child.stdout?.on('data', (chunk) => {
        stdoutAccumulator.push(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderrAccumulator.push(chunk);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        cancelSub.dispose();
        resolve({
          ok: false,
          kind: 'spawn-error',
          message: `${spec.title} failed to start: ${error?.message || error}`,
          detail: String(error?.stack || error?.message || error)
        });
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        cancelSub.dispose();
        if (token.isCancellationRequested) {
          resolve({
            ok: false,
            kind: 'cancelled',
            message: `${spec.title} was cancelled.`,
            detail: null
          });
          return;
        }
        const stdout = stdoutAccumulator.text();
        const stderr = stderrAccumulator.text();
        const parsed = stdout.trim()
          ? parseJsonPayload(stdout, {
            stdoutTruncated: stdoutAccumulator.truncated(),
            label: spec.title
          })
          : null;
        if (parsed?.ok) {
          resolve({
            ok: code === 0,
            code,
            payload: parsed.payload,
            stdout,
            stderr,
            timedOut
          });
          return;
        }
        const processFailure = summarizeProcessFailure({
          code,
          timedOut,
          cancelled: false,
          stderr,
          stdout,
          stdoutTruncated: stdoutAccumulator.truncated(),
          stderrTruncated: stderrAccumulator.truncated(),
          timeoutMs: spec.timeoutMs
        });
        if (processFailure) {
          resolve({
            ok: false,
            kind: processFailure.kind,
            message: processFailure.message,
            detail: processFailure.detail
          });
          return;
        }
        resolve({
          ok: false,
          kind: parsed?.kind || 'invalid-json',
          message: parsed?.message || `${spec.title} returned no JSON output.`,
          detail: parsed?.detail || stderr || stdout || null
        });
      });
    })
  );
}

async function executeOperatorWorkflow(spec, repoContext, invocation) {
  const { repoRoot } = repoContext;
  const config = getExtensionConfiguration();
  const env = buildSpawnEnv(config);
  const output = getOutputChannel();
  output.appendLine('');
  output.appendLine(`=== ${spec.title} ===`);
  output.appendLine(`[command] command=${invocation.command}`);
  output.appendLine(`[command] args=${JSON.stringify(invocation.args)}`);
  const session = await beginWorkflowSession(spec, repoContext, invocation);
  const result = await runBufferedJsonCommand({
    spec,
    repoRoot,
    command: invocation.command,
    args: invocation.args,
    env,
    output
  });
  if (!result.payload) {
    if (result.detail) output.appendLine(result.detail);
    output.show?.(true);
    await finishWorkflowSession(session.sessionId, {
      status: result.kind === 'cancelled' ? 'cancelled' : 'failed',
      summaryLine: result.message
    });
    const show = result.kind === 'cancelled'
      ? vscode.window.showInformationMessage
      : vscode.window.showErrorMessage;
    show(result.message);
    return;
  }
  appendOutputLines(output, summarizeOperatorPayload(spec, result.payload));
  output.appendLine('- raw-json:');
  appendJsonBlock(output, result.payload);
  await maybeOpenOperatorArtifacts(spec, result.payload, repoContext, output);
  output.show?.(true);
  const summaryLines = summarizeOperatorPayload(spec, result.payload);
  await finishWorkflowSession(session.sessionId, {
    status: result.ok ? 'succeeded' : 'failed',
    summaryLine: summaryLines[0] || `${spec.title} ${result.ok ? 'completed' : 'reported issues'}.`
  });
  if (result.ok) {
    vscode.window.showInformationMessage(`${spec.title} completed.`);
    return;
  }
  vscode.window.showErrorMessage(`${spec.title} reported issues. See PairOfCleats output for details.`);
}

async function runOperatorCommand(spec) {
  const repoContext = await resolveRepoContext();
  if (!repoContext.ok) {
    if (repoContext.message) {
      if (repoContext.detail) {
        const output = getOutputChannel();
        output.appendLine(repoContext.detail);
        output.show?.(true);
      }
      vscode.window.showErrorMessage(repoContext.message);
    }
    return;
  }
  const { repoRoot } = repoContext;
  const config = getExtensionConfiguration();
  const cliResolution = resolveCli(repoRoot, config);
  if (spec.invocation !== 'script' && !cliResolution.ok) {
    const output = getOutputChannel();
    output.appendLine(cliResolution.detail || cliResolution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(cliResolution.message);
    return;
  }
  const inputContext = typeof spec.resolveInput === 'function'
    ? await spec.resolveInput(repoContext)
    : undefined;
  if (inputContext === null) {
    return;
  }
  const invocation = resolveOperatorInvocation(spec, repoContext, cliResolution, inputContext);
  if (!invocation.ok) {
    const output = getOutputChannel();
    output.appendLine(invocation.detail || invocation.message);
    output.show?.(true);
    vscode.window.showErrorMessage(invocation.message);
    return;
  }
  await executeOperatorWorkflow(spec, repoContext, invocation);
}

/**
 * Prompt for query, run CLI search, and open selected result in editor.
 *
 * @returns {Promise<void>}
 */
async function runSearch() {
  const repoContext = await resolveRepoContext();
  if (!repoContext.ok) {
    if (repoContext.message) {
      if (repoContext.detail) {
        const output = getOutputChannel();
        output.appendLine(repoContext.detail);
        output.show?.(true);
      }
      vscode.window.showErrorMessage(repoContext.message);
    }
    return;
  }
  const { repoRoot } = repoContext;

  const query = await vscode.window.showInputBox({
    prompt: 'PairOfCleats search query',
    placeHolder: 'e.g. auth token validation'
  });
  if (!query || !query.trim()) return;

  const config = getExtensionConfiguration();
  const cliResolution = resolveCli(repoRoot, config);
  if (!cliResolution.ok) {
    vscode.window.showErrorMessage(cliResolution.message);
    const output = getOutputChannel();
    output.appendLine(cliResolution.detail || cliResolution.message);
    output.show?.(true);
    return;
  }
  const { command, argsPrefix } = cliResolution;
  const searchOptions = readSearchOptions(config, VSCODE_SETTINGS);
  const args = [...argsPrefix, ...buildSearchArgs(query.trim(), repoRoot, searchOptions)];
  const env = buildSpawnEnv(config);
  const searchTimeoutMs = 60000;
  const output = getOutputChannel();
  output.appendLine(`[search] command=${command}`);
  output.appendLine(`[search] args=${JSON.stringify(args)}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'PairOfCleats search',
      cancellable: true
    },
    (_, token) => new Promise((resolve) => {
      const useShellWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
      const invocation = useShellWrapper
        ? resolveWindowsCmdInvocation(command, args)
        : { command, args };
      const child = cp.spawn(invocation.command, invocation.args, {
        cwd: repoRoot,
        env: invocation.env ? { ...env, ...invocation.env } : env,
        shell: false,
        windowsHide: true
      });
      const stdoutAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
      const stderrAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        output.appendLine(`[search] timeout after ${searchTimeoutMs}ms`);
        try {
          child.kill('SIGKILL');
        } catch {}
      }, searchTimeoutMs);
      timeout.unref?.();
      const cancelSub = token.onCancellationRequested(() => {
        output.appendLine('[search] cancellation requested');
        try {
          child.kill('SIGKILL');
        } catch {}
      });
      child.stdout?.on('data', (chunk) => {
        stdoutAccumulator.push(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderrAccumulator.push(chunk);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        cancelSub.dispose();
        output.appendLine(`[search] spawn error=${error?.message || error}`);
        output.show?.(true);
        vscode.window.showErrorMessage(`PairOfCleats search failed: ${error?.message || error}`);
        resolve();
      });
      child.once('close', async (code) => {
        clearTimeout(timeout);
        cancelSub.dispose();
        if (token.isCancellationRequested) {
          output.appendLine('[search] cancelled by user');
          vscode.window.showInformationMessage('PairOfCleats search was cancelled.');
          resolve();
          return;
        }
        const stdout = stdoutAccumulator.text();
        const stderr = stderrAccumulator.text();
        const processFailure = summarizeProcessFailure({
          code,
          timedOut,
          cancelled: false,
          stderr,
          stdout,
          stdoutTruncated: stdoutAccumulator.truncated(),
          stderrTruncated: stderrAccumulator.truncated(),
          timeoutMs: searchTimeoutMs
        });
        if (processFailure) {
          output.appendLine(`[search] failure kind=${processFailure.kind}`);
          if (processFailure.detail) output.appendLine(processFailure.detail);
          output.show?.(true);
          vscode.window.showErrorMessage(processFailure.message);
          resolve();
          return;
        }
        if (stderrAccumulator.truncated()) {
          output.appendLine('[search] stderr output was truncated');
        }

        const parsed = parseSearchPayload(stdout, {
          stdoutTruncated: stdoutAccumulator.truncated()
        });
        if (!parsed.ok) {
          output.appendLine(`[search] parse failure kind=${parsed.kind}`);
          if (parsed.detail) output.appendLine(parsed.detail);
          output.show?.(true);
          vscode.window.showErrorMessage(parsed.message);
          resolve();
          return;
        }
        const payload = parsed.payload;

        const hits = collectSearchHits(payload);

        if (!hits.length) {
          vscode.window.showInformationMessage('PairOfCleats: no results.');
          resolve();
          return;
        }

        const items = hits.map((hit) => {
          const line = Number.isFinite(hit.startLine) ? `:${hit.startLine}` : '';
          const fileLabel = `${hit.file}${line}`;
          const scoreLabel = Number.isFinite(hit.score)
            ? `${hit.score.toFixed(2)} ${hit.scoreType || ''}`.trim()
            : 'n/a';
          const label = hit.name || hit.headline || fileLabel;
          return {
            label,
            description: fileLabel,
            detail: `${hit.section} • score ${scoreLabel}`,
            hit
          };
        });

        const selection = await vscode.window.showQuickPick(items, {
          title: `PairOfCleats results (${hits.length})`,
          matchOnDescription: true,
          matchOnDetail: true
        });
        if (!selection) {
          resolve();
          return;
        }

        const selected = selection.hit;
        const openResult = await openSearchHit(vscode, repoContext, selected);
        if (!openResult.ok) {
          output.appendLine(`[search] open failure path=${openResult.filePath}`);
          output.appendLine(openResult.detail);
          output.show?.(true);
          vscode.window.showErrorMessage(openResult.message);
          resolve();
          return;
        }

        resolve();
      });
    })
  );
}

/**
 * Extension activation hook: register search command and subscriptions.
 *
 * @param {import('vscode').ExtensionContext} context
 * @returns {void}
 */
function activate(context) {
  extensionContext = context;
  workflowSessions = normalizeWorkflowSessions(readWorkspaceState(WORKFLOW_SESSION_STORAGE_KEY, []));
  workflowStatusBar = typeof vscode.window.createStatusBarItem === 'function'
    ? vscode.window.createStatusBarItem(vscode.StatusBarAlignment?.Left ?? 0, 100)
    : null;
  if (workflowStatusBar) {
    workflowStatusBar.command = 'pairofcleats.showWorkflowStatus';
    workflowStatusBar.show?.();
    context.subscriptions.push(workflowStatusBar);
  }
  const searchCommand = vscode.commands.registerCommand('pairofcleats.search', runSearch);
  context.subscriptions.push(searchCommand);
  const workflowStatusCommand = vscode.commands.registerCommand('pairofcleats.showWorkflowStatus', showWorkflowStatus);
  const rerunLastWorkflowCommand = vscode.commands.registerCommand('pairofcleats.rerunLastWorkflow', async () => {
    const session = getMostRecentWorkflowSession();
    if (!session) {
      vscode.window.showInformationMessage('PairOfCleats has no workflow to rerun.');
      return;
    }
    await rerunWorkflowSession(session);
  });
  const recentWorkflowCommand = vscode.commands.registerCommand('pairofcleats.showRecentWorkflows', showRecentWorkflows);
  context.subscriptions.push(workflowStatusCommand, rerunLastWorkflowCommand, recentWorkflowCommand);
  for (const spec of OPERATOR_COMMAND_SPECS) {
    const command = vscode.commands.registerCommand(spec.id, () => runOperatorCommand(spec));
    context.subscriptions.push(command);
  }
  if (typeof vscode.window.onDidChangeActiveTextEditor === 'function') {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
      updateWorkflowStatusBar();
    }));
  }
  if (typeof vscode.workspace.onDidChangeWorkspaceFolders === 'function') {
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateWorkflowStatusBar();
    }));
  }
  void restoreWorkflowSessions();
}

/**
 * Extension deactivation hook.
 *
 * @returns {void}
 */
function deactivate() {}

let outputChannel = null;
let extensionContext = null;
let workflowSessions = [];
let workflowStatusBar = null;
let lastWorkflowRepoSnapshot = null;

function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('PairOfCleats');
  }
  return outputChannel;
}

module.exports = {
  activate,
  deactivate,
  _test: {
    VSCODE_SETTINGS,
    readSearchOptions,
    buildSearchArgs,
    collectSearchHits,
    getOutputChannel,
    openSearchHit,
    resolveCli,
    resolveRepoContext,
    resolvePassiveRepoContext,
    runOperatorCommand,
    executeOperatorWorkflow,
    runSearch,
    showWorkflowStatus,
    showRecentWorkflows,
    rerunWorkflowSession,
    OPERATOR_COMMAND_SPECS
  }
};
