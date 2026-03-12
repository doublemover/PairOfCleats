const vscode = require('vscode');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter: NodeEventEmitter } = require('node:events');
const { resolveWindowsCmdInvocation } = require('./windows-cmd.js');
const {
  readSearchOptions,
  buildSearchArgs,
  buildSearchPayload,
  collectSearchHits
} = require('./search-contract.js');
const {
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_API_TIMEOUT_MS,
  createChunkAccumulator,
  resolveConfiguredCli,
  parseJsonPayload,
  parseSearchPayload,
  normalizeApiBaseUrl,
  normalizeApiTimeoutMs,
  requestApiJson,
  probeApiCapabilities: probeApiCapabilitiesRequest,
  summarizeProcessFailure,
  summarizeSpawnFailure,
  spawnBufferedProcess,
  resolveValidatedHitTarget,
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
      apiServerUrlKey: 'apiServerUrl',
      apiTimeoutKey: 'apiTimeoutMs',
      apiExecutionModeKey: 'apiExecutionMode',
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
      asOfKey: 'searchAsOf',
      snapshotKey: 'searchSnapshot',
      filterKey: 'searchFilter',
      authorKey: 'searchAuthor',
      modifiedAfterKey: 'searchModifiedAfter',
      modifiedSinceKey: 'searchModifiedSince',
      churnKey: 'searchChurn',
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
  apiServerUrlKey: String(readContract(
    ['settings', 'vscode', 'apiServerUrlKey'],
    DEFAULT_VSCODE_SETTINGS.apiServerUrlKey
  )),
  apiTimeoutKey: String(readContract(
    ['settings', 'vscode', 'apiTimeoutKey'],
    DEFAULT_VSCODE_SETTINGS.apiTimeoutKey
  )),
  apiExecutionModeKey: String(readContract(
    ['settings', 'vscode', 'apiExecutionModeKey'],
    DEFAULT_VSCODE_SETTINGS.apiExecutionModeKey
  )),
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
  asOfKey: String(readContract(['settings', 'vscode', 'asOfKey'], DEFAULT_VSCODE_SETTINGS.asOfKey)),
  snapshotKey: String(readContract(['settings', 'vscode', 'snapshotKey'], DEFAULT_VSCODE_SETTINGS.snapshotKey)),
  filterKey: String(readContract(['settings', 'vscode', 'filterKey'], DEFAULT_VSCODE_SETTINGS.filterKey)),
  authorKey: String(readContract(['settings', 'vscode', 'authorKey'], DEFAULT_VSCODE_SETTINGS.authorKey)),
  modifiedAfterKey: String(readContract(
    ['settings', 'vscode', 'modifiedAfterKey'],
    DEFAULT_VSCODE_SETTINGS.modifiedAfterKey
  )),
  modifiedSinceKey: String(readContract(
    ['settings', 'vscode', 'modifiedSinceKey'],
    DEFAULT_VSCODE_SETTINGS.modifiedSinceKey
  )),
  churnKey: String(readContract(['settings', 'vscode', 'churnKey'], DEFAULT_VSCODE_SETTINGS.churnKey)),
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
const SELECTED_REPO_STORAGE_KEY = 'pairofcleats.selectedRepo';
const MAX_WORKFLOW_SESSIONS = 20;
const SEARCH_HISTORY_STORAGE_KEY = 'pairofcleats.searchHistory';
const SEARCH_GROUP_MODE_STORAGE_KEY = 'pairofcleats.searchResultsGroupMode';
const SEARCH_RESULTS_VIEW_ID = 'pairofcleats.resultsExplorer';
const MAX_SEARCH_HISTORY = 20;

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
const VALID_API_EXECUTION_MODES = new Set(['cli', 'prefer', 'require']);
const API_CAPABILITY_CACHE_TTL_MS = 30 * 1000;
const WORKFLOW_TRANSPORTS = Object.freeze({
  search: { label: 'search', supportsCli: true, supportsApi: true },
  'search-symbol': { label: 'search symbol lookup', supportsCli: true, supportsApi: true },
  'explain-search': { label: 'explain search', supportsCli: true, supportsApi: false },
  'index-health': { label: 'index health', supportsCli: true, supportsApi: true }
});
const apiCapabilityCache = new Map();

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

function getWorkflowTransport(workflow) {
  const key = String(workflow || '').trim().toLowerCase();
  const entry = WORKFLOW_TRANSPORTS[key];
  if (!entry) {
    return {
      workflow: key,
      label: key || 'this workflow',
      supportsCli: true,
      supportsApi: false
    };
  }
  return {
    workflow: key,
    label: String(entry.label || key || 'this workflow'),
    supportsCli: entry.supportsCli !== false,
    supportsApi: entry.supportsApi === true
  };
}

function readApiSettings(config) {
  const baseUrl = normalizeApiBaseUrl(config.get(VSCODE_SETTINGS.apiServerUrlKey));
  const timeoutMs = normalizeApiTimeoutMs(config.get(VSCODE_SETTINGS.apiTimeoutKey));
  const rawMode = String(config.get(VSCODE_SETTINGS.apiExecutionModeKey) || 'cli').trim().toLowerCase();
  const mode = VALID_API_EXECUTION_MODES.has(rawMode) ? rawMode : 'cli';
  return { baseUrl, timeoutMs, mode };
}

function buildApiHeaders(config) {
  const env = buildSpawnEnv(config);
  const token = String(env?.PAIROFCLEATS_API_TOKEN || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getCachedApiCapabilities(baseUrl, timeoutMs, headers = null) {
  const cacheKey = `${baseUrl}::${timeoutMs}::${headers?.Authorization || ''}`;
  const cached = apiCapabilityCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < API_CAPABILITY_CACHE_TTL_MS) {
    return cached.result;
  }
  const probe = await probeApiCapabilitiesRequest(baseUrl, timeoutMs, headers);
  const result = probe.ok
    ? {
      ok: true,
      baseUrl,
      timeoutMs,
      payload: probe.payload,
      capabilities: probe.capabilities && typeof probe.capabilities === 'object'
        ? probe.capabilities
        : {}
    }
    : probe;
  apiCapabilityCache.set(cacheKey, {
    timestamp: Date.now(),
    result
  });
  return result;
}

async function resolveExecutionMode(config, workflow, requestedMode = null) {
  const transport = getWorkflowTransport(workflow);
  const apiSettings = readApiSettings(config);
  const configuredMode = apiSettings.mode;
  const { mode: _ignoredConfiguredMode, ...apiRuntimeSettings } = apiSettings;
  const headers = buildApiHeaders(config);
  if (requestedMode === 'cli') {
    return transport.supportsCli
      ? { ok: true, ...apiRuntimeSettings, configuredMode, mode: 'cli', transport, headers }
      : {
        ok: false,
        message: `PairOfCleats CLI mode is not supported for ${transport.label}.`,
        detail: null
      };
  }
  if (requestedMode === 'api') {
    if (!transport.supportsApi) {
      return {
        ok: false,
        message: `PairOfCleats API mode is not supported for ${transport.label}.`,
        detail: null
      };
    }
    if (!apiSettings.baseUrl) {
      return {
        ok: false,
        message: `PairOfCleats API mode requires ${VSCODE_SETTINGS.namespace}.${VSCODE_SETTINGS.apiServerUrlKey}.`,
        detail: 'Set an http:// or https:// PairOfCleats API server URL in VS Code settings.'
      };
    }
    const probe = await getCachedApiCapabilities(apiSettings.baseUrl, apiSettings.timeoutMs, headers);
    if (!probe.ok) return probe;
    if (probe.capabilities?.[transport.workflow] === false) {
      return {
        ok: false,
        message: `PairOfCleats API mode is not supported for ${transport.label}.`,
        detail: `The PairOfCleats API at ${apiSettings.baseUrl} does not advertise ${transport.workflow} support.`
      };
    }
    return { ok: true, ...apiRuntimeSettings, configuredMode, mode: 'api', transport, headers, capabilities: probe.capabilities };
  }
  if (apiSettings.mode === 'cli') {
    return transport.supportsCli
      ? { ok: true, ...apiRuntimeSettings, configuredMode, mode: 'cli', transport, headers }
      : {
        ok: false,
        message: `PairOfCleats CLI mode is not supported for ${transport.label}.`,
        detail: null
      };
  }
  if (!transport.supportsApi) {
    if (apiSettings.mode === 'require') {
      return {
        ok: false,
        message: `PairOfCleats API mode is not supported for ${transport.label}.`,
        detail: null
      };
    }
    return transport.supportsCli
      ? { ok: true, ...apiRuntimeSettings, configuredMode, mode: 'cli', transport, headers }
      : {
        ok: false,
        message: `PairOfCleats API mode is not supported for ${transport.label}.`,
        detail: null
      };
  }
  if (!apiSettings.baseUrl) {
    if (apiSettings.mode === 'prefer' && transport.supportsCli) {
      return { ok: true, ...apiRuntimeSettings, configuredMode, mode: 'cli', transport, headers, fallbackReason: 'missing-api-url' };
    }
    return {
      ok: false,
      message: `PairOfCleats API mode requires ${VSCODE_SETTINGS.namespace}.${VSCODE_SETTINGS.apiServerUrlKey}.`,
      detail: 'Set an http:// or https:// PairOfCleats API server URL in VS Code settings.'
    };
  }
  const probe = await getCachedApiCapabilities(apiSettings.baseUrl, apiSettings.timeoutMs, headers);
  if (probe.ok) {
    if (probe.capabilities?.[transport.workflow] === false) {
      if (apiSettings.mode === 'prefer' && transport.supportsCli) {
        return {
          ok: true,
          ...apiRuntimeSettings,
          configuredMode,
          mode: 'cli',
          transport,
          headers,
          fallbackReason: `${transport.workflow}-unsupported`,
          fallbackDetail: `The PairOfCleats API at ${apiSettings.baseUrl} does not advertise ${transport.workflow} support.`
        };
      }
      return {
        ok: false,
        message: `PairOfCleats API mode is not supported for ${transport.label}.`,
        detail: `The PairOfCleats API at ${apiSettings.baseUrl} does not advertise ${transport.workflow} support.`
      };
    }
    return { ok: true, ...apiRuntimeSettings, configuredMode, mode: 'api', transport, headers, capabilities: probe.capabilities };
  }
  if (apiSettings.mode === 'prefer' && transport.supportsCli) {
    return {
      ok: true,
      ...apiRuntimeSettings,
      configuredMode,
      mode: 'cli',
      transport,
      headers,
      fallbackReason: probe.message,
      fallbackDetail: probe.detail || null
    };
  }
  return probe;
}

function buildApiSearchRequest(query, repoRoot, options) {
  return buildSearchPayload(query, repoRoot, options);
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

function getWorkspaceFolderPath(folder) {
  return folder?.uri?.scheme === 'file' && folder?.uri?.fsPath
    ? path.resolve(folder.uri.fsPath)
    : null;
}

function getWorkspaceFolderUri(folder) {
  return folder?.uri && typeof folder.uri === 'object' ? folder.uri : null;
}

function getWorkspaceFolderDescriptor(folder) {
  const workspaceUri = getWorkspaceFolderUri(folder);
  const workspacePath = getWorkspaceFolderPath(folder);
  const workspaceUriString = workspaceUri
    ? (typeof workspaceUri.toString === 'function'
      ? workspaceUri.toString()
      : `${workspaceUri.scheme || 'file'}:${workspaceUri.path || workspaceUri.fsPath || ''}`)
    : '';
  return {
    workspaceFolder: folder,
    workspaceUri,
    workspacePath,
    workspaceUriString,
    isLocalFile: workspaceUri?.scheme === 'file' && !!workspacePath
  };
}

function createUnsupportedWorkspaceResult(folders, activeUri = null, { repoLabel = 'no repo' } = {}) {
  const schemes = new Set();
  if (activeUri?.scheme) schemes.add(String(activeUri.scheme));
  for (const folder of folders || []) {
    const scheme = folder?.uri?.scheme;
    if (scheme) schemes.add(String(scheme));
  }
  const schemeList = Array.from(schemes).sort();
  const schemeSummary = schemeList.length ? schemeList.join(', ') : 'unknown';
  const scope = activeUri?.scheme && activeUri.scheme !== 'file'
    ? `The active editor is using the ${activeUri.scheme} scheme.`
    : `Workspace folders use these schemes: ${schemeSummary}.`;
  return {
    ok: false,
    kind: 'unsupported-workspace',
    repoLabel,
    message: 'PairOfCleats local CLI workflows only support local file workspaces right now.',
    detail: `${scope} Open a local checkout or use the PairOfCleats CLI directly for remote workspaces.`
  };
}

function isContainedPath(candidatePath, containerPath) {
  if (!candidatePath || !containerPath) return false;
  const relative = path.relative(containerPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveFolderRepoRoot(folder, preferredPath = null, { allowRemote = false } = {}) {
  const descriptor = getWorkspaceFolderDescriptor(folder);
  const workspacePath = descriptor.workspacePath;
  if (!workspacePath) {
    if (allowRemote && descriptor.workspaceUri?.scheme && descriptor.workspaceUri.scheme !== 'file') {
      return String(descriptor.workspaceUri.path || descriptor.workspaceUri.fsPath || '').trim() || null;
    }
    return null;
  }
  const normalizedPreferred = preferredPath ? path.resolve(preferredPath) : null;
  if (normalizedPreferred) {
    const preferredRoot = findRepoRoot(normalizedPreferred);
    if (preferredRoot) {
      if (isContainedPath(preferredRoot, workspacePath)) return preferredRoot;
      if (VSCODE_REPO_WALKUP && isContainedPath(workspacePath, preferredRoot)) return preferredRoot;
    }
  }
  return VSCODE_REPO_WALKUP ? (findRepoRoot(workspacePath) || workspacePath) : workspacePath;
}

function createRepoCandidate(folder, repoRoot, source = 'workspace-folder') {
  const descriptor = getWorkspaceFolderDescriptor(folder);
  if (!repoRoot || !descriptor.workspaceUri) return null;
  return {
    repoRoot,
    repoUri: descriptor.isLocalFile ? vscode.Uri.file(repoRoot) : descriptor.workspaceUri,
    workspaceFolder: descriptor.workspaceFolder,
    workspaceUri: descriptor.workspaceUri,
    workspacePath: descriptor.workspacePath,
    workspaceUriString: descriptor.workspaceUriString,
    supportsLocalFs: descriptor.isLocalFile,
    repoLabel: formatRepoLabel(repoRoot),
    source
  };
}

function collectRepoCandidates(folders, {
  hintUri = null,
  hintSource = 'active-editor',
  includeLastSnapshot = false,
  allowRemote = false
} = {}) {
  const seen = new Set();
  const candidates = [];
  const pushCandidate = (folder, repoRoot, source) => {
    const candidate = createRepoCandidate(folder, repoRoot, source);
    if (!candidate || seen.has(candidate.repoRoot)) return;
    seen.add(candidate.repoRoot);
    candidates.push(candidate);
  };

  const hintedFolder = hintUri && typeof vscode.workspace.getWorkspaceFolder === 'function'
    ? vscode.workspace.getWorkspaceFolder(hintUri)
    : null;
  if (hintedFolder?.uri?.scheme === 'file' && hintUri?.fsPath) {
    pushCandidate(hintedFolder, resolveFolderRepoRoot(hintedFolder, hintUri.fsPath, { allowRemote }), hintSource);
  } else if (allowRemote && hintedFolder?.uri?.scheme && hintedFolder.uri.scheme !== 'file') {
    pushCandidate(hintedFolder, resolveFolderRepoRoot(hintedFolder, null, { allowRemote }), hintSource);
  }

  if (includeLastSnapshot?.repoRoot) {
    for (const folder of folders) {
      const workspacePath = getWorkspaceFolderPath(folder);
      if (!workspacePath) continue;
      if (isContainedPath(includeLastSnapshot.repoRoot, workspacePath)
        || (VSCODE_REPO_WALKUP && isContainedPath(workspacePath, includeLastSnapshot.repoRoot))) {
        pushCandidate(folder, path.resolve(includeLastSnapshot.repoRoot), 'last-session');
        break;
      }
    }
  }

  for (const folder of folders) {
    pushCandidate(folder, resolveFolderRepoRoot(folder, null, { allowRemote }), 'workspace-folder');
  }

  return candidates;
}

function normalizeSelectedRepoSnapshot(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') return null;
  const repoRoot = String(rawSnapshot.repoRoot || '').trim();
  if (!repoRoot) return null;
  const workspacePath = String(rawSnapshot.workspacePath || '').trim();
  const workspaceUriString = String(rawSnapshot.workspaceUri || '').trim();
  return {
    repoRoot: path.resolve(repoRoot),
    repoLabel: formatRepoLabel(repoRoot),
    workspacePath: workspacePath ? path.resolve(workspacePath) : path.resolve(repoRoot),
    workspaceUriString
  };
}

function resolveSelectedRepoCandidate(candidates) {
  const selection = normalizeSelectedRepoSnapshot(readWorkspaceState(SELECTED_REPO_STORAGE_KEY, null));
  if (!selection) return null;
  return candidates.find((candidate) => path.resolve(candidate.repoRoot) === selection.repoRoot) || null;
}

async function persistSelectedRepoCandidate(candidate) {
  if (!candidate?.repoRoot) {
    await writeWorkspaceState(SELECTED_REPO_STORAGE_KEY, null);
    updateWorkflowStatusBar();
    return;
  }
  await writeWorkspaceState(SELECTED_REPO_STORAGE_KEY, {
    repoRoot: candidate.repoRoot,
    workspacePath: candidate.workspacePath || candidate.repoRoot,
    workspaceUri: candidate.workspaceUriString || ''
  });
  updateWorkflowStatusBar();
}

async function promptForRepoCandidate(candidates, { title = 'PairOfCleats repository', placeHolder = 'Select the repository root to use' } = {}) {
  if (typeof vscode.window.showQuickPick !== 'function') {
    return null;
  }
  const selectedCandidate = resolveSelectedRepoCandidate(candidates);
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.repoLabel,
      description: `${candidate.workspaceFolder?.name || candidate.workspacePath || candidate.workspaceUriString}${candidate.source === 'workspace-folder' ? '' : ` • ${candidate.source}`}${selectedCandidate?.repoRoot === candidate.repoRoot ? ' • selected' : ''}`,
      detail: candidate.repoRoot,
      candidate
    })),
    {
      title,
      placeHolder
    }
  );
  return picked?.candidate || null;
}

/**
 * Resolve repository root for current workspace settings.
 *
 * @returns {string|null}
 */
async function resolveRepoContext({ pathHint = null, preferSelectedRepo = true, allowPrompt = true, allowRemote = false } = {}) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    return {
      ok: false,
      kind: 'no-workspace',
      message: 'PairOfCleats: open a workspace to search.'
    };
  }
  const activeUri = pathHint || vscode.window.activeTextEditor?.document?.uri || null;
  const eligibleFolders = allowRemote
    ? folders.filter((folder) => !!getWorkspaceFolderDescriptor(folder).workspaceUri)
    : folders.filter((folder) => getWorkspaceFolderDescriptor(folder).isLocalFile);
  if (!eligibleFolders.length) {
    return createUnsupportedWorkspaceResult(folders, activeUri);
  }
  const candidates = collectRepoCandidates(eligibleFolders, {
    hintUri: activeUri,
    hintSource: pathHint ? 'path-hint' : 'active-editor',
    allowRemote
  });
  const pathHintCandidate = pathHint
    ? candidates.find((candidate) => candidate.source === 'path-hint') || null
    : null;
  const selectedCandidate = preferSelectedRepo ? resolveSelectedRepoCandidate(candidates) : null;
  const activeCandidate = !pathHint
    ? candidates.find((candidate) => candidate.source === 'active-editor') || null
    : null;
  if (pathHintCandidate) {
    return { ok: true, ...pathHintCandidate, source: 'path-hint' };
  }
  if (selectedCandidate) {
    return { ok: true, ...selectedCandidate, source: 'selected-repo' };
  }
  if (activeCandidate) {
    return { ok: true, ...activeCandidate, source: 'active-editor' };
  }
  if (candidates.length === 1) {
    return {
      ok: true,
      ...candidates[0],
      source: eligibleFolders.length === 1 ? 'single-workspace' : 'single-repo-candidate'
    };
  }
  if (!allowPrompt || typeof vscode.window.showQuickPick !== 'function') {
    return {
      ok: false,
      kind: 'ambiguous-workspace',
      message: 'PairOfCleats needs an explicit repository selection for this workspace.',
      detail: 'Focus a file inside the repo you want, select a repo explicitly, or use a workspace with a single repo root.'
    };
  }
  const picked = await promptForRepoCandidate(candidates);
  if (!picked) {
    return { ok: false, kind: 'cancelled', message: null };
  }
  return {
    ok: true,
    ...picked,
    source: 'repo-picker'
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
    workspacePath: repoContext?.workspacePath || repoContext.repoRoot,
    workspaceUri: repoContext?.workspaceUriString || '',
    repoUri: repoContext?.repoUri && typeof repoContext.repoUri.toString === 'function'
      ? repoContext.repoUri.toString()
      : ''
  };
}

function normalizeWorkflowInvocation(rawInvocation, fallbackTimeoutMs = 60000) {
  if (!rawInvocation || typeof rawInvocation !== 'object') return null;
  return {
    kind: String(rawInvocation.kind || 'operator').trim() || 'operator',
    command: String(rawInvocation.command || '').trim(),
    args: Array.isArray(rawInvocation.args) ? rawInvocation.args.map((value) => String(value)) : [],
    timeoutMs: Number.isFinite(rawInvocation.timeoutMs) ? rawInvocation.timeoutMs : fallbackTimeoutMs,
    persistent: rawInvocation.persistent === true,
    baseUrl: rawInvocation.baseUrl ? normalizeApiBaseUrl(rawInvocation.baseUrl) : '',
    path: rawInvocation.path ? String(rawInvocation.path) : '',
    method: rawInvocation.method ? String(rawInvocation.method).toUpperCase() : '',
    transport: rawInvocation.transport ? String(rawInvocation.transport) : '',
    payload: rawInvocation.payload && typeof rawInvocation.payload === 'object'
      ? rawInvocation.payload
      : null
  };
}

function normalizeSearchInvocation(rawInvocation) {
  if (!rawInvocation || typeof rawInvocation !== 'object') return null;
  const kind = String(rawInvocation.kind || 'cli-search').trim() || 'cli-search';
  if (kind === 'api-search') {
    return {
      kind,
      baseUrl: normalizeApiBaseUrl(rawInvocation.baseUrl),
      timeoutMs: Number.isFinite(rawInvocation.timeoutMs) ? rawInvocation.timeoutMs : DEFAULT_API_TIMEOUT_MS,
      transport: rawInvocation.transport ? String(rawInvocation.transport) : 'api',
      payload: rawInvocation.payload && typeof rawInvocation.payload === 'object'
        ? rawInvocation.payload
        : null
    };
  }
  return {
    kind,
    command: String(rawInvocation.command || '').trim(),
    args: Array.isArray(rawInvocation.args) ? rawInvocation.args.map((value) => String(value)) : [],
    transport: rawInvocation.transport ? String(rawInvocation.transport) : 'cli'
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
  const invocation = normalizeWorkflowInvocation(rawSession.invocation, 60000);
  return {
    sessionId,
    commandId,
    title,
    repoRoot,
    repoLabel: formatRepoLabel(repoRoot),
    workspacePath: rawSession.workspacePath ? String(rawSession.workspacePath) : repoRoot,
    workspaceUri: rawSession.workspaceUri ? String(rawSession.workspaceUri) : '',
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
  const fileFolders = folders.filter((folder) => getWorkspaceFolderDescriptor(folder).isLocalFile);
  if (!fileFolders.length) {
    return createUnsupportedWorkspaceResult(folders, activeUri);
  }
  const candidates = collectRepoCandidates(fileFolders, {
    hintUri: activeUri,
    hintSource: 'active-editor',
    includeLastSnapshot: lastWorkflowRepoSnapshot
  });
  const selectedCandidate = resolveSelectedRepoCandidate(candidates);
  if (selectedCandidate) {
    return { ok: true, ...selectedCandidate, source: 'selected-repo' };
  }
  const activeCandidate = candidates.find((candidate) => candidate.source === 'active-editor') || null;
  if (activeCandidate) {
    return { ok: true, ...activeCandidate, source: 'active-editor' };
  }
  const lastSessionCandidate = candidates.find((candidate) => candidate.source === 'last-session') || null;
  if (lastSessionCandidate) {
    return { ok: true, ...lastSessionCandidate, source: 'last-session' };
  }
  if (candidates.length !== 1) {
    return {
      ok: false,
      kind: 'ambiguous-workspace',
      repoLabel: `${candidates.length || eligibleFolders.length} repos`
    };
  }
  return {
    ok: true,
    ...candidates[0],
    source: 'single-workspace'
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
    const parts = [];
    if (passiveRepo.source === 'selected-repo') {
      parts.push('selected');
    } else if (lastSession && lastSession.repoRoot === passiveRepo.repoRoot && lastSession.status !== 'running') {
      parts.push(lastSession.status);
    }
    const suffix = parts.length ? ` • ${parts.join(' • ')}` : '';
    workflowStatusBar.text = `PairOfCleats: ${passiveRepo.repoLabel}${suffix}`;
    workflowStatusBar.tooltip = `${passiveRepo.repoRoot}${passiveRepo.source === 'selected-repo' ? '\nContext: explicitly selected repository' : ''}${lastSession && lastSession.repoRoot === passiveRepo.repoRoot && lastSession.status !== 'running' ? `\nLast workflow: ${lastSession.title} (${lastSession.status})` : ''}`;
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
    workspacePath: repoContext.workspacePath || repoContext.repoRoot,
    workspaceUri: repoContext.workspaceUriString || '',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summaryLine: '',
    outputHint: 'PairOfCleats output',
    invocation: invocation
      ? {
        kind: invocation.kind || 'operator',
        command: invocation.command,
        args: Array.isArray(invocation.args) ? invocation.args.map((value) => String(value)) : [],
        timeoutMs: Number.isFinite(invocation.timeoutMs) ? invocation.timeoutMs : spec.timeoutMs,
        persistent: invocation.persistent === true,
        baseUrl: invocation.baseUrl ? normalizeApiBaseUrl(invocation.baseUrl) : '',
        path: invocation.path ? String(invocation.path) : '',
        method: invocation.method ? String(invocation.method).toUpperCase() : '',
        transport: invocation.transport ? String(invocation.transport) : '',
        payload: invocation.payload && typeof invocation.payload === 'object' ? invocation.payload : null
      }
      : null
  };
  workflowSessions = [session, ...workflowSessions.filter((entry) => entry.sessionId !== session.sessionId)].slice(0, MAX_WORKFLOW_SESSIONS);
  await persistWorkflowSessions();
  updateWorkflowStatusBar();
  return session;
}

async function selectRepo() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    vscode.window.showErrorMessage('PairOfCleats: open a workspace to select a repository.');
    return;
  }
  const fileFolders = folders.filter((folder) => getWorkspaceFolderDescriptor(folder).isLocalFile);
  if (!fileFolders.length) {
    vscode.window.showErrorMessage(createUnsupportedWorkspaceResult(folders, vscode.window.activeTextEditor?.document?.uri || null).message);
    return;
  }
  const activeUri = vscode.window.activeTextEditor?.document?.uri || null;
  const candidates = collectRepoCandidates(fileFolders, {
    hintUri: activeUri,
    hintSource: 'active-editor'
  });
  if (!candidates.length) {
    vscode.window.showErrorMessage('PairOfCleats could not locate a repository in this workspace.');
    return;
  }
  const picked = candidates.length === 1
    ? candidates[0]
    : await promptForRepoCandidate(candidates, {
      title: 'PairOfCleats repository',
      placeHolder: 'Select the repository root to use for subsequent commands'
    });
  if (!picked) return;
  await persistSelectedRepoCandidate(picked);
  vscode.window.showInformationMessage(`PairOfCleats will use ${picked.repoLabel} until you clear the selection.`);
}

async function clearSelectedRepo() {
  await persistSelectedRepoCandidate(null);
  vscode.window.showInformationMessage('PairOfCleats cleared the explicit repository selection.');
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
  const spec = OPERATOR_COMMANDS_BY_ID.get(session.commandId) || {
    id: session.commandId,
    title: session.title,
    progressTitle: session.title,
    timeoutMs: session.invocation.timeoutMs || 60000
  };
  const repoContext = {
    ok: true,
    repoRoot: session.repoRoot,
    repoUri: parsePersistedUri(session.workspaceUri, vscode.Uri.file(session.repoRoot)),
    workspacePath: session.workspacePath || session.repoRoot,
    workspaceUriString: session.workspaceUri || '',
    workspaceFolder: { uri: parsePersistedUri(session.workspaceUri, vscode.Uri.file(session.repoRoot)) }
  };
  if (session.invocation?.kind === 'api-request') {
    if (!session.invocation.baseUrl || !session.invocation.path || !session.invocation.method) {
      vscode.window.showErrorMessage('PairOfCleats cannot rerun that workflow because its API invocation was not preserved.');
      return;
    }
    return executeApiOperatorWorkflow(spec, repoContext, {
      baseUrl: session.invocation.baseUrl,
      timeoutMs: session.invocation.timeoutMs || spec.timeoutMs,
      path: session.invocation.path,
      method: session.invocation.method,
      payload: session.invocation.payload || null,
      transport: session.invocation.transport || 'api',
      normalizePayload: spec.id === 'pairofcleats.indexHealth'
        ? (payload) => payload?.status || payload
        : null
    });
  }
  if (!session?.invocation?.command || !Array.isArray(session?.invocation?.args)) {
    vscode.window.showErrorMessage('PairOfCleats cannot rerun that workflow because its invocation was not preserved.');
    return;
  }
  if (session.invocation.kind === 'managed-process') {
    const managedSpec = MANAGED_COMMANDS_BY_ID.get(session.commandId);
    if (!managedSpec) {
      vscode.window.showErrorMessage('PairOfCleats cannot rerun that workflow because its managed command is no longer registered.');
      return;
    }
    return startManagedCommand(managedSpec, {
      repoContext,
      invocation: {
        command: session.invocation.command,
        args: session.invocation.args.slice(),
        timeoutMs: session.invocation.timeoutMs,
        persistent: session.invocation.persistent === true
      }
    });
  }
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
  const passiveRepo = resolvePassiveRepoContext();
  const items = [
    {
      label: 'Reopen PairOfCleats output',
      description: 'Show the output channel',
      action: 'output'
    }
  ];
  if (passiveRepo.ok) {
    items.push({
      label: passiveRepo.source === 'selected-repo' ? 'Clear selected repository' : 'Select repository',
      description: passiveRepo.repoLabel,
      action: passiveRepo.source === 'selected-repo' ? 'clear-selected-repo' : 'select-repo'
    });
  } else {
    items.push({
      label: 'Select repository',
      description: 'Pick a repo for subsequent commands',
      action: 'select-repo'
    });
  }
  const runningSession = getMostRecentRunningWorkflowSession();
  if (runningSession && MANAGED_COMMANDS_BY_ID.has(runningSession.commandId)) {
    const managedSpec = MANAGED_COMMANDS_BY_ID.get(runningSession.commandId);
    items.push({
      label: `Stop ${managedSpec.title.replace(/^PairOfCleats:\s*/, '')}`,
      description: runningSession.repoLabel,
      action: 'stop-running'
    });
  }
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
  if (selection.action === 'select-repo') {
    await selectRepo();
    return;
  }
  if (selection.action === 'clear-selected-repo') {
    await clearSelectedRepo();
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
  if (selection.action === 'stop-running') {
    if (!runningSession) return;
    const stopSpec = Array.from(MANAGED_STOP_COMMANDS_BY_ID.values()).find((entry) => entry.targetId === runningSession.commandId);
    if (stopSpec) {
      await stopManagedCommand(stopSpec);
    }
    return;
  }
  if (selection.action === 'recent') {
    await showRecentWorkflows();
  }
}

function createTreeChangeEmitter() {
  if (typeof vscode.EventEmitter === 'function') {
    return new vscode.EventEmitter();
  }
  const emitter = new NodeEventEmitter();
  return {
    event(listener) {
      emitter.on('change', listener);
      return {
        dispose() {
          emitter.off('change', listener);
        }
      };
    },
    fire(value) {
      emitter.emit('change', value);
    },
    dispose() {
      emitter.removeAllListeners('change');
    }
  };
}

function normalizeSearchHit(hit) {
  if (!hit || typeof hit !== 'object' || !hit.file) return null;
  return {
    file: String(hit.file),
    section: String(hit.section || 'code'),
    headline: hit.headline ? String(hit.headline) : '',
    name: hit.name ? String(hit.name) : '',
    score: Number.isFinite(hit.score) ? Number(hit.score) : null,
    scoreType: hit.scoreType ? String(hit.scoreType) : '',
    startLine: Number.isFinite(hit.startLine) ? Number(hit.startLine) : null,
    startCol: Number.isFinite(hit.startCol) ? Number(hit.startCol) : null,
    endLine: Number.isFinite(hit.endLine) ? Number(hit.endLine) : null,
    endCol: Number.isFinite(hit.endCol) ? Number(hit.endCol) : null
  };
}

function normalizeSearchResultSet(rawResultSet) {
  if (!rawResultSet || typeof rawResultSet !== 'object') return null;
  const resultSetId = String(rawResultSet.resultSetId || '').trim();
  const query = String(rawResultSet.query || '').trim();
  const repoRoot = String(rawResultSet.repoRoot || '').trim();
  if (!resultSetId || !query || !repoRoot) return null;
  const hits = Array.isArray(rawResultSet.hits)
    ? rawResultSet.hits.map((hit) => normalizeSearchHit(hit)).filter(Boolean)
    : [];
  return {
    resultSetId,
    query,
    repoRoot,
    repoLabel: formatRepoLabel(repoRoot),
    repoUri: rawResultSet.repoUri ? String(rawResultSet.repoUri) : '',
    createdAt: String(rawResultSet.createdAt || ''),
    mode: rawResultSet.mode ? String(rawResultSet.mode) : '',
    backend: rawResultSet.backend ? String(rawResultSet.backend) : '',
    totalHits: Number.isFinite(rawResultSet.totalHits) ? Number(rawResultSet.totalHits) : hits.length,
    invocation: normalizeSearchInvocation(rawResultSet.invocation),
    hits
  };
}

function parsePersistedUri(value, fallbackUri) {
  const text = String(value || '').trim();
  if (!text) return fallbackUri;
  if (typeof vscode.Uri.parse === 'function') {
    return vscode.Uri.parse(text);
  }
  const match = text.match(/^([a-z0-9+.-]+):(.*)$/i);
  const scheme = match ? match[1] : (fallbackUri?.scheme || 'file');
  const uriPath = match ? match[2] : text;
  return {
    ...(fallbackUri || {}),
    scheme,
    path: uriPath,
    fsPath: scheme === 'file' ? uriPath.replace(/\//g, path.sep) : uriPath,
    toString() {
      return `${this.scheme}:${this.path || this.fsPath || ''}`;
    }
  };
}

function createStoredRepoContext(resultSet) {
  if (!resultSet?.repoRoot) return null;
  const repoUri = resultSet.repoUri
    ? parsePersistedUri(resultSet.repoUri, vscode.Uri.file(resultSet.repoRoot))
    : vscode.Uri.file(resultSet.repoRoot);
  return {
    repoRoot: resultSet.repoRoot,
    repoUri
  };
}

function normalizeSearchHistory(rawHistory) {
  return Array.isArray(rawHistory)
    ? rawHistory.map((entry) => normalizeSearchResultSet(entry)).filter(Boolean).slice(0, MAX_SEARCH_HISTORY)
    : [];
}

function readSearchGroupMode() {
  const rawMode = String(readWorkspaceState(SEARCH_GROUP_MODE_STORAGE_KEY, 'section') || 'section');
  return new Set(['section', 'file', 'query']).has(rawMode) ? rawMode : 'section';
}

async function persistSearchHistory() {
  searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY);
  await writeWorkspaceState(SEARCH_HISTORY_STORAGE_KEY, searchHistory);
  await writeWorkspaceState('pairofcleats.searchResults.active', activeSearchResultId || '');
}

async function persistSearchGroupingMode() {
  await writeWorkspaceState(SEARCH_GROUP_MODE_STORAGE_KEY, searchGroupMode);
}

function getActiveSearchResultSet() {
  return searchHistory.find((entry) => entry.resultSetId === activeSearchResultId) || searchHistory[0] || null;
}

function createTreeItem(label, { description = '', tooltip = '', collapsibleState = 0, command = null, contextValue = '' } = {}) {
  if (typeof vscode.TreeItem === 'function') {
    const item = new vscode.TreeItem(label, collapsibleState);
    item.description = description;
    item.tooltip = tooltip || label;
    item.command = command || undefined;
    item.contextValue = contextValue || undefined;
    return item;
  }
  return {
    label,
    description,
    tooltip: tooltip || label,
    collapsibleState,
    command,
    contextValue
  };
}

function buildResultsTree() {
  const activeResultSet = getActiveSearchResultSet();
  if (!activeResultSet) return [];
  if (searchGroupMode === 'query') {
    return searchHistory.slice(0, 10).map((resultSet) => ({
      kind: 'result-set',
      resultSet,
      treeItem: createTreeItem(resultSet.query, {
        description: `${resultSet.repoLabel} • ${resultSet.totalHits} hit(s)`,
        tooltip: `${resultSet.repoRoot}\n${resultSet.query}`,
        collapsibleState: 1,
        contextValue: 'pairofcleats.resultSet'
      }),
      children: resultSet.hits.map((hit) => buildResultHitNode(resultSet, hit))
    }));
  }
  const groups = new Map();
  for (const hit of activeResultSet.hits) {
    const key = searchGroupMode === 'file' ? hit.file : hit.section;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hit);
  }
  return Array.from(groups.entries()).map(([key, hits]) => ({
    kind: 'group',
    treeItem: createTreeItem(
      key,
      {
        description: `${hits.length} hit(s)`,
        collapsibleState: 1,
        contextValue: 'pairofcleats.resultGroup'
      }
    ),
    children: hits.map((hit) => buildResultHitNode(activeResultSet, hit))
  }));
}

function buildResultHitNode(resultSet, hit) {
  const label = hit.name || hit.headline || hit.file;
  return {
    kind: 'hit',
    resultSet,
    hit,
    treeItem: createTreeItem(label, {
      description: `${hit.file}${Number.isFinite(hit.startLine) ? `:${hit.startLine}` : ''}`,
      tooltip: `${hit.section}${hit.score !== null ? ` • score ${hit.score}` : ''}`,
      collapsibleState: 0,
      command: {
        command: 'pairofcleats.openResultHit',
        title: 'Open Result',
        arguments: [{ resultSet, hit }]
      },
      contextValue: 'pairofcleats.resultHit'
    }),
    children: []
  };
}

function refreshResultsExplorer() {
  resultsTreeProvider?.refresh?.();
}

function ensureResultsExplorer() {
  if (resultsTreeProvider) return;
  const emitter = createTreeChangeEmitter();
  resultsTreeProvider = {
    _emitter: emitter,
    onDidChangeTreeData: emitter.event,
    refresh() {
      emitter.fire(undefined);
    },
    getTreeItem(element) {
      return element.treeItem;
    },
    getChildren(element) {
      return element ? (element.children || []) : buildResultsTree();
    }
  };
  if (typeof vscode.window.createTreeView === 'function') {
    resultsTreeView = vscode.window.createTreeView(SEARCH_RESULTS_VIEW_ID, {
      treeDataProvider: resultsTreeProvider,
      showCollapseAll: true
    });
    extensionContext?.subscriptions?.push?.(resultsTreeView);
  }
}

async function recordSearchResultSet({
  repoContext,
  query,
  searchOptions,
  invocation,
  hits
}) {
  const resultSet = normalizeSearchResultSet({
    resultSetId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    query,
    repoRoot: repoContext.repoRoot,
    repoUri: repoContext.repoUri && typeof repoContext.repoUri.toString === 'function' ? repoContext.repoUri.toString() : '',
    createdAt: new Date().toISOString(),
    mode: searchOptions.mode,
    backend: searchOptions.backend,
    totalHits: hits.length,
    invocation,
    hits
  });
  if (!resultSet) return null;
  searchHistory = [resultSet, ...searchHistory.filter((entry) => entry.resultSetId !== resultSet.resultSetId)].slice(0, MAX_SEARCH_HISTORY);
  activeSearchResultId = resultSet.resultSetId;
  await persistSearchHistory();
  refreshResultsExplorer();
  return resultSet;
}

async function openResultHitNode(node) {
  if (!node?.hit || !node?.resultSet) return;
  const repoContext = createStoredRepoContext(node.resultSet);
  const result = await openSearchHit(vscode, repoContext, node.hit);
  if (!result.ok) {
    getOutputChannel().appendLine(result.detail || result.message);
    getOutputChannel().show?.(true);
    vscode.window.showErrorMessage(result.message);
  }
}

async function revealResultHitNode(node) {
  if (!node?.hit?.file) return;
  const repoContext = createStoredRepoContext(node.resultSet);
  const target = resolveValidatedHitTarget(vscode, repoContext, node.hit);
  if (!target.ok) {
    getOutputChannel().appendLine(target.detail || target.message);
    getOutputChannel().show?.(true);
    vscode.window.showErrorMessage(target.message);
    return;
  }
  await vscode.commands.executeCommand?.('revealInExplorer', target.targetUri);
}

async function copyResultHitPath(node) {
  if (!node?.hit?.file || typeof vscode.env?.clipboard?.writeText !== 'function') return;
  const repoContext = createStoredRepoContext(node.resultSet);
  const target = resolveValidatedHitTarget(vscode, repoContext, node.hit);
  if (!target.ok) {
    getOutputChannel().appendLine(target.detail || target.message);
    getOutputChannel().show?.(true);
    vscode.window.showErrorMessage(target.message);
    return;
  }
  const printablePath = target.targetUri?.scheme && target.targetUri.scheme !== 'file'
    ? (typeof target.targetUri.toString === 'function'
      ? target.targetUri.toString()
      : `${target.targetUri.scheme}:${target.targetUri.path || target.targetUri.fsPath || ''}`)
    : target.filePath;
  await vscode.env.clipboard.writeText(printablePath);
  vscode.window.showInformationMessage(`PairOfCleats copied ${printablePath}`);
}

async function reopenLastResults() {
  const resultSet = getActiveSearchResultSet();
  if (!resultSet) {
    vscode.window.showInformationMessage('PairOfCleats has no saved search results.');
    return;
  }
  activeSearchResultId = resultSet.resultSetId;
  await persistSearchHistory();
  refreshResultsExplorer();
  vscode.window.showInformationMessage(`PairOfCleats reopened results for "${resultSet.query}".`);
}

async function rerunResultSet(nodeOrResultSet) {
  const resultSet = nodeOrResultSet?.resultSet || nodeOrResultSet;
  const invocation = resultSet?.invocation || null;
  const canRerun = (invocation?.kind === 'api-search' && invocation.payload)
    || (invocation?.command && Array.isArray(invocation?.args));
  if (!canRerun) {
    vscode.window.showErrorMessage('PairOfCleats cannot rerun that result set because its invocation was not preserved.');
    return;
  }
  const output = getOutputChannel();
  const repoContext = createStoredRepoContext(resultSet);
  output.appendLine(`[search] rerun query=${resultSet.query}`);
  const parsedResult = await runSavedSearchInvocation(resultSet, repoContext);
  if (parsedResult?.ok) {
    vscode.window.showInformationMessage(`PairOfCleats reran "${resultSet.query}".`);
  }
}

async function showSearchHistory() {
  if (!searchHistory.length || typeof vscode.window.showQuickPick !== 'function') {
    vscode.window.showInformationMessage('PairOfCleats has no saved search history.');
    return;
  }
  const selection = await vscode.window.showQuickPick(
    searchHistory.slice(0, 10).map((resultSet) => ({
      label: resultSet.query,
      description: `${resultSet.repoLabel} • ${resultSet.totalHits} hit(s)`,
      detail: resultSet.createdAt,
      resultSet
    })),
    {
      title: 'PairOfCleats search history',
      placeHolder: 'Select a result set to reopen'
    }
  );
  if (!selection?.resultSet) return;
  await rerunResultSet(selection.resultSet);
}

async function repeatLastSearch() {
  const resultSet = getActiveSearchResultSet();
  if (!resultSet) {
    vscode.window.showInformationMessage('PairOfCleats has no saved search to repeat.');
    return;
  }
  await rerunResultSet(resultSet);
}

async function openIndexDirectory() {
  const repoContext = await resolveSearchRepoContext();
  if (!repoContext) return;
  const spec = OPERATOR_COMMANDS_BY_ID.get('pairofcleats.configDump');
  if (!spec) {
    vscode.window.showErrorMessage('PairOfCleats could not locate the config-dump command.');
    return;
  }
  const config = getExtensionConfiguration();
  const cliResolution = resolveCli(repoContext.repoRoot, config);
  const invocation = resolveOperatorInvocation(spec, repoContext, cliResolution, undefined);
  if (!invocation.ok) {
    const output = getOutputChannel();
    output.appendLine(invocation.detail || invocation.message);
    output.show?.(true);
    vscode.window.showErrorMessage(invocation.message);
    return;
  }
  const output = getOutputChannel();
  const result = await runBufferedJsonCommand({
    spec,
    repoRoot: repoContext.repoRoot,
    command: invocation.command,
    args: invocation.args,
    env: buildSpawnEnv(config),
    output
  });
  if (!result?.payload) {
    if (result?.detail) output.appendLine(result.detail);
    output.show?.(true);
    const show = result?.kind === 'cancelled'
      ? vscode.window.showInformationMessage
      : vscode.window.showErrorMessage;
    show(result?.message || 'PairOfCleats could not resolve the index directory.');
    return;
  }
  const repoCacheRoot = String(result.payload?.derived?.repoCacheRoot || '').trim();
  if (!repoCacheRoot) {
    vscode.window.showErrorMessage('PairOfCleats config dump did not report a repo cache root.');
    return;
  }
  const targetUri = vscode.Uri.file(repoCacheRoot);
  if (typeof vscode.commands.executeCommand === 'function') {
    await vscode.commands.executeCommand('revealInExplorer', targetUri);
  } else if (typeof vscode.env?.openExternal === 'function') {
    await vscode.env.openExternal(targetUri);
  }
  vscode.window.showInformationMessage(`PairOfCleats opened index directory for ${formatRepoLabel(repoContext.repoRoot)}.`);
}

async function setSearchGroupingMode(mode) {
  if (!new Set(['section', 'file', 'query']).has(mode)) return;
  searchGroupMode = mode;
  await persistSearchGroupingMode();
  refreshResultsExplorer();
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

function getActiveEditorSelections(editor) {
  if (Array.isArray(editor?.selections) && editor.selections.length) {
    return editor.selections;
  }
  if (editor?.selection) {
    return [editor.selection];
  }
  return [];
}

function selectionHasContent(selection) {
  if (!selection) return false;
  if (typeof selection.isEmpty === 'boolean') return !selection.isEmpty;
  const start = selection.start || null;
  const end = selection.end || null;
  if (!start || !end) return true;
  return start.line !== end.line || start.character !== end.character;
}

function getSelectionSearchQuery() {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  if (!document || typeof document.getText !== 'function') return '';
  for (const selection of getActiveEditorSelections(editor)) {
    if (!selectionHasContent(selection)) continue;
    const text = String(document.getText(selection) || '').trim();
    if (text) return text;
  }
  return '';
}

function getSymbolSearchQuery() {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  const selection = editor?.selection || null;
  const position = selection?.active || selection?.start || null;
  if (!document || typeof document.getWordRangeAtPosition !== 'function' || !position) return '';
  const range = document.getWordRangeAtPosition(position);
  if (!range || typeof document.getText !== 'function') return '';
  return String(document.getText(range) || '').trim();
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
    id: 'pairofcleats.indexValidate',
    title: 'PairOfCleats: Index Validate',
    progressTitle: 'PairOfCleats index validate',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'script',
    scriptParts: ['tools', 'index', 'validate.js'],
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

const MANAGED_COMMAND_SPECS = Object.freeze([
  {
    id: 'pairofcleats.indexBuild',
    title: 'PairOfCleats: Index Build',
    progressTitle: 'PairOfCleats index build',
    invocation: 'cli',
    cliArgs: ['index', 'build'],
    timeoutMs: 30 * 60 * 1000,
    persistent: false,
    buildArgs(repoRoot) {
      return ['--repo', repoRoot, '--progress', 'log'];
    }
  },
  {
    id: 'pairofcleats.indexWatchStart',
    title: 'PairOfCleats: Index Watch',
    progressTitle: 'PairOfCleats index watch',
    invocation: 'cli',
    cliArgs: ['index', 'watch'],
    timeoutMs: 0,
    persistent: true,
    stopCommandId: 'pairofcleats.indexWatchStop',
    buildArgs(repoRoot) {
      return ['--repo', repoRoot, '--progress', 'log'];
    }
  },
  {
    id: 'pairofcleats.serviceApiStart',
    title: 'PairOfCleats: Service API',
    progressTitle: 'PairOfCleats service api',
    invocation: 'cli',
    cliArgs: ['service', 'api'],
    timeoutMs: 0,
    persistent: true,
    stopCommandId: 'pairofcleats.serviceApiStop',
    buildArgs(repoRoot) {
      return ['--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.serviceIndexerStart',
    title: 'PairOfCleats: Service Indexer',
    progressTitle: 'PairOfCleats service indexer',
    invocation: 'cli',
    cliArgs: ['service', 'indexer'],
    timeoutMs: 0,
    persistent: true,
    stopCommandId: 'pairofcleats.serviceIndexerStop',
    buildArgs(repoRoot) {
      return ['--repo', repoRoot, '--watch'];
    }
  }
]);

const MANAGED_COMMANDS_BY_ID = new Map(MANAGED_COMMAND_SPECS.map((spec) => [spec.id, spec]));

const MANAGED_STOP_COMMAND_SPECS = Object.freeze([
  {
    id: 'pairofcleats.indexWatchStop',
    title: 'PairOfCleats: Stop Index Watch',
    targetId: 'pairofcleats.indexWatchStart'
  },
  {
    id: 'pairofcleats.serviceApiStop',
    title: 'PairOfCleats: Stop Service API',
    targetId: 'pairofcleats.serviceApiStart'
  },
  {
    id: 'pairofcleats.serviceIndexerStop',
    title: 'PairOfCleats: Stop Service Indexer',
    targetId: 'pairofcleats.serviceIndexerStart'
  }
]);

const MANAGED_STOP_COMMANDS_BY_ID = new Map(MANAGED_STOP_COMMAND_SPECS.map((spec) => [spec.id, spec]));

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
      const spawned = spawnBufferedProcess(cp, invocation.command, invocation.args, {
        cwd: repoRoot,
        env: invocation.env ? { ...env, ...invocation.env } : env,
        shell: false,
        windowsHide: true
      });
      if (!spawned.ok) {
        resolve({
          ok: false,
          ...summarizeSpawnFailure(spec.title, spawned.error)
        });
        return;
      }
      const child = spawned.child;
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
          ...summarizeSpawnFailure(spec.title, error)
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
        const parsed = parseJsonPayload(stdout, {
          stdoutTruncated: stdoutAccumulator.truncated(),
          label: spec.title
        });
        if (parsed.ok) {
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
          kind: parsed.kind,
          message: parsed.message,
          detail: parsed.detail || stderr || stdout || null
        });
      });
    })
  );
}

async function runApiJsonCommand({
  spec,
  label,
  baseUrl,
  timeoutMs,
  headers = null,
  requestPath,
  method = 'GET',
  payload = null,
  output
}) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: spec.progressTitle,
      cancellable: false
    },
    async () => {
      output.appendLine(`[api] ${method} ${normalizeApiBaseUrl(baseUrl)}${requestPath}`);
      return requestApiJson(baseUrl, requestPath, {
        method,
        payload,
        headers,
        timeoutMs,
        label
      });
    }
  );
}

async function executeApiOperatorWorkflow(spec, repoContext, request) {
  const output = getOutputChannel();
  output.appendLine('');
  output.appendLine(`=== ${spec.title} ===`);
  output.appendLine(`[api] baseUrl=${request.baseUrl}`);
  const session = await beginWorkflowSession(spec, repoContext, {
    kind: 'api-request',
    baseUrl: request.baseUrl,
    path: request.path,
    method: request.method,
    timeoutMs: request.timeoutMs,
    transport: 'api',
    payload: request.payload || null
  });
  const result = await runApiJsonCommand({
    spec,
    label: spec.title,
    baseUrl: request.baseUrl,
    timeoutMs: request.timeoutMs,
    headers: request.headers || null,
    requestPath: request.path,
    method: request.method,
    payload: request.payload,
    output
  });
  if (!result.ok) {
    if (result.detail) output.appendLine(result.detail);
    output.show?.(true);
    await finishWorkflowSession(session.sessionId, {
      status: 'failed',
      summaryLine: result.message
    });
    vscode.window.showErrorMessage(result.message);
    return;
  }
  const payload = typeof request.normalizePayload === 'function'
    ? request.normalizePayload(result.payload)
    : result.payload;
  const summaryLines = summarizeOperatorPayload(spec, payload);
  for (const line of summaryLines) {
    output.appendLine(line);
  }
  output.appendLine(JSON.stringify(payload, null, 2));
  output.show?.(true);
  await finishWorkflowSession(session.sessionId, {
    status: 'succeeded',
    summaryLine: `${spec.title} completed.`
  });
  vscode.window.showInformationMessage(`${spec.title} completed.`);
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
  const config = getExtensionConfiguration();
  const workflow = spec.id === 'pairofcleats.indexHealth' ? 'index-health' : null;
  const execution = workflow ? await resolveExecutionMode(config, workflow) : { ok: true, mode: 'cli', headers: buildApiHeaders(config) };
  if (!execution.ok) {
    const output = getOutputChannel();
    output.appendLine(execution.detail || execution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(execution.message);
    return;
  }
  appendExecutionFallbackNote(getOutputChannel(), execution);
  const repoContext = await resolveRepoContext({ allowRemote: execution.mode === 'api' });
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
  const cliResolution = resolveCli(repoRoot, config);
  const inputContext = typeof spec.resolveInput === 'function'
    ? await spec.resolveInput(repoContext)
    : undefined;
  if (inputContext === null) {
    return;
  }
  if (execution.mode === 'api' && spec.id === 'pairofcleats.indexHealth') {
    const requestPath = `/status?repo=${encodeURIComponent(repoRoot)}`;
    await executeApiOperatorWorkflow(spec, repoContext, {
      baseUrl: execution.baseUrl,
      timeoutMs: execution.timeoutMs,
      headers: execution.headers || null,
      path: requestPath,
      method: 'GET',
      payload: null,
      transport: 'api',
      normalizePayload: (payload) => payload?.status || payload
    });
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
  if (spec.invocation !== 'script' && !cliResolution.ok) {
    const output = getOutputChannel();
    output.appendLine(cliResolution.detail || cliResolution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(cliResolution.message);
    return;
  }
  await executeOperatorWorkflow(spec, repoContext, invocation);
}

function resolveManagedInvocation(spec, repoContext, cliResolution) {
  const repoRoot = repoContext.repoRoot;
  if (!cliResolution.ok) {
    return cliResolution;
  }
  const extraArgs = typeof spec.buildArgs === 'function' ? spec.buildArgs(repoRoot, repoContext) : [];
  return {
    ok: true,
    command: cliResolution.command,
    args: [...cliResolution.argsPrefix, ...spec.cliArgs, ...extraArgs]
  };
}

function getManagedProcessKey(spec, repoRoot) {
  return `${spec.id}:${repoRoot}`;
}

function appendStreamChunk(output, prefix, chunkState, chunk) {
  const text = `${chunkState.carry}${String(chunk || '')}`;
  const lines = text.split(/\r?\n/);
  chunkState.carry = lines.pop() || '';
  for (const line of lines) {
    output.appendLine(`${prefix}${line}`);
  }
}

function flushStreamChunk(output, prefix, chunkState) {
  if (!chunkState.carry) return;
  output.appendLine(`${prefix}${chunkState.carry}`);
  chunkState.carry = '';
}

function killChildProcess(child) {
  if (!child || typeof child.kill !== 'function') return;
  try {
    child.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {}
  }, 5000).unref?.();
}

function appendRuntimeFailure(output, prefix, failure) {
  output.appendLine(`${prefix} failure kind=${failure.kind}`);
  if (failure.detail) output.appendLine(failure.detail);
}

function appendExecutionFallbackNote(output, execution) {
  if (!execution || execution.mode !== 'cli' || execution.configuredMode !== 'prefer') return;
  const detail = String(execution.fallbackDetail || execution.fallbackReason || '').trim();
  if (!detail) return;
  output.appendLine(`[transport] API fallback -> CLI: ${detail}`);
}

async function stopManagedProcessEntry(entry, { reason = 'cancelled', summaryLine } = {}) {
  if (!entry || entry.stopping) return false;
  entry.stopping = true;
  entry.stopReason = reason;
  entry.stopSummaryLine = summaryLine || '';
  killChildProcess(entry.child);
  return entry.completion;
}

async function stopManagedCommand(stopSpec) {
  const repoContext = await resolveRepoContext();
  if (!repoContext.ok) {
    if (repoContext.message) {
      vscode.window.showErrorMessage(repoContext.message);
    }
    return;
  }
  const managedSpec = MANAGED_COMMANDS_BY_ID.get(stopSpec.targetId);
  if (!managedSpec) {
    vscode.window.showErrorMessage(`${stopSpec.title} is not configured correctly.`);
    return;
  }
  const key = getManagedProcessKey(managedSpec, repoContext.repoRoot);
  const active = managedProcesses.get(key);
  if (!active) {
    vscode.window.showInformationMessage(`${managedSpec.title} is not running for ${formatRepoLabel(repoContext.repoRoot)}.`);
    return;
  }
  const output = getOutputChannel();
  output.appendLine(`[managed] stopping ${managedSpec.title}`);
  output.show?.(true);
  await stopManagedProcessEntry(active, {
    reason: 'cancelled',
    summaryLine: `${managedSpec.title} stopped.`
  });
  vscode.window.showInformationMessage(`${managedSpec.title} stopped.`);
}

async function startManagedCommand(spec, { repoContext: seededRepoContext = null, invocation: seededInvocation = null } = {}) {
  const repoContext = seededRepoContext || await resolveRepoContext();
  if (!repoContext.ok) {
    if (repoContext.message) {
      vscode.window.showErrorMessage(repoContext.message);
    }
    return;
  }
  const { repoRoot } = repoContext;
  const config = getExtensionConfiguration();
  const cliResolution = resolveCli(repoRoot, config);
  const invocation = seededInvocation || resolveManagedInvocation(spec, repoContext, cliResolution);
  if (!invocation.ok) {
    const output = getOutputChannel();
    output.appendLine(invocation.detail || invocation.message);
    output.show?.(true);
    vscode.window.showErrorMessage(invocation.message);
    return;
  }
  const key = getManagedProcessKey(spec, repoRoot);
  const existing = managedProcesses.get(key);
  if (existing) {
    const output = getOutputChannel();
    output.appendLine(`[managed] ${spec.title} already running for ${repoRoot}`);
    output.show?.(true);
    vscode.window.showInformationMessage(`${spec.title} is already running for ${formatRepoLabel(repoRoot)}.`);
    return existing.completion;
  }
  const output = getOutputChannel();
  const env = buildSpawnEnv(config);
  output.appendLine('');
  output.appendLine(`=== ${spec.title} ===`);
  output.appendLine(`[command] command=${invocation.command}`);
  output.appendLine(`[command] args=${JSON.stringify(invocation.args)}`);
  output.show?.(true);
  const useShellWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.command);
  const resolved = useShellWrapper
    ? resolveWindowsCmdInvocation(invocation.command, invocation.args)
    : { command: invocation.command, args: invocation.args };
  const spawned = spawnBufferedProcess(cp, resolved.command, resolved.args, {
    cwd: repoRoot,
    env: resolved.env ? { ...env, ...resolved.env } : env,
    shell: false,
    windowsHide: true
  });
  if (!spawned.ok) {
    const failure = summarizeSpawnFailure(spec.title, spawned.error);
    output.appendLine(failure.detail || failure.message);
    output.show?.(true);
    vscode.window.showErrorMessage(failure.message);
    return;
  }
  const child = spawned.child;
  const session = await beginWorkflowSession(spec, repoContext, {
    kind: 'managed-process',
    command: invocation.command,
    args: invocation.args,
    timeoutMs: Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : 0,
    persistent: spec.persistent === true
  });
  noteRepoContext(repoContext);
  const stdoutState = { carry: '' };
  const stderrState = { carry: '' };
  let timedOut = false;
  let resolvedCompletion = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const finalize = async ({ code = 0, error = null } = {}) => {
    if (resolvedCompletion) return;
    resolvedCompletion = true;
    managedProcesses.delete(key);
    flushStreamChunk(output, '[stdout] ', stdoutState);
    flushStreamChunk(output, '[stderr] ', stderrState);
    const stoppedByUser = entry.stopReason === 'cancelled';
    const failed = Boolean(error) || timedOut || (!stoppedByUser && code !== 0);
    const status = stoppedByUser ? 'cancelled' : failed ? 'failed' : 'succeeded';
    const summaryLine = stoppedByUser
      ? (entry.stopSummaryLine || `${spec.title} stopped.`)
      : failed
        ? `${spec.title} exited with code ${code}.`
        : `${spec.title} completed.`;
    await finishWorkflowSession(session.sessionId, { status, summaryLine });
    if (!stoppedByUser) {
      if (failed) {
        output.appendLine(`[managed] ${summaryLine}`);
        vscode.window.showErrorMessage(`${summaryLine} See PairOfCleats output for details.`);
      } else if (spec.persistent !== true) {
        vscode.window.showInformationMessage(`${spec.title} completed.`);
      }
    }
    resolveCompletion({ ok: !failed, status, code });
  };
  const entry = {
    key,
    spec,
    child,
    sessionId: session.sessionId,
    stopReason: null,
    stopping: false,
    completion
  };
  managedProcesses.set(key, entry);
  if (Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0) {
    entry.timeout = setTimeout(() => {
      timedOut = true;
      output.appendLine(`[managed] timeout after ${spec.timeoutMs}ms`);
      killChildProcess(child);
    }, spec.timeoutMs);
    entry.timeout.unref?.();
  }
  child.stdout?.on('data', (chunk) => appendStreamChunk(output, '[stdout] ', stdoutState, chunk));
  child.stderr?.on('data', (chunk) => appendStreamChunk(output, '[stderr] ', stderrState, chunk));
  child.once('error', async (error) => {
    clearTimeout(entry.timeout);
    output.appendLine(`[managed] spawn error=${error?.message || error}`);
    await finalize({ code: 1, error });
  });
  child.once('close', async (code) => {
    clearTimeout(entry.timeout);
    await finalize({ code: Number.isFinite(code) ? code : 1 });
  });
  if (spec.persistent) {
    const stopTitle = spec.stopCommandId
      ? (MANAGED_STOP_COMMANDS_BY_ID.get(spec.stopCommandId)?.title || 'the stop command')
      : 'the stop command';
    vscode.window.showInformationMessage(`${spec.title} started. Use ${stopTitle} to stop it.`);
    return { ok: true, status: 'running', sessionId: session.sessionId };
  }
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: spec.progressTitle,
      cancellable: true
    },
    async (_, token) => {
      const cancelSub = token.onCancellationRequested(() => {
        output.appendLine(`[managed] cancellation requested for ${spec.title}`);
        void stopManagedProcessEntry(entry, {
          reason: 'cancelled',
          summaryLine: `${spec.title} cancelled.`
        });
      });
      try {
        return await completion;
      } finally {
        cancelSub.dispose();
      }
    }
  );
}

async function resolveSearchRepoContext(options = {}) {
  const repoContext = await resolveRepoContext(options);
  if (!repoContext.ok) {
    if (repoContext.message) {
      if (repoContext.detail) {
        const output = getOutputChannel();
        output.appendLine(repoContext.detail);
        output.show?.(true);
      }
      vscode.window.showErrorMessage(repoContext.message);
    }
    return null;
  }
  return repoContext;
}

async function promptSearchQuery({ prompt, placeHolder }) {
  const query = await promptTextInput({ prompt, placeHolder });
  return query && query.trim() ? query.trim() : null;
}

async function executeSearchCommand({
  query,
  explain = false,
  workflow = 'search',
  prompt = 'PairOfCleats search query',
  placeHolder = 'e.g. auth token validation'
} = {}) {
  const config = getExtensionConfiguration();
  const execution = await resolveExecutionMode(config, explain ? 'explain-search' : workflow);
  if (!execution.ok) {
    const output = getOutputChannel();
    output.appendLine(execution.detail || execution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(execution.message);
    return;
  }
  const repoContext = await resolveSearchRepoContext({ allowRemote: execution.mode === 'api' });
  if (!repoContext) return;
  const { repoRoot } = repoContext;
  const resolvedQuery = query && String(query).trim()
    ? String(query).trim()
    : await promptSearchQuery({ prompt, placeHolder });
  if (!resolvedQuery) return;

  const cliResolution = resolveCli(repoRoot, config);
  if (execution.mode === 'cli' && !cliResolution.ok) {
    vscode.window.showErrorMessage(cliResolution.message);
    const output = getOutputChannel();
    output.appendLine(cliResolution.detail || cliResolution.message);
    output.show?.(true);
    return;
  }
  const searchOptions = {
    ...readSearchOptions(config, VSCODE_SETTINGS),
    explain
  };
  let searchArgs = null;
  let searchPayload = null;
  try {
    if (execution.mode === 'api') {
      searchPayload = buildApiSearchRequest(resolvedQuery, repoRoot, searchOptions);
    } else {
      searchArgs = buildSearchArgs(resolvedQuery, repoRoot, searchOptions);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PairOfCleats search configuration is invalid.';
    const output = getOutputChannel();
    output.appendLine(`[search] invalid options: ${message}`);
    output.show?.(true);
    vscode.window.showErrorMessage(message);
    return;
  }
  const env = buildSpawnEnv(config);
  const searchTimeoutMs = 60000;
  const output = getOutputChannel();
  appendExecutionFallbackNote(output, execution);
  if (execution.mode === 'api') {
    output.appendLine(`[search] transport=api baseUrl=${execution.baseUrl}`);
  } else {
    const { command, argsPrefix } = cliResolution;
    const args = [...argsPrefix, ...searchArgs];
    output.appendLine(`[search] command=${command}`);
    output.appendLine(`[search] args=${JSON.stringify(args)}`);
  }
  noteRepoContext(repoContext);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'PairOfCleats search',
      cancellable: execution.mode !== 'api'
    },
    async (_, token) => {
      if (execution.mode === 'api') {
        const result = await requestApiJson(execution.baseUrl, '/search', {
          method: 'POST',
          payload: searchPayload,
          headers: execution.headers || null,
          timeoutMs: execution.timeoutMs,
          label: 'PairOfCleats search'
        });
        if (!result.ok) {
          appendRuntimeFailure(output, '[search api]', result);
          output.show?.(true);
          vscode.window.showErrorMessage(result.message);
          return;
        }
        const payload = result.payload?.result || result.payload;
        const hits = collectSearchHits(payload);
        await recordSearchResultSet({
          repoContext,
          query: resolvedQuery,
          searchOptions,
          invocation: {
            kind: 'api-search',
            baseUrl: execution.baseUrl,
            timeoutMs: execution.timeoutMs,
            payload: searchPayload,
            transport: 'api'
          },
          hits
        });
        if (!hits.length) {
          vscode.window.showInformationMessage('PairOfCleats: no results.');
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
        if (!selection) return;
        const openResult = await openSearchHit(vscode, repoContext, selection.hit);
        if (!openResult.ok) {
          output.appendLine(`[search] open failure path=${openResult.filePath}`);
          output.appendLine(openResult.detail);
          output.show?.(true);
          vscode.window.showErrorMessage(openResult.message);
        }
        return;
      }
      const { command, argsPrefix } = cliResolution;
      const args = [...argsPrefix, ...searchArgs];
      return await new Promise((resolve) => {
        const useShellWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
        const invocation = useShellWrapper
          ? resolveWindowsCmdInvocation(command, args)
          : { command, args };
        const spawned = spawnBufferedProcess(cp, invocation.command, invocation.args, {
          cwd: repoRoot,
          env: invocation.env ? { ...env, ...invocation.env } : env,
          shell: false,
          windowsHide: true
        });
        if (!spawned.ok) {
          const failure = summarizeSpawnFailure('PairOfCleats search', spawned.error);
          appendRuntimeFailure(output, '[search]', failure);
          output.show?.(true);
          vscode.window.showErrorMessage(failure.message);
          resolve();
          return;
        }
        const child = spawned.child;
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
          appendRuntimeFailure(output, '[search]', summarizeSpawnFailure('PairOfCleats search', error));
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
            appendRuntimeFailure(output, '[search]', processFailure);
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
            appendRuntimeFailure(output, '[search] parse', parsed);
            if (stderr.trim()) output.appendLine(stderr);
            output.show?.(true);
            vscode.window.showErrorMessage(parsed.message);
            resolve();
            return;
          }
          const payload = parsed.payload;

          const hits = collectSearchHits(payload);
          await recordSearchResultSet({
            repoContext,
            query: resolvedQuery,
            searchOptions,
            invocation: {
              kind: 'cli-search',
              command,
              args,
              transport: 'cli'
            },
            hits
          });

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
      });
    }
  );
}

/**
 * Prompt for query, run CLI search, and open selected result in editor.
 *
 * @returns {Promise<void>}
 */
async function runSearch() {
  await executeSearchCommand({ workflow: 'search' });
}

async function runSelectionSearch() {
  const query = getSelectionSearchQuery();
  if (!query) {
    vscode.window.showInformationMessage('PairOfCleats could not find a non-empty editor selection to search.');
    return;
  }
  await executeSearchCommand({ query, workflow: 'search', prompt: 'PairOfCleats selection search' });
}

async function runSymbolSearch() {
  const query = getSymbolSearchQuery();
  if (!query) {
    vscode.window.showInformationMessage('PairOfCleats could not resolve a symbol under the cursor.');
    return;
  }
  await executeSearchCommand({ query, workflow: 'search-symbol', prompt: 'PairOfCleats symbol search' });
}

async function runExplainSearch() {
  await executeSearchCommand({
    workflow: 'explain-search',
    explain: true,
    prompt: 'PairOfCleats explain search query',
    placeHolder: 'e.g. auth token validation'
  });
}

async function runSavedSearchInvocation(resultSet, repoContext) {
  const output = getOutputChannel();
  const invocation = resultSet?.invocation || null;
  let hits = [];
  if (invocation?.kind === 'api-search') {
    const result = await requestApiJson(invocation.baseUrl, '/search', {
      method: 'POST',
      payload: invocation.payload,
      headers: buildApiHeaders(getExtensionConfiguration()),
      timeoutMs: invocation.timeoutMs || DEFAULT_API_TIMEOUT_MS,
      label: 'PairOfCleats search'
    });
    if (!result.ok) {
      if (result.detail) output.appendLine(result.detail);
      output.show?.(true);
      vscode.window.showErrorMessage(result.message || 'PairOfCleats search failed.');
      return { ok: false };
    }
    hits = collectSearchHits(result.payload?.result || result.payload);
  } else {
    const searchTimeoutMs = 60000;
    const spec = { title: 'PairOfCleats search', progressTitle: 'PairOfCleats search', timeoutMs: searchTimeoutMs };
    const env = buildSpawnEnv(getExtensionConfiguration());
    const result = await runBufferedJsonCommand({
      spec,
      repoRoot: repoContext.repoRoot,
      command: resultSet.invocation.command,
      args: resultSet.invocation.args,
      env,
      output
    });
    if (!result?.payload) {
      if (result?.detail) output.appendLine(result.detail);
      output.show?.(true);
      const show = result?.kind === 'cancelled'
        ? vscode.window.showInformationMessage
        : vscode.window.showErrorMessage;
      show(result?.message || 'PairOfCleats search failed.');
      return { ok: false };
    }
    hits = collectSearchHits(result.payload);
  }
  await recordSearchResultSet({
    repoContext,
    query: resultSet.query,
    searchOptions: {
      mode: resultSet.mode,
      backend: resultSet.backend
    },
    invocation: resultSet.invocation,
    hits
  });
  return { ok: true, hits };
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
  searchHistory = normalizeSearchHistory(readWorkspaceState(SEARCH_HISTORY_STORAGE_KEY, []));
  activeSearchResultId = String(readWorkspaceState('pairofcleats.searchResults.active', '') || '').trim() || (searchHistory[0]?.resultSetId || null);
  searchGroupMode = readSearchGroupMode();
  ensureResultsExplorer();
  workflowStatusBar = typeof vscode.window.createStatusBarItem === 'function'
    ? vscode.window.createStatusBarItem(vscode.StatusBarAlignment?.Left ?? 0, 100)
    : null;
  if (workflowStatusBar) {
    workflowStatusBar.command = 'pairofcleats.showWorkflowStatus';
    workflowStatusBar.show?.();
    context.subscriptions.push(workflowStatusBar);
  }
  const searchCommand = vscode.commands.registerCommand('pairofcleats.search', runSearch);
  const searchSelectionCommand = vscode.commands.registerCommand('pairofcleats.searchSelection', runSelectionSearch);
  const searchSymbolCommand = vscode.commands.registerCommand('pairofcleats.searchSymbolUnderCursor', runSymbolSearch);
  const selectRepoCommand = vscode.commands.registerCommand('pairofcleats.selectRepo', selectRepo);
  const clearSelectedRepoCommand = vscode.commands.registerCommand('pairofcleats.clearSelectedRepo', clearSelectedRepo);
  const repeatLastSearchCommand = vscode.commands.registerCommand('pairofcleats.repeatLastSearch', repeatLastSearch);
  const explainSearchCommand = vscode.commands.registerCommand('pairofcleats.explainSearch', runExplainSearch);
  const openIndexDirectoryCommand = vscode.commands.registerCommand('pairofcleats.openIndexDirectory', openIndexDirectory);
  const indexBuildCommand = vscode.commands.registerCommand('pairofcleats.indexBuild', () => startManagedCommand(MANAGED_COMMANDS_BY_ID.get('pairofcleats.indexBuild')));
  const indexWatchStartCommand = vscode.commands.registerCommand('pairofcleats.indexWatchStart', () => startManagedCommand(MANAGED_COMMANDS_BY_ID.get('pairofcleats.indexWatchStart')));
  const indexWatchStopCommand = vscode.commands.registerCommand('pairofcleats.indexWatchStop', () => stopManagedCommand(MANAGED_STOP_COMMANDS_BY_ID.get('pairofcleats.indexWatchStop')));
  const serviceApiStartCommand = vscode.commands.registerCommand('pairofcleats.serviceApiStart', () => startManagedCommand(MANAGED_COMMANDS_BY_ID.get('pairofcleats.serviceApiStart')));
  const serviceApiStopCommand = vscode.commands.registerCommand('pairofcleats.serviceApiStop', () => stopManagedCommand(MANAGED_STOP_COMMANDS_BY_ID.get('pairofcleats.serviceApiStop')));
  const serviceIndexerStartCommand = vscode.commands.registerCommand('pairofcleats.serviceIndexerStart', () => startManagedCommand(MANAGED_COMMANDS_BY_ID.get('pairofcleats.serviceIndexerStart')));
  const serviceIndexerStopCommand = vscode.commands.registerCommand('pairofcleats.serviceIndexerStop', () => stopManagedCommand(MANAGED_STOP_COMMANDS_BY_ID.get('pairofcleats.serviceIndexerStop')));
  context.subscriptions.push(
    searchCommand,
    searchSelectionCommand,
    searchSymbolCommand,
    selectRepoCommand,
    clearSelectedRepoCommand,
    repeatLastSearchCommand,
    explainSearchCommand,
    openIndexDirectoryCommand,
    indexBuildCommand,
    indexWatchStartCommand,
    indexWatchStopCommand,
    serviceApiStartCommand,
    serviceApiStopCommand,
    serviceIndexerStartCommand,
    serviceIndexerStopCommand
  );
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
  const reopenLastResultsCommand = vscode.commands.registerCommand('pairofcleats.reopenLastResults', reopenLastResults);
  const showSearchHistoryCommand = vscode.commands.registerCommand('pairofcleats.showSearchHistory', showSearchHistory);
  const groupResultsBySectionCommand = vscode.commands.registerCommand('pairofcleats.groupResultsBySection', () => setSearchGroupingMode('section'));
  const groupResultsByFileCommand = vscode.commands.registerCommand('pairofcleats.groupResultsByFile', () => setSearchGroupingMode('file'));
  const groupResultsByQueryCommand = vscode.commands.registerCommand('pairofcleats.groupResultsByQuery', () => setSearchGroupingMode('query'));
  const openResultHitCommand = vscode.commands.registerCommand('pairofcleats.openResultHit', openResultHitNode);
  const revealResultHitCommand = vscode.commands.registerCommand('pairofcleats.revealResultHit', revealResultHitNode);
  const copyResultPathCommand = vscode.commands.registerCommand('pairofcleats.copyResultPath', copyResultHitPath);
  const rerunResultSetCommand = vscode.commands.registerCommand('pairofcleats.rerunResultSet', rerunResultSet);
  context.subscriptions.push(
    workflowStatusCommand,
    rerunLastWorkflowCommand,
    recentWorkflowCommand,
    reopenLastResultsCommand,
    showSearchHistoryCommand,
    groupResultsBySectionCommand,
    groupResultsByFileCommand,
    groupResultsByQueryCommand,
    openResultHitCommand,
    revealResultHitCommand,
    copyResultPathCommand,
    rerunResultSetCommand
  );
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
  refreshResultsExplorer();
}

/**
 * Extension deactivation hook.
 *
 * @returns {void}
 */
function deactivate() {
  for (const entry of managedProcesses.values()) {
    killChildProcess(entry.child);
  }
  managedProcesses.clear();
}

let outputChannel = null;
let extensionContext = null;
let workflowSessions = [];
let workflowStatusBar = null;
let lastWorkflowRepoSnapshot = null;
let searchHistory = [];
let activeSearchResultId = null;
let searchGroupMode = 'section';
let resultsTreeProvider = null;
let resultsTreeView = null;
let managedProcesses = new Map();

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
    resolveExecutionMode,
    resolveRepoContext,
    resolvePassiveRepoContext,
    runOperatorCommand,
    executeOperatorWorkflow,
    runSavedSearchInvocation,
    executeSearchCommand,
    runSearch,
    runSelectionSearch,
    runSymbolSearch,
    runExplainSearch,
    selectRepo,
    clearSelectedRepo,
    showWorkflowStatus,
    showRecentWorkflows,
    rerunWorkflowSession,
    showSearchHistory,
    reopenLastResults,
    repeatLastSearch,
    openIndexDirectory,
    startManagedCommand,
    stopManagedCommand,
    setSearchGroupingMode,
    buildResultsTree,
    OPERATOR_COMMAND_SPECS,
    MANAGED_COMMAND_SPECS
  }
};
