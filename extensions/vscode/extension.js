const { createEditorOperations } = require('./editor-operations.js');
const operations = createEditorOperations({ spawn: (...args) => cp.spawn(...args) });
const vscode = operations.wrapVscode(require('vscode'));
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter: NodeEventEmitter } = require('node:events');
const { resolveWindowsCmdInvocation } = require('./windows-cmd.js');
const { snapshotConfiguration, renderEffectiveSettings } = require('./effective-settings.js');
const { inspectCliVersion } = require('./installation-evidence.js');
const { createDocumentAuthority, assertQualifiedEditor } = require('./document-authority.js');
const { qualifyDocumentSymbols } = require('./document-symbols.js');
const { createTaskObservations, taskRecoveryActions } = require('./task-observations.js');
const taskObservations = createTaskObservations();
const { generationFromContextPack, contextDiscoveryRequest, contextDiscoveryCliArgs } = require('./semantic-discovery.js');
const { normalizeFilterPagination, admitFilterPage, mergeFilterPage, carryFilterPageHistory, continuationInvocation } = require('./filter-pagination.js');
const { resultTreeItemId, resultTreeHitOccurrences } = require('./results-tree-identity.js');
const { createSemanticEvidenceWorkflow, sourceQualifiedSelection, qualifiedBindingSeed } = require('./semantic-evidence.js');
let latestNavigationEvidence = null;
const navigationLocationSources = new WeakMap();
const { captureNavigationRequest, sourceNavigationArgs, qualifiedNavigationRows, qualifiedDocumentSymbolRows } = require('./source-navigation.js');
const { readGitHead, validateServiceRoot, mapServicePayload, verifyServiceRevision } = require('./service-repository.js');
const { createEditorProgressDecoder, applyProgressEvent, apiReadinessFrame, describeTask,
  boundedLogLine, retainTaskLog } = require('./progress-view.js');
const { readWatchProgress } = require('./watch-progress.js');
const { collectEvidenceSources, createEvidenceCollection } = require('./evidence-collection.js');
const { createCapturedEvidenceOpener } = require('./captured-evidence-open.js');
let latestAnalysisEvidence = null;
const { resolveRiskSource, validateRiskSource } = require('./risk-source.js');
const {
  buildRiskExplanationModelFromStandalone,
  renderCompositeContextPack,
  renderRiskExplanation
} = require('./analysis-renderers.js');
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
  resolveExternalNodeRuntime,
  parseJsonPayload,
  parseSearchPayload,
  normalizeApiBaseUrl,
  normalizeApiTimeoutMs,
  requestApiJson: requestApiJsonUnchecked,
  probeApiCapabilities: probeApiCapabilitiesRequest,
  summarizeProcessFailure,
  summarizeSpawnFailure,
  spawnBufferedProcess: spawnBufferedProcessUnchecked,
  resolveValidatedHitTarget,
  openSearchHit: openSearchHitUnchecked
} = require('./runtime.js');
const { buildDestinationBoundApiHeaders, workspaceTrustError } = require('./security.js');
const { normalizeWorkflowRequest, hasRequiredWorkflowInput } = require('./workflow-replay.js');
const { boundedFacts, captureSearchExplanation, renderSearchExplanation, normalizeCapturedExplanation, normalizeSearchDiagnostics } = require('./search-explanation.js');

// Check immediately at each sink, including after async prompts/probes and
// saved/background workflows. Trust may change while a command is pending.
function openSearchHit(vscodeApi, repoContext, hit) {
  const scope = operations.current();
  return openSearchHitUnchecked(vscodeApi, repoContext, hit, { isCurrent: () => operations.isCurrent(scope) });
}

function spawnBufferedProcess(...args) {
  if (!operations.isCurrent()) return { ok: false, error: new Error('PairOfCleats operation was cancelled.') };
  if (vscode.workspace.isTrusted !== true) return { ok: false, error: workspaceTrustError() };
  const result = spawnBufferedProcessUnchecked(...args);
  if (result.ok) operations.trackChild(result.child);
  return result;
}

async function requestApiJson(baseUrl, requestPath, options = {}) {
  if (vscode.workspace.isTrusted !== true) {
    return { ok: false, kind: 'untrusted-workspace', message: workspaceTrustError().message };
  }
  const headers = { ...options.headers };
  delete headers.Authorization;
  delete headers.authorization;
  Object.assign(headers, buildApiHeaders(getExtensionConfiguration(), baseUrl));
  return operations.request((signal) => requestApiJsonUnchecked(baseUrl, requestPath, { ...options, headers, signal }));
}
const EDITOR_CONFIG_CONTRACT = Object.freeze(require('./editor-config-contract.json'));
const DEFAULT_EDITOR_CONFIG_CONTRACT = EDITOR_CONFIG_CONTRACT;
const DEFAULT_VSCODE_SETTINGS = Object.freeze(DEFAULT_EDITOR_CONFIG_CONTRACT.settings.vscode);

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
  nodePathKey: String(readContract(['settings', 'vscode', 'nodePathKey'], DEFAULT_VSCODE_SETTINGS.nodePathKey)),
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
  envKey: String(readContract(['settings', 'vscode', 'envKey'], DEFAULT_VSCODE_SETTINGS.envKey)),
  inlineHoverEnabledKey: String(readContract(
    ['settings', 'vscode', 'inlineHoverEnabledKey'],
    DEFAULT_VSCODE_SETTINGS.inlineHoverEnabledKey
  )),
  inlineDiagnosticsEnabledKey: String(readContract(
    ['settings', 'vscode', 'inlineDiagnosticsEnabledKey'],
    DEFAULT_VSCODE_SETTINGS.inlineDiagnosticsEnabledKey
  )),
  inlineDecorationsEnabledKey: String(readContract(
    ['settings', 'vscode', 'inlineDecorationsEnabledKey'],
    DEFAULT_VSCODE_SETTINGS.inlineDecorationsEnabledKey
  )),
  inlineMaxItemsKey: String(readContract(
    ['settings', 'vscode', 'inlineMaxItemsKey'],
    DEFAULT_VSCODE_SETTINGS.inlineMaxItemsKey
  ))
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
const NAVIGATION_PROVIDER_TIMEOUT_MS = 5000;
const NAVIGATION_RESULT_LIMIT = 25;
const DOCUMENT_SYMBOL_LIMIT = 200;
const COMPLETION_RESULT_LIMIT = 40;
const MIN_COMPLETION_QUERY_LENGTH = 2;
const INLINE_SIGNAL_TIMEOUT_MS = 4000;
const INLINE_SIGNAL_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_INLINE_MAX_ITEMS = 3;

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
  'index-health': { label: 'index health', supportsCli: true, supportsApi: true },
  'context-collection': { label: 'selected context collection', supportsCli: true, supportsApi: true },
  ...Object.fromEntries(['find', 'detail', 'trace', 'explain'].map(operation => [
    `semantic-${operation}`, { label: `semantic ${operation}`, supportsCli: true, supportsApi: true }]))
});
const apiCapabilityCache = new Map();
const navigationDegradationNotes = new Set();
const inlineSignalCache = new Map();
const inlineSignalDegradationNotes = new Set();

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
function getExtensionConfiguration(repoContext = null) {
  let resource = repoContext?.repoUri || repoContext?.uri || null;
  if (!resource) {
    const folders = vscode.workspace.workspaceFolders || [];
    const candidates = collectRepoCandidates(folders, { allowRemote: true });
    resource = resolveSelectedRepoCandidate(candidates)?.repoUri
      || vscode.window.activeTextEditor?.document?.uri || folders[0]?.uri;
  }
  const configuration = vscode.workspace.getConfiguration(VSCODE_SETTINGS.namespace, resource);
  const keys = Object.keys(require('./package.json').contributes.configuration.properties)
    .map(key => key.slice(VSCODE_SETTINGS.namespace.length + 1));
  return snapshotConfiguration(configuration, keys);
}

async function showEffectiveSettings(seededRepoContext = null) {
  const repoContext = seededRepoContext?.ok === true && seededRepoContext.repoRoot
    ? seededRepoContext : await resolveSearchRepoContext({ allowRemote: true });
  if (!repoContext) return;
  const snapshot = getExtensionConfiguration(repoContext);
  const cli = resolveCli(repoContext.repoRoot, snapshot);
  const api = readApiSettings(snapshot);
  const present = async facts => {
    const text = renderEffectiveSettings({ snapshot, repoContext,
      remoteName: vscode.env?.remoteName, cli, api, ...facts });
    const document = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
    await vscode.window.showTextDocument(document, { preview: true });
  };
  await present();
  const action = await vscode.window.showQuickPick(['Inspect Installation / Transport Evidence',
    'Open User Settings', 'Tooling Doctor', 'Done'], { title: 'Effective settings recovery and observations',
    placeHolder: 'Version/capability observations are read-only and bounded; they do not install or build' });
  if (action === 'Open User Settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'pairofcleats');
  } else if (action === 'Tooling Doctor') {
    await vscode.commands.executeCommand('pairofcleats.doctor');
  } else if (action === 'Inspect Installation / Transport Evidence') {
    const args = [...(cli.argsPrefix || []), '--version'];
    const invocation = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli.command || '')
      ? resolveWindowsCmdInvocation(cli.command, args) : { command: cli.command, args };
    const env = buildSpawnEnv(snapshot);
    const installation = cli.ok ? await inspectCliVersion({
      spawn: (command, values, options) => spawnBufferedProcess(cp, command, values, { ...options,
        env: invocation.env ? { ...env, ...invocation.env } : env,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments === true }),
      stop: child => operations.stopChild(child), command: invocation.command, args: invocation.args,
      cwd: repoContext.repoRoot, env
    }) : { state: 'unobserved', reason: 'Correct the configured CLI/runtime path first.' };
    let capability = { state: 'unobserved', reason: 'CLI policy does not contact a service.' };
    if (!api.error && api.mode !== 'cli' && api.baseUrl && operations.isCurrent()) {
      const response = await getCachedApiCapabilities(api.baseUrl, api.timeoutMs);
      capability = response.ok ? { state: 'observed', names: Object.entries(response.capabilities || {})
        .filter(([, enabled]) => enabled === true).map(([name]) => name.slice(0, 128)).sort().slice(0, 64) }
        : { state: 'unavailable', reason: 'The configured service did not supply admitted capability evidence; inspect User Settings / Tooling Doctor.' };
    }
    if (operations.isCurrent()) await present({ installation, capability });
  }
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
  const configured = config.get(VSCODE_SETTINGS.apiExecutionModeKey);
  const mode = String(configured == null ? 'cli' : configured).trim().toLowerCase();
  return { baseUrl, timeoutMs, mode, ...(!VALID_API_EXECUTION_MODES.has(mode)
    ? { error: 'PairOfCleats apiExecutionMode must be cli, prefer, or require. Correct User Settings.' } : {}) };
}

function readInlineSettings(config) {
  const inlineHoverEnabled = config.get(VSCODE_SETTINGS.inlineHoverEnabledKey) === true;
  const inlineDiagnosticsEnabled = config.get(VSCODE_SETTINGS.inlineDiagnosticsEnabledKey) === true;
  const inlineDecorationsEnabled = config.get(VSCODE_SETTINGS.inlineDecorationsEnabledKey) === true;
  const rawMaxItems = Number(config.get(VSCODE_SETTINGS.inlineMaxItemsKey));
  const maxItems = Number.isFinite(rawMaxItems) && rawMaxItems > 0
    ? Math.max(1, Math.floor(rawMaxItems))
    : DEFAULT_INLINE_MAX_ITEMS;
  return {
    inlineHoverEnabled,
    inlineDiagnosticsEnabled,
    inlineDecorationsEnabled,
    maxItems
  };
}

function buildApiHeaders(config, destination = readApiSettings(config).baseUrl) {
  return buildDestinationBoundApiHeaders(config, destination, {
    endpointKey: VSCODE_SETTINGS.apiServerUrlKey, envKey: VSCODE_SETTINGS.envKey
  });
}

async function getCachedApiCapabilities(baseUrl, timeoutMs, headers = null) {
  if (vscode.workspace.isTrusted !== true) return { ok: false, message: workspaceTrustError().message };
  headers = buildApiHeaders(getExtensionConfiguration(), baseUrl);
  const cacheKey = `${baseUrl}::${timeoutMs}::${headers?.Authorization || ''}`;
  const cached = apiCapabilityCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < API_CAPABILITY_CACHE_TTL_MS) {
    return cached.result;
  }
  const probe = await operations.request((signal) => probeApiCapabilitiesRequest(baseUrl, timeoutMs, headers, signal));
  if (!operations.isCurrent()) return operations.cancelled();
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
  if (apiSettings.error) return { ok: false, message: apiSettings.error, detail: 'Open PairOfCleats: Show Effective Settings.' };
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
  if (
    allowRemote
    && activeCandidate
    && activeCandidate.workspaceUri?.scheme
    && activeCandidate.workspaceUri.scheme !== 'file'
  ) {
    return { ok: true, ...activeCandidate, source: 'active-editor' };
  }
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
    let runtime = null;
    const resolved = resolveConfiguredCli(repoRoot, configuredPath, extraArgs, {
      command: CLI_DEFAULT_COMMAND,
      jsExtension: CLI_JS_EXTENSION,
      resolveNode: () => { runtime = resolveNodeRuntime(config); return runtime; }
    });
    const installationPath = runtime?.ok ? resolved.argsPrefix?.[0]
      : path.isAbsolute(resolved.command || '') ? resolved.command : null;
    return { ...resolved, ...(runtime?.ok ? { runtime: { command: runtime.command, version: runtime.version } } : {}),
      ...(installationPath ? { installationPath } : {}) };
  }

  return { ok: true, command: CLI_DEFAULT_COMMAND, argsPrefix: extraArgs };
}


function resolveNodeRuntime(config) {
  if (vscode.workspace.isTrusted !== true) return { ok: false, message: workspaceTrustError().message };
  if (typeof cp.spawnSync !== 'function') return { ok: false, message: 'PairOfCleats cannot probe the external Node runtime.' };
  return resolveExternalNodeRuntime({
    configuredPath: config?.inspect?.(VSCODE_SETTINGS.nodePathKey)?.globalValue || '',
    probe: cp.spawnSync,
    env: process.env
  });
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
    request: normalizeWorkflowRequest(rawInvocation.request),
    requestInvalid: rawInvocation.requestInvalid === true
      || (rawInvocation.request != null && !normalizeWorkflowRequest(rawInvocation.request)),
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
  if (!operations.isCurrent()) return;
  if (typeof extensionContext?.workspaceState?.update !== 'function') return;
  const scope = operations.current();
  const previous = workspaceWrites.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => {
    if (operations.isCurrent(scope)) return extensionContext.workspaceState.update(key, value);
  });
  operations.trackPromise(next);
  workspaceWrites.set(key, next);
  try { await next; } finally { if (workspaceWrites.get(key) === next) workspaceWrites.delete(key); }
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
        request: normalizeWorkflowRequest({ version: 1, inputContext: invocation.inputContext || null }),
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
  operations.invalidate('repository-selected', { preserveCurrent: true });
  await persistSelectedRepoCandidate(picked);
  vscode.window.showInformationMessage(`PairOfCleats will use ${picked.repoLabel} until you clear the selection.`);
}

async function clearSelectedRepo() {
  operations.invalidate('repository-selection-cleared', { preserveCurrent: true });
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

function validateReplayRepoContext(repoContext, mode) {
  if (mode === 'api') return true;
  try {
    if (repoContext.repoUri?.scheme && repoContext.repoUri.scheme !== 'file') throw new Error('local CLI requires a local repository');
    if (!fs.statSync(repoContext.repoRoot).isDirectory()) throw new Error('repository is not a directory');
    return true;
  } catch (error) {
    vscode.window.showErrorMessage(`PairOfCleats cannot rerun this workflow: ${repoContext.repoRoot} is unavailable (${error.message}). Select an available repository and run the command again.`);
    return false;
  }
}

async function rerunWorkflowSession(session) {
  const spec = OPERATOR_COMMANDS_BY_ID.get(session?.commandId);
  const managedSpec = MANAGED_COMMANDS_BY_ID.get(session?.commandId);
  if ((!spec && !managedSpec) || !session?.repoRoot || session.invocation?.requestInvalid
    || (session.invocation?.request != null && !normalizeWorkflowRequest(session.invocation.request))
    || !['operator', 'managed-process', 'api-request'].includes(session.invocation?.kind)) {
    vscode.window.showErrorMessage('PairOfCleats cannot rerun this historical workflow: its registered command or saved request is unavailable. Run the current command again.');
    return;
  }
  const repoContext = {
    ok: true,
    repoRoot: session.repoRoot,
    repoUri: parsePersistedUri(session.workspaceUri, vscode.Uri.file(session.repoRoot)),
    workspacePath: session.workspacePath || session.repoRoot,
    workspaceUriString: session.workspaceUri || '',
    workspaceFolder: { uri: parsePersistedUri(session.workspaceUri, vscode.Uri.file(session.repoRoot)) }
  };
  if (managedSpec) return startManagedCommand(managedSpec, { repoContext });
  const request = normalizeWorkflowRequest(session.invocation.request);
  if (typeof spec.resolveInput === 'function' && !hasRequiredWorkflowInput(spec.id, request?.inputContext)) {
    vscode.window.showErrorMessage('PairOfCleats cannot exactly rerun this legacy workflow because its semantic inputs were not saved. Run the current command to choose them again.');
    return;
  }
  return runOperatorCommand(spec, { repoContext, inputContext: request?.inputContext || undefined });
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
      await stopManagedCommand(stopSpec, { sessionId: runningSession.sessionId, repoRoot: runningSession.repoRoot });
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
  const breakdown = hit.scoreBreakdown ? boundedFacts(hit.scoreBreakdown) : null;
  return {
    file: String(hit.file),
    section: String(hit.section || 'code'),
    headline: hit.headline ? String(hit.headline) : '',
    name: hit.name ? String(hit.name) : '',
    score: Number.isFinite(hit.score) ? Number(hit.score) : null,
    scoreType: hit.scoreType ? String(hit.scoreType) : '',
    chunkUid: typeof hit.chunkUid === 'string' ? hit.chunkUid : '',
    id: typeof hit.id === 'string' || Number.isSafeInteger(hit.id) ? hit.id : null,
    sourceHash: /^[a-f0-9]{64}$/.test(hit.sourceHash || '') ? hit.sourceHash : null,
    coordinateUnit: hit.coordinateUnit === 'utf16' ? 'utf16' : null,
    generation: hit.generation && typeof hit.generation === 'object' ? hit.generation : null,
    ...(breakdown ? { scoreBreakdown: breakdown.facts } : {}),
    explanationTruncated: hit.explanationTruncated === true || breakdown?.truncated === true,
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
  const pagination = normalizeFilterPagination(rawResultSet.pagination);
  if (!resultSetId || (!query && !pagination) || !repoRoot) return null;
  const hits = Array.isArray(rawResultSet.hits)
    ? rawResultSet.hits.map((hit) => normalizeSearchHit(hit)).filter(Boolean)
    : [];
  carryFilterPageHistory(rawResultSet.hits, hits);
  let explanationBytes = 64 * 1024;
  for (const hit of hits) {
    if (!hit.scoreBreakdown) continue;
    const bytes = Buffer.byteLength(JSON.stringify(hit.scoreBreakdown));
    if (bytes > explanationBytes) {
      delete hit.scoreBreakdown;
      hit.explanationTruncated = true;
    } else explanationBytes -= bytes;
  }
  return {
    resultSetId,
    query,
    pagination,
    repoRoot,
    repoLabel: formatRepoLabel(repoRoot),
    repoUri: rawResultSet.repoUri ? String(rawResultSet.repoUri) : '',
    createdAt: String(rawResultSet.createdAt || ''),
    mode: rawResultSet.mode ? String(rawResultSet.mode) : '',
    backend: rawResultSet.backend ? String(rawResultSet.backend) : '',
    totalHits: Number.isFinite(rawResultSet.totalHits) ? Number(rawResultSet.totalHits) : hits.length,
    invocation: normalizeSearchInvocation(rawResultSet.invocation),
    explanation: normalizeCapturedExplanation(rawResultSet.explanation),
    searchDiagnostics: normalizeSearchDiagnostics(rawResultSet.searchDiagnostics),
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

function createTreeItem(label, { description = '', tooltip = '', collapsibleState = 0, command = null, contextValue = '', id = null } = {}) {
  if (typeof vscode.TreeItem === 'function') {
    const item = new vscode.TreeItem(label, collapsibleState);
    item.description = description;
    item.tooltip = tooltip || label;
    item.command = command || undefined;
    item.contextValue = contextValue || undefined;
    if (id) item.id = id;
    return item;
  }
  return {
    label,
    description,
    tooltip: tooltip || label,
    collapsibleState,
    command,
    contextValue,
    ...(id ? { id } : {})
  };
}

function buildResultsTree() {
  const activeResultSet = getActiveSearchResultSet();
  if (!activeResultSet) return [];
  if (searchGroupMode === 'query') {
    return searchHistory.slice(0, 10).map((resultSet) => {
      const occurrences = resultTreeHitOccurrences(resultSet.hits);
      return {
        kind: 'result-set',
        resultSet,
        treeItem: createTreeItem(resultSet.query || 'Indexed metadata matches', {
          id: resultTreeItemId({ resultSetId: resultSet.resultSetId, groupMode: 'query', kind: 'result-set' }),
          description: `${resultSet.repoLabel} • ${resultSet.totalHits} hit(s)`,
          tooltip: `${resultSet.repoRoot}\n${resultSet.query}`,
          collapsibleState: 1,
          contextValue: 'pairofcleats.resultSet'
        }),
        children: resultSet.hits.map((hit, ordinal) => buildResultHitNode(resultSet, hit, ordinal, occurrences[ordinal]))
      };
    });
  }
  const groups = new Map();
  const occurrences = resultTreeHitOccurrences(activeResultSet.hits);
  for (const [ordinal, hit] of activeResultSet.hits.entries()) {
    const key = searchGroupMode === 'file' ? hit.file : hit.section;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ hit, ordinal });
  }
  return Array.from(groups.entries()).map(([key, hits]) => ({
    kind: 'group',
    treeItem: createTreeItem(
      key,
      {
        description: `${hits.length} hit(s)`,
        collapsibleState: 1,
        contextValue: 'pairofcleats.resultGroup',
        id: resultTreeItemId({ resultSetId: activeResultSet.resultSetId, groupMode: searchGroupMode, kind: 'group', key })
      }
    ),
    children: hits.map(({ hit, ordinal }) => buildResultHitNode(activeResultSet, hit, ordinal, occurrences[ordinal]))
  }));
}

function buildResultHitNode(resultSet, hit, ordinal, occurrence) {
  const label = hit.name || hit.headline || hit.file;
  return {
    kind: 'hit',
    resultSet,
    hit,
    treeItem: createTreeItem(label, {
      id: resultTreeItemId({ resultSetId: resultSet.resultSetId, kind: 'hit', hit, ordinal, occurrence }),
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
  hits,
  payload = null,
  explain = false
}) {
  if (!operations.isCurrent()) return null;
  const resultSet = normalizeSearchResultSet({
    resultSetId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    query,
    repoRoot: repoContext.repoRoot,
    repoUri: repoContext.repoUri && typeof repoContext.repoUri.toString === 'function' ? repoContext.repoUri.toString() : '',
    createdAt: new Date().toISOString(),
    mode: searchOptions.mode,
    backend: searchOptions.backend,
    pagination: normalizeFilterPagination(payload?.pagination),
    totalHits: hits.length,
    invocation,
    explanation: explain ? captureSearchExplanation(payload) : null,
    searchDiagnostics: normalizeSearchDiagnostics(payload?.retrieval?.diagnostics),
    hits
  });
  if (!resultSet) return null;
  searchHistory = [resultSet, ...searchHistory.filter((entry) => entry.resultSetId !== resultSet.resultSetId)].slice(0, MAX_SEARCH_HISTORY);
  activeSearchResultId = resultSet.resultSetId;
  await persistSearchHistory();
  refreshResultsExplorer();
  presentSearchDiagnostics(resultSet);
  return resultSet;
}

function presentSearchDiagnostics(resultSet, historical = false) {
  const facts = resultSet.searchDiagnostics;
  const output = getOutputChannel();
  output.appendLine(`[search diagnostics] ${historical ? 'Saved evidence' : 'Captured response'}: ${facts.summary}`);
  for (const line of facts.details) output.appendLine(line);
  output.appendLine('Recorded generation identity does not verify current worktree freshness.');
  if (facts.truncated) output.appendLine('Diagnostic projection is truncated by its display/history bound.');
  if (!historical && !resultSet.hits.length) {
    const message = facts.reasons.find(reason => reason.message)?.message || 'This response contains no hits; diagnostics are unknown.';
    const actionIds = { 'Index Health': 'pairofcleats.indexHealth', 'Tooling Doctor': 'pairofcleats.doctor' };
    const labels = facts.actions.map(action => action === 'index-report' ? 'Index Health' : 'Tooling Doctor');
    // Labels resolve locally to registered read-only commands. Response text is
    // never executable and receiving metadata never dispatches a workflow.
    Promise.resolve(vscode.window.showInformationMessage(`PairOfCleats: ${message}`, ...labels)).then(label => {
      if (labels.includes(label) && actionIds[label]) return vscode.commands.executeCommand(actionIds[label]);
      return undefined;
    }).catch(() => {});
    output.show?.(true);
  } else if (!historical && facts.backend.fidelity === 'fallback-derived') {
    vscode.window.showInformationMessage(`PairOfCleats search used fallback results. ${facts.summary}`);
  }
}

async function openResultHitNode(node) {
  return operations.run('result-hit-open', async () => {
    if (!node?.hit || !node?.resultSet) return;
    const repoContext = createStoredRepoContext(node.resultSet);
    if (node.resultSet.explanation) {
      appendOutputLines(getOutputChannel(), renderSearchExplanation(node.resultSet, node.hit));
      getOutputChannel().show?.(true);
    }
    const result = await openSearchHit(vscode, repoContext, node.hit);
    if (!result.ok && result.kind !== 'cancelled') {
      getOutputChannel().appendLine(result.detail || result.message);
      getOutputChannel().show?.(true);
      vscode.window.showErrorMessage(result.message);
    }
  }, { key: 'result-hit-open' });
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

async function activateSavedResultSet(savedResultSet) {
  // Reopening selects existing evidence. Only the explicit rerun owner may
  // dispatch a new query or append a new history entry.
  const resultSet = searchHistory.find(entry => entry.resultSetId === savedResultSet?.resultSetId);
  if (!resultSet) {
    vscode.window.showInformationMessage('PairOfCleats has no saved search results.');
    return;
  }
  activeSearchResultId = resultSet.resultSetId;
  await persistSearchHistory();
  refreshResultsExplorer();
  presentSearchDiagnostics(resultSet, true);
  vscode.window.showInformationMessage(`PairOfCleats reopened results for "${resultSet.query}" (saved evidence${resultSet.createdAt ? ` from ${resultSet.createdAt}` : ''}).`);
}

async function reopenLastResults() {
  await activateSavedResultSet(getActiveSearchResultSet());
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
  await activateSavedResultSet(selection.resultSet);
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

function getDocumentFilePath(document) {
  const uri = document?.uri;
  if (!uri || uri.scheme !== 'file') return '';
  return String(uri.fsPath || '').trim();
}

function getWordQueryAtPosition(document, position) {
  if (!document || !position) return '';
  if (typeof document.getWordRangeAtPosition === 'function' && typeof document.getText === 'function') {
    const range = document.getWordRangeAtPosition(position);
    if (range) return String(document.getText(range) || '').trim();
  }
  return '';
}

function getWordPrefixQueryAtPosition(document, position) {
  if (!document || !position) return '';
  if (typeof document.getWordRangeAtPosition !== 'function' || typeof document.getText !== 'function') return '';
  const range = document.getWordRangeAtPosition(position);
  if (!range) return '';
  const fullText = String(document.getText(range) || '');
  const startCharacter = Number.isFinite(range?.start?.character) ? Number(range.start.character) : 0;
  const endCharacter = Number.isFinite(position?.character) ? Number(position.character) : startCharacter;
  const prefixLength = Math.max(0, Math.min(fullText.length, endCharacter - startCharacter));
  return fullText.slice(0, prefixLength || fullText.length).trim();
}

function noteNavigationDegraded(key, message, detail = null) {
  if (!key || navigationDegradationNotes.has(key)) return;
  navigationDegradationNotes.add(key);
  const output = getOutputChannel();
  output.appendLine(`[navigate] ${message}`);
  if (detail) output.appendLine(detail);
}

function noteInlineSignalDegraded(key, message, detail = null) {
  if (!key || inlineSignalDegradationNotes.has(key)) return;
  inlineSignalDegradationNotes.add(key);
  const output = getOutputChannel();
  output.appendLine(`[inline] ${message}`);
  if (detail) output.appendLine(detail);
}

function createFallbackLineRange(line = 0) {
  const safeLine = Math.max(0, Number.isFinite(line) ? Number(line) : 0);
  return new vscode.Range(
    new vscode.Position(safeLine, 0),
    new vscode.Position(safeLine, 0)
  );
}

function buildInlineFileSeed(document, repoContext) {
  const filePath = getDocumentFilePath(document);
  if (!filePath || !repoContext?.repoRoot) return '';
  const relative = path.relative(repoContext.repoRoot, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return `file:${toPosixPath(relative)}`;
}

function buildInlineSeed(document, position, repoContext) {
  // A spelling is not a canonical symbol identity. Until navigation supplies
  // one, hover consumes an explicitly labelled file-level indexed summary.
  return buildInlineFileSeed(document, repoContext);
}

function captureInlineIdentity(document, repoContext, position = null) {
  const config = getExtensionConfiguration(repoContext);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  return {
    repoRoot: repoContext.repoRoot,
    uri: document?.uri?.toString?.() || getDocumentFilePath(document),
    version: document?.version ?? null,
    sourceHash: hash(String(document?.getText?.() || '')),
    dirty: document?.isDirty === true,
    position: position ? [position.line, position.character] : null,
    policy: hash(JSON.stringify(Object.values(VSCODE_SETTINGS).map((key) => config.get(key) ?? null))),
    // The editor does not own index generation resolution. Missing generation
    // authority prohibits cross-request reuse, including inside the old TTL.
    generation: null
  };
}

function createInlineCacheKey(repoRoot, seed, identity) {
  return JSON.stringify([repoRoot, seed, identity]);
}

function getCachedInlineSignalPayload(repoRoot, seed, identity) {
  if (!identity?.generation) return null;
  const key = createInlineCacheKey(repoRoot, seed, identity);
  const cached = inlineSignalCache.get(key);
  if (!cached) return null;
  if ((Date.now() - cached.timestamp) > INLINE_SIGNAL_CACHE_TTL_MS) {
    inlineSignalCache.delete(key);
    return null;
  }
  return cached.payload;
}

function setCachedInlineSignalPayload(repoRoot, seed, payload, identity) {
  if (!identity?.generation || !operations.isCurrent()) return;
  const key = createInlineCacheKey(repoRoot, seed, identity);
  inlineSignalCache.delete(key);
  inlineSignalCache.set(key, {
    timestamp: Date.now(),
    payload
  });
  while (inlineSignalCache.size > 64) inlineSignalCache.delete(inlineSignalCache.keys().next().value);
}

function countInlineWarnings(payload) {
  return Array.isArray(payload?.warnings) ? payload.warnings.length : 0;
}

function countInlineTruncation(payload) {
  return Array.isArray(payload?.truncation) ? payload.truncation.length : 0;
}

function countInlineRiskFlows(payload) {
  return Array.isArray(payload?.risk?.flows) ? payload.risk.flows.length : 0;
}

function collectInlineTypeFacts(payload) {
  return Array.isArray(payload?.types?.facts) ? payload.types.facts : [];
}

function hasInlineSignals(payload) {
  return countInlineRiskFlows(payload) > 0
    || collectInlineTypeFacts(payload).length > 0
    || countInlineWarnings(payload) > 0
    || countInlineTruncation(payload) > 0;
}

function buildInlineSignalSummary(payload) {
  const parts = [];
  const riskFlows = countInlineRiskFlows(payload);
  const warnings = countInlineWarnings(payload);
  const truncation = countInlineTruncation(payload);
  const typeFacts = collectInlineTypeFacts(payload).length;
  if (riskFlows > 0) parts.push(`${riskFlows} risk flow${riskFlows === 1 ? '' : 's'}`);
  if (typeFacts > 0) parts.push(`${typeFacts} type fact${typeFacts === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (truncation > 0) parts.push(`${truncation} truncation${truncation === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function buildInlineHoverMarkdown(payload, { seed, maxItems, dirty = false }) {
  const lines = [
    '### PairOfCleats indexed file summary',
    '- Scope: indexed snapshot; aggregate counts are not precise findings in the current buffer.',
    ...(dirty ? ['- Unsaved buffer: indexed facts may differ from the current text.'] : []),
    `- seed: \`${seed}\``
  ];
  const riskStatus = String(payload?.risk?.analysisStatus?.code || payload?.risk?.status || '').trim();
  if (riskStatus) {
    lines.push(`- risk status: \`${riskStatus}\``);
  }
  const summary = buildInlineSignalSummary(payload);
  if (summary) {
    lines.push(`- summary: ${summary}`);
  }
  const flows = Array.isArray(payload?.risk?.flows) ? payload.risk.flows.slice(0, maxItems) : [];
  if (flows.length) {
    lines.push('');
    lines.push('**Risk flows**');
    for (const flow of flows) {
      const confidence = Number.isFinite(Number(flow?.confidence)) ? ` (${Number(flow.confidence).toFixed(2)})` : '';
      lines.push(`- \`${String(flow?.flowId || 'unknown')}\`${confidence}`);
    }
  }
  const typeFacts = collectInlineTypeFacts(payload).slice(0, maxItems);
  if (typeFacts.length) {
    lines.push('');
    lines.push('**Type facts**');
    for (const fact of typeFacts) {
      lines.push(`- ${String(fact?.role || 'type')}: \`${String(fact?.type || 'unknown')}\``);
    }
  }
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings.slice(0, maxItems) : [];
  if (warnings.length) {
    lines.push('');
    lines.push('**Warnings**');
    for (const warning of warnings) {
      lines.push(`- ${String(warning?.code || 'WARN')}: ${String(warning?.message || 'warning')}`);
    }
  }
  const truncation = Array.isArray(payload?.truncation) ? payload.truncation.slice(0, maxItems) : [];
  if (truncation.length) {
    lines.push('');
    lines.push('**Truncation**');
    for (const entry of truncation) {
      lines.push(`- ${String(entry?.cap || 'cap')}: limit=${entry?.limit ?? 'n/a'} observed=${entry?.observed ?? 'n/a'}`);
    }
  }
  const markdown = new vscode.MarkdownString(lines.join('\n'));
  markdown.isTrusted = false;
  return markdown;
}

function createInlineDiagnostic(document, payload) {
  const summary = buildInlineSignalSummary(payload);
  if (!summary) return null;
  if (document?.isDirty === true) return null;
  const severity = vscode.DiagnosticSeverity.Information;
  const diagnostic = new vscode.Diagnostic(
    createFallbackLineRange(0),
    `PairOfCleats indexed file summary (aggregate, not a finding at this line): ${summary}`,
    severity
  );
  diagnostic.source = 'PairOfCleats';
  diagnostic.code = 'indexed-file-summary';
  return diagnostic;
}

function clearInlineDecorations(editor = null) {
  if (editor?.setDecorations && inlineRiskDecorationType) {
    editor.setDecorations(inlineRiskDecorationType, []);
  }
  if (inlineRiskDecorationType?.dispose) {
    inlineRiskDecorationType.dispose();
  }
  inlineRiskDecorationType = null;
}

function invalidateInlineSignals() {
  operations.cancelKey('inline-refresh');
  inlineSignalCache.clear();
  inlineRiskDiagnostics?.clear?.();
  clearInlineDecorations(vscode.window.activeTextEditor || null);
}

function applyInlineDecorations(editor, payload) {
  if (!editor?.setDecorations || typeof vscode.window?.createTextEditorDecorationType !== 'function') return;
  const summary = buildInlineSignalSummary(payload);
  clearInlineDecorations(editor);
  if (!summary) return;
  inlineRiskDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: {
      contentText: ` PairOfCleats indexed file summary${editor.document?.isDirty ? ' (unsaved buffer differs)' : ''}: ${summary}`,
      color: 'rgba(120, 120, 120, 0.9)',
      margin: '0 0 0 1rem'
    }
  });
  editor.setDecorations(inlineRiskDecorationType, [createFallbackLineRange(0)]);
}

function createRangeFromNavigationEntry(entry) {
  if (!Number.isFinite(entry?.startLine) || entry.startLine <= 0) return null;
  const startLine = Math.max(0, Number(entry.startLine) - 1);
  const endLine = Number.isFinite(entry?.endLine) && entry.endLine > 0
    ? Math.max(startLine, Number(entry.endLine) - 1)
    : startLine;
  const startCol = Number.isFinite(entry?.startCol) && entry.startCol > 0 ? Number(entry.startCol) - 1 : 0;
  const endCol = Number.isFinite(entry?.endCol) && entry.endCol > 0
    ? Math.max(endLine === startLine ? startCol : 0, Number(entry.endCol) - 1)
    : (endLine === startLine ? startCol : 0);
  return new vscode.Range(
    new vscode.Position(startLine, startCol),
    new vscode.Position(endLine, endCol)
  );
}

async function createNavigationLocation(repoContext, entry, authority, sourceRequest) {
  const target = resolveValidatedHitTarget(vscode, repoContext, {
    file: entry?.file || entry?.virtualPath || ''
  });
  if (!target.ok) return null;
  if (entry?.coordinateUnit !== 'utf16' || !entry.sourceHash) return null;
  const qualified = await authority.qualify({ repoRoot: repoContext.repoRoot, file: target.filePath,
    uri: target.targetUri, sourceHash: entry.sourceHash, range: entry });
  if (!qualified) return null;
  const range = new vscode.Range(qualified.document.positionAt(qualified.offsets.start), qualified.document.positionAt(qualified.offsets.end));
  const location = new vscode.Location(qualified.document.uri || target.targetUri, range);
  navigationLocationSources.set(location, { repoContext, entry: Object.freeze({ ...entry }), sourceRequest });
  return location;
}

async function createNavigationLocations(repoContext, rows, sourceRequest) {
  const authority = createDocumentAuthority({ workspace: vscode.workspace, isCurrent: () => operations.isCurrent(),
    maxDocuments: NAVIGATION_RESULT_LIMIT });
  const locations = [];
  try {
    for (const row of rows) {
      const location = await createNavigationLocation(repoContext, row, authority, sourceRequest);
      if (!location) return [];
      locations.push(location);
    }
    await authority.assertCurrent();
    return operations.isCurrent() ? locations : [];
  } catch (error) {
    if (operations.isCurrent()) noteNavigationDegraded('target-document-authority',
      `Indexed target ranges remain unavailable: ${error.message}`);
    return [];
  }
}

async function publishNavigationLocations(repoContext, rows, sourceRequest) {
  if (!rows.length || !operations.isCurrent() || !sourceRequest.isCurrent()) return [];
  const locations = await createNavigationLocations(repoContext, rows, sourceRequest);
  if (!locations.length || !operations.isCurrent() || !sourceRequest.isCurrent()) return [];
  try {
    // Opening each target document introduces another await after CLI source
    // admission. Keep the original requesting buffer and saved bytes current.
    sourceRequest.args(repoContext.repoRoot);
    return operations.isCurrent() ? locations : [];
  } catch (error) {
    if (operations.isCurrent()) noteNavigationDegraded('source-changed-before-publication', error.message);
    return [];
  }
}

function mapNavigationSymbolKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized.includes('class')) return vscode.SymbolKind.Class;
  if (normalized.includes('interface')) return vscode.SymbolKind.Interface;
  if (normalized.includes('enum')) return vscode.SymbolKind.Enum;
  if (normalized.includes('method')) return vscode.SymbolKind.Method;
  if (normalized.includes('function')) return vscode.SymbolKind.Function;
  if (normalized.includes('property')) return vscode.SymbolKind.Property;
  if (normalized.includes('field')) return vscode.SymbolKind.Field;
  if (normalized.includes('module')) return vscode.SymbolKind.Module;
  if (normalized.includes('namespace')) return vscode.SymbolKind.Namespace;
  if (normalized.includes('variable')) return vscode.SymbolKind.Variable;
  if (normalized.includes('constant')) return vscode.SymbolKind.Constant;
  if (normalized.includes('struct')) return vscode.SymbolKind.Struct;
  return vscode.SymbolKind.Object;
}

function mapNavigationCompletionKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized.includes('class')) return vscode.CompletionItemKind.Class;
  if (normalized.includes('interface')) return vscode.CompletionItemKind.Interface;
  if (normalized.includes('enum')) return vscode.CompletionItemKind.Enum;
  if (normalized.includes('method')) return vscode.CompletionItemKind.Method;
  if (normalized.includes('function')) return vscode.CompletionItemKind.Function;
  if (normalized.includes('property')) return vscode.CompletionItemKind.Property;
  if (normalized.includes('field')) return vscode.CompletionItemKind.Field;
  if (normalized.includes('module')) return vscode.CompletionItemKind.Module;
  if (normalized.includes('namespace')) return vscode.CompletionItemKind.Module;
  if (normalized.includes('variable')) return vscode.CompletionItemKind.Variable;
  if (normalized.includes('constant')) return vscode.CompletionItemKind.Constant;
  if (normalized.includes('struct')) return vscode.CompletionItemKind.Struct;
  return vscode.CompletionItemKind.Text;
}

function createCompletionItem(entry) {
  const label = String(entry?.name || entry?.qualifiedName || '').trim();
  if (!label) return null;
  const item = new vscode.CompletionItem(label, mapNavigationCompletionKind(entry?.kind));
  item.detail = String(entry?.qualifiedName || entry?.kind || '').trim();
  item.sortText = `${String(9999 - Math.max(0, Number(entry?.score) || 0)).padStart(4, '0')}:${label}`;
  item.filterText = String(entry?.qualifiedName || label).trim();
  return item;
}

async function runNavigationCommand({
  kind,
  repoContext,
  query = '',
  filePath = '',
  sourceDocument = null,
  sourceRequest = null,
  position = null,
  includeDeclaration = true,
  limit = NAVIGATION_RESULT_LIMIT
}) {
  if (!operations.isCurrent()) return [];
  const precise = kind === 'definitions' || kind === 'references';
  const qualified = precise || kind === 'document-symbols' && sourceRequest !== null;
  const request = sourceRequest || (precise ? captureNavigationRequest(sourceDocument, position, includeDeclaration) : null);
  if (qualified && !request?.isCurrent()) return [];
  const requestedSourceVersion = request?.version;
  const config = getExtensionConfiguration(repoContext);
  const apiSettings = readApiSettings(config);
  if (apiSettings.error) { noteNavigationDegraded('invalid-policy', apiSettings.error); return []; }
  if (apiSettings.mode === 'require') {
    noteNavigationDegraded(
      'api-require',
      'Native VS Code navigation is unavailable when pairofcleats.apiExecutionMode=require.',
      'Definitions, references, and document symbols currently use the local CLI tooling navigate backend.'
    );
    return [];
  }
  const cliResolution = resolveCli(repoContext.repoRoot, config);
  if (!cliResolution.ok) {
    noteNavigationDegraded('cli-invalid', cliResolution.message, cliResolution.detail || null);
    return [];
  }
  const { command, argsPrefix } = cliResolution;
  const args = [
    ...argsPrefix,
    'tooling',
    'navigate',
    '--json',
    '--repo',
    repoContext.repoRoot,
    '--kind',
    kind,
    '--top',
    String(limit)
  ];
  if (filePath) args.push('--file', filePath);
  if (query) args.push('--symbol', query);
  if (qualified) {
    try { args.push(...request.args(repoContext.repoRoot)); }
    catch (error) { noteNavigationDegraded('source-admission', error.message); return []; }
  }
  const output = getOutputChannel();
  const env = buildSpawnEnv(config);
  const useShellWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const invocation = useShellWrapper
    ? resolveWindowsCmdInvocation(command, args)
    : { command, args };
  const spawned = spawnBufferedProcess(cp, invocation.command, invocation.args, {
    cwd: repoContext.repoRoot,
    env: invocation.env ? { ...env, ...invocation.env } : env,
    shell: false,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
    windowsHide: true
  });
  if (!spawned.ok) {
    noteNavigationDegraded('spawn-error', summarizeSpawnFailure('PairOfCleats navigation', spawned.error).message);
    return [];
  }
  const child = spawned.child;
  const stdoutAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
  const stderrAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
  const result = await new Promise((resolve) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        killChildProcess(child);
      } catch {}
    }, NAVIGATION_PROVIDER_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout?.on('data', (chunk) => stdoutAccumulator.push(chunk));
    child.stderr?.on('data', (chunk) => stderrAccumulator.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, ...summarizeSpawnFailure('PairOfCleats navigation', error) });
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
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
        timeoutMs: NAVIGATION_PROVIDER_TIMEOUT_MS
      });
      if (processFailure) {
        resolve({ ok: false, ...processFailure });
        return;
      }
      const parsed = parseJsonPayload(stdout, {
        stdoutTruncated: stdoutAccumulator.truncated(),
        label: 'PairOfCleats navigation'
      });
      if (!parsed.ok) {
        resolve({ ok: false, kind: parsed.kind, message: parsed.message, detail: parsed.detail || stderr || null });
        return;
      }
      resolve({ ok: true, payload: parsed.payload });
    });
  });
  if (!operations.isCurrent()) return [];
  if (!result.ok) {
    appendRuntimeFailure(output, '[navigate]', result);
    return [];
  }
  if (result.payload?.ok === false) {
    noteNavigationDegraded(`payload-${kind}`, result.payload.message || 'PairOfCleats navigation query failed.');
    return [];
  }
  if (qualified) {
    if (!request.isCurrent()) return [];
    const expectedHash = args[args.indexOf('--source-hash') + 1];
    try {
      const currentArgs = request.args(repoContext.repoRoot);
      if (currentArgs[currentArgs.indexOf('--source-hash') + 1] !== expectedHash) {
        noteNavigationDegraded('source-changed', 'The saved source changed before indexed navigation completed.');
        return [];
      }
    } catch (error) { noteNavigationDegraded('source-changed', error.message); return []; }
    if (result.payload?.sourceHash !== expectedHash
      || result.payload?.sourceVersion !== String(requestedSourceVersion ?? 0)
      || result.payload?.coordinateUnit !== 'utf16') {
      noteNavigationDegraded('source-echo', 'Indexed navigation did not retain the requested source identity/version.');
      return [];
    }
    if (kind === 'document-symbols') {
      if (result.payload?.results?.length > DOCUMENT_SYMBOL_LIMIT) {
        noteNavigationDegraded('document-symbol-bound', 'Native Outline response exceeds its 200-symbol bound. Inspect indexed evidence instead.');
        return [];
      }
      const rows = qualifiedDocumentSymbolRows(result.payload);
      if (!rows.length) noteNavigationDegraded('document-symbols-unqualified',
        'Native Outline needs current source-qualified symbol ranges. Use Inspect Indexed Document Symbols for retained evidence, then save/rebuild as needed.');
      return rows;
    }
    latestNavigationEvidence = { payload: result.payload, repoContext, sourceFile: request.file,
      position: request.position, sourceRequest: request };
    const rows = qualifiedNavigationRows(result.payload);
    if (!rows.length) noteNavigationDegraded(`binding-${result.payload?.status || 'unknown'}`,
      `Indexed navigation: ${result.payload?.status || 'unqualified'}. Use PairOfCleats Related Search for approximate matches.`,
      result.payload?.message);
    return rows;
  }
  return Array.isArray(result.payload?.results) ? result.payload.results : [];
}

async function runInlineContextCommand({
  repoContext,
  seed,
  identity = null
}) {
  if (!repoContext?.repoRoot || !seed || !operations.isCurrent()) return null;
  const config = getExtensionConfiguration(repoContext);
  const apiSettings = readApiSettings(config);
  if (apiSettings.error) { noteInlineSignalDegraded('invalid-policy', apiSettings.error); return null; }
  if (apiSettings.mode === 'require') {
    noteInlineSignalDegraded(
      'api-require',
      'Inline PairOfCleats signals are unavailable when pairofcleats.apiExecutionMode=require.',
      'Inline hover, diagnostics, and decorations currently use the local CLI context-pack backend.'
    );
    return null;
  }
  const cached = getCachedInlineSignalPayload(repoContext.repoRoot, seed, identity);
  if (cached) return cached;
  const cliResolution = resolveCli(repoContext.repoRoot, config);
  if (!cliResolution.ok) {
    noteInlineSignalDegraded('cli-invalid', cliResolution.message, cliResolution.detail || null);
    return null;
  }
  const { command, argsPrefix } = cliResolution;
  const args = [
    ...argsPrefix,
    'context-pack',
    '--json',
    '--repo',
    repoContext.repoRoot,
    '--seed',
    seed,
    '--hops',
    '0',
    '--includeRisk',
    '--includeTypes'
  ];
  const env = buildSpawnEnv(config);
  const useShellWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const invocation = useShellWrapper
    ? resolveWindowsCmdInvocation(command, args)
    : { command, args };
  const spawned = spawnBufferedProcess(cp, invocation.command, invocation.args, {
    cwd: repoContext.repoRoot,
    env: invocation.env ? { ...env, ...invocation.env } : env,
    shell: false,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
    windowsHide: true
  });
  if (!spawned.ok) {
    noteInlineSignalDegraded('spawn-error', summarizeSpawnFailure('PairOfCleats inline context', spawned.error).message);
    return null;
  }
  const child = spawned.child;
  const stdoutAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
  const stderrAccumulator = createChunkAccumulator(DEFAULT_MAX_BUFFER_BYTES);
  const result = await new Promise((resolve) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        killChildProcess(child);
      } catch {}
    }, INLINE_SIGNAL_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout?.on('data', (chunk) => stdoutAccumulator.push(chunk));
    child.stderr?.on('data', (chunk) => stderrAccumulator.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, ...summarizeSpawnFailure('PairOfCleats inline context', error) });
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
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
        timeoutMs: INLINE_SIGNAL_TIMEOUT_MS
      });
      if (processFailure) {
        resolve({ ok: false, ...processFailure });
        return;
      }
      const parsed = parseJsonPayload(stdout, {
        stdoutTruncated: stdoutAccumulator.truncated(),
        label: 'PairOfCleats inline context'
      });
      if (!parsed.ok) {
        resolve({ ok: false, kind: parsed.kind, message: parsed.message, detail: parsed.detail || stderr || null });
        return;
      }
      resolve({ ok: true, payload: parsed.payload });
    });
  });
  if (!operations.isCurrent()) return null;
  if (!result.ok || !result.payload || !hasInlineSignals(result.payload)) {
    if (!result.ok) {
      noteInlineSignalDegraded(`inline-${result.kind || 'failed'}`, result.message || 'PairOfCleats inline context failed.', result.detail || null);
    }
    return null;
  }
  setCachedInlineSignalPayload(repoContext.repoRoot, seed, result.payload, identity);
  return result.payload;
}

function provideDefinitionsAtPosition(document, position, token) {
  return operations.run('definitions', () => provideOwnedDefinitions(document, position), { token });
}

async function provideOwnedDefinitions(document, position, sourceRequest = captureNavigationRequest(document, position)) {
  if (!sourceRequest) return [];
  const query = getWordQueryAtPosition(document, sourceRequest.position);
  if (!query) return [];
  const repoContext = await resolveRepoContext({ pathHint: document?.uri || null, allowPrompt: false });
  if (!repoContext.ok || !operations.isCurrent() || !sourceRequest.isCurrent()) return [];
  const rows = await runNavigationCommand({
    kind: 'definitions',
    sourceDocument: document, sourceRequest, position: sourceRequest.position,
    repoContext,
    query,
    filePath: getDocumentFilePath(document),
    limit: NAVIGATION_RESULT_LIMIT
  });
  return publishNavigationLocations(repoContext, rows, sourceRequest);
}

function provideReferencesAtPosition(document, position, context, token) {
  return operations.run('references', () => provideOwnedReferences(document, position, context), { token });
}

async function provideOwnedReferences(document, position, context = {}, sourceRequest = captureNavigationRequest(document, position, context.includeDeclaration)) {
  if (!sourceRequest) return [];
  const query = getWordQueryAtPosition(document, sourceRequest.position);
  if (!query) return [];
  const repoContext = await resolveRepoContext({ pathHint: document?.uri || null, allowPrompt: false });
  if (!repoContext.ok || !operations.isCurrent() || !sourceRequest.isCurrent()) return [];
  const rows = await runNavigationCommand({
    kind: 'references',
    sourceDocument: document, sourceRequest, position: sourceRequest.position,
    repoContext,
    query,
    filePath: getDocumentFilePath(document),
    limit: NAVIGATION_RESULT_LIMIT
  });
  return publishNavigationLocations(repoContext, rows, sourceRequest);
}

function provideDocumentSymbolsForDocument(document, token) {
  return operations.run('document-symbols', () => provideOwnedDocumentSymbols(document), { token });
}

async function provideOwnedDocumentSymbols(document) {
  const sourceRequest = captureNavigationRequest(document);
  if (!sourceRequest) return [];
  const repoContext = await resolveRepoContext({ pathHint: document?.uri || null, allowPrompt: false });
  if (!repoContext.ok || !operations.isCurrent() || !sourceRequest.isCurrent()) return [];
  const filePath = getDocumentFilePath(document);
  if (!filePath) return [];
  const rows = await runNavigationCommand({
    kind: 'document-symbols',
    repoContext, sourceRequest,
    filePath,
    limit: DOCUMENT_SYMBOL_LIMIT
  });
  try {
    return await qualifyDocumentSymbols({ vscode, repoContext, rows, sourceRequest,
      isCurrent: () => operations.isCurrent(), symbolKind: mapNavigationSymbolKind });
  } catch (error) {
    if (operations.isCurrent()) noteNavigationDegraded('document-symbol-source',
      `Native Outline ranges remain unavailable: ${error.message} Use Inspect Indexed Document Symbols for retained evidence.`);
    return [];
  }
}

function provideCompletionItemsAtPosition(document, position, token) {
  return operations.run('completions', () => provideOwnedCompletions(document, position), { token });
}

async function provideOwnedCompletions(document, position) {
  const sourceRequest = captureNavigationRequest(document, position, true, { allowDirty: true });
  if (!sourceRequest) return [];
  const query = getWordPrefixQueryAtPosition(document, sourceRequest.position);
  if (!query || query.length < MIN_COMPLETION_QUERY_LENGTH) return [];
  const repoContext = await resolveRepoContext({ pathHint: document?.uri || null, allowPrompt: false });
  if (!repoContext.ok || !operations.isCurrent() || !sourceRequest.isCurrent()) return [];
  const rows = await runNavigationCommand({
    kind: 'completions',
    repoContext,
    query,
    filePath: getDocumentFilePath(document),
    limit: COMPLETION_RESULT_LIMIT
  });
  return operations.isCurrent() && sourceRequest.isCurrent() ? rows.map((entry) => createCompletionItem(entry)).filter(Boolean) : [];
}

function provideInlineHoverAtPosition(document, position, token) {
  return operations.run('inline-hover', () => provideOwnedInlineHover(document, position), { token });
}

async function provideOwnedInlineHover(document, position) {
  const config = getExtensionConfiguration({ uri: document?.uri });
  const inlineSettings = readInlineSettings(config);
  if (!inlineSettings.inlineHoverEnabled) return null;
  const repoContext = await resolveRepoContext({ pathHint: document?.uri || null, allowPrompt: false });
  if (!repoContext.ok || !operations.isCurrent()) return null;
  const seed = buildInlineSeed(document, position, repoContext);
  if (!seed) return null;
  const identity = captureInlineIdentity(document, repoContext, position);
  const payload = await runInlineContextCommand({
    repoContext,
    seed,
    identity
  });
  if (!payload || !operations.isCurrent()
    || JSON.stringify(identity) !== JSON.stringify(captureInlineIdentity(document, repoContext, position))) return null;
  const range = typeof document?.getWordRangeAtPosition === 'function'
    ? (document.getWordRangeAtPosition(position) || createFallbackLineRange(position?.line || 0))
    : createFallbackLineRange(position?.line || 0);
  return new vscode.Hover(
    buildInlineHoverMarkdown(payload, {
      seed,
      maxItems: inlineSettings.maxItems,
      dirty: document?.isDirty === true
    }),
    range
  );
}

function refreshInlineSignalsForEditor(editor = null) {
  return operations.run('inline-refresh', () => refreshOwnedInlineSignals(editor), { key: 'inline-refresh' });
}

async function refreshOwnedInlineSignals(editor = null) {
  const targetEditor = editor || vscode.window.activeTextEditor || null;
  const targetDocument = targetEditor?.document || null;
  const config = getExtensionConfiguration({ uri: targetDocument?.uri });
  const inlineSettings = readInlineSettings(config);
  inlineRiskDiagnostics?.clear?.();
  clearInlineDecorations(targetEditor);
  if (!targetDocument || targetDocument?.uri?.scheme !== 'file') {
    inlineRiskDiagnostics?.clear?.();
    clearInlineDecorations(targetEditor);
    return;
  }
  if (!inlineSettings.inlineDiagnosticsEnabled && !inlineSettings.inlineDecorationsEnabled) {
    inlineRiskDiagnostics?.clear?.();
    clearInlineDecorations(targetEditor);
    return;
  }
  const repoContext = await resolveRepoContext({ pathHint: targetDocument.uri, allowPrompt: false });
  if (!operations.isCurrent()) return;
  if (!repoContext.ok) {
    inlineRiskDiagnostics?.clear?.();
    clearInlineDecorations(targetEditor);
    return;
  }
  const seed = buildInlineFileSeed(targetDocument, repoContext);
  if (!seed) {
    inlineRiskDiagnostics?.clear?.();
    clearInlineDecorations(targetEditor);
    return;
  }
  const identity = captureInlineIdentity(targetDocument, repoContext);
  const payload = await runInlineContextCommand({
    repoContext,
    seed,
    identity
  });
  if (!operations.isCurrent() || targetDocument.isClosed === true
    || vscode.window.activeTextEditor !== targetEditor
    || JSON.stringify(identity) !== JSON.stringify(captureInlineIdentity(targetDocument, repoContext))) return;
  if (!payload) {
    inlineRiskDiagnostics?.set?.(targetDocument.uri, []);
    clearInlineDecorations(targetEditor);
    return;
  }
  if (inlineSettings.inlineDiagnosticsEnabled) {
    const diagnostic = createInlineDiagnostic(targetDocument, payload);
    inlineRiskDiagnostics?.set?.(targetDocument.uri, diagnostic ? [diagnostic] : []);
  } else {
    inlineRiskDiagnostics?.set?.(targetDocument.uri, []);
  }
  if (inlineSettings.inlineDecorationsEnabled) {
    applyInlineDecorations(targetEditor, payload);
  } else {
    clearInlineDecorations(targetEditor);
  }
}

async function refreshInlineSignalsForActiveEditor() {
  return await refreshInlineSignalsForEditor(vscode.window.activeTextEditor || null);
}

function looksLikeSeedRef(value) {
  return /^(chunk|symbol|file):/i.test(String(value || '').trim());
}

function looksLikeChunkUid(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  return /^ck[\w:-]+$/i.test(text) || /^chunk:[\w:-]+$/i.test(text);
}

function looksLikeRepoRelativePathCandidate(value, repoContext) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  if (!repoContext?.repoRoot) return false;
  if (!(text.includes('/') || text.includes('\\') || text.includes('.'))) return false;
  const resolved = path.isAbsolute(text)
    ? path.resolve(text)
    : path.resolve(repoContext.repoRoot, text);
  const relative = path.relative(repoContext.repoRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return true;
}

function resolveRepoRelativePathSeed(value, repoContext) {
  const text = String(value || '').trim();
  if (!looksLikeRepoRelativePathCandidate(text, repoContext)) return '';
  const resolved = path.isAbsolute(text)
    ? path.resolve(text)
    : path.resolve(repoContext.repoRoot, text);
  const relative = path.relative(repoContext.repoRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return toPosixPath(relative);
}

function buildSeedRefCandidates(repoContext) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (seed, label, description) => {
    const normalized = String(seed || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ seed: normalized, label, description });
  };
  const selection = getSelectionSearchQuery();
  if (selection) {
    if (looksLikeSeedRef(selection)) {
      pushCandidate(selection, 'Active selection', selection);
    } else if (looksLikeChunkUid(selection)) {
      pushCandidate(selection.startsWith('chunk:') ? selection : `chunk:${selection}`, 'Active selection', selection);
    } else if (looksLikeRepoRelativePathCandidate(selection, repoContext)) {
      const relativeSeedPath = resolveRepoRelativePathSeed(selection, repoContext);
      if (relativeSeedPath) {
        pushCandidate(`file:${relativeSeedPath}`, 'Active selection', selection);
      }
    }
  }
  const symbol = getSymbolSearchQuery();
  if (symbol) {
    pushCandidate(
      looksLikeSeedRef(symbol) ? symbol : `symbol:${symbol}`,
      'Symbol under cursor',
      symbol
    );
  }
  const activeFile = resolveRelativeActiveFile(repoContext);
  if (activeFile) {
    pushCandidate(`file:${activeFile}`, 'Active file', activeFile);
  }
  return candidates;
}

async function promptSeedRefInput(repoContext, {
  title,
  prompt,
  placeHolder
} = {}) {
  const candidates = buildSeedRefCandidates(repoContext);
  let defaultValue = candidates[0]?.seed || '';
  if (candidates.length > 1 && typeof vscode.window.showQuickPick === 'function') {
    const selection = await vscode.window.showQuickPick(
      [
        ...candidates.map((candidate) => ({
          label: candidate.label,
          description: candidate.description,
          seed: candidate.seed
        })),
        {
          label: 'Custom seed',
          description: 'Enter a chunk:/symbol:/file: seed manually',
          seed: null
        }
      ],
      {
        title,
        placeHolder: 'Choose editor context or enter a custom seed'
      }
    );
    if (selection === undefined) return null;
    if (selection?.seed) {
      defaultValue = selection.seed;
    } else if (selection?.seed === null) {
      defaultValue = '';
    }
  }
  const value = await promptTextInput({
    title,
    prompt,
    placeHolder,
    value: defaultValue
  });
  return value || null;
}

async function promptPresentationMode(title) {
  if (typeof vscode.window.showQuickPick !== 'function') return 'both';
  const selection = await vscode.window.showQuickPick(
    [
      { label: 'Open Markdown + JSON', value: 'both' },
      { label: 'Open Markdown', value: 'markdown' },
      { label: 'Open JSON', value: 'json' },
      { label: 'Export only', value: 'export' }
    ],
    {
      title,
      placeHolder: 'Choose how PairOfCleats should present the result'
    }
  );
  if (!selection) return null;
  return selection.value;
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

async function promptContextPackInput(repoContext) {
  const seed = await promptSeedRefInput(repoContext, {
    title: 'PairOfCleats context pack seed',
    prompt: 'Context-pack seed ref',
    placeHolder: 'e.g. symbol:AuthToken or file:src/app.ts'
  });
  if (!seed) return null;
  const hops = await promptPositiveInteger({
    prompt: 'Context-pack traversal depth',
    value: 2,
    placeHolder: '2'
  });
  if (!hops) return null;
  const presentationMode = await promptPresentationMode('PairOfCleats context pack presentation');
  if (!presentationMode) return null;
  return {
    seed,
    hops,
    presentationMode
  };
}

function sanitizeExportName(value, fallback = 'export') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return sanitized || fallback;
}

function buildPresentationExportBase(spec, payload, inputContext) {
  const primaryFile = sanitizeExportName(payload?.primary?.file || '', '');
  const chunkFile = sanitizeExportName(payload?.chunk?.file || '', '');
  const seedValue = sanitizeExportName(inputContext?.seed || '', '');
  const chunkValue = sanitizeExportName(inputContext?.chunkUid || '', '');
  const base = [primaryFile, chunkFile, seedValue, chunkValue].find(Boolean)
    || sanitizeExportName(spec.id.split('.').pop(), 'artifact');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${base}`;
}

function ensureOperatorExportDir(repoRoot, spec) {
  const dir = path.join(repoRoot, '.pairofcleats', 'vscode', 'exports', sanitizeExportName(spec.id.split('.').pop(), 'operator'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function renderRiskExplainMarkdownDocument(payload) {
  return renderRiskExplanation(
    buildRiskExplanationModelFromStandalone(payload),
    {
      title: '# PairOfCleats Risk Explain',
      includeSubject: true,
      includeFilters: true,
      maxFlows: Math.max(3, Math.min(10, Array.isArray(payload?.flows) ? payload.flows.length : 3)),
      maxEvidencePerFlow: Math.max(3, Math.min(10, Array.isArray(payload?.flows) ? payload.flows.length : 3))
    }
  );
}

async function buildOperatorPresentation(spec, payload, inputContext) {
  if (spec.id === 'pairofcleats.contextPack') {
    return {
      markdown: renderCompositeContextPack(payload),
      json: JSON.stringify(payload, null, 2)
    };
  }
  if (spec.id === 'pairofcleats.riskExplain') {
    return {
      markdown: renderRiskExplainMarkdownDocument(payload) + (payload.sourceQualification
        ? `\nSource: code generation ${payload.sourceQualification.indexSignature} at ${payload.sourceQualification.indexDir}\n` : ''),
      json: JSON.stringify(payload, null, 2)
    };
  }
  return null;
}

async function openPresentationDocument(filePath, languageHint = null) {
  const fileUri = vscode.Uri.file(filePath);
  if (languageHint === 'markdown' && typeof vscode.commands?.executeCommand === 'function') {
    try {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', fileUri);
      return;
    } catch {}
  }
  const document = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(document);
}

async function presentOperatorPayload(spec, payload, repoContext, inputContext, output) {
  if (spec.id === 'pairofcleats.contextPack' || spec.id === 'pairofcleats.riskExplain') {
    latestAnalysisEvidence = { payload, repoContext };
  }
  const presentationMode = inputContext?.presentationMode || 'both';
  if (presentationMode === 'output') return null;
  const rendered = await buildOperatorPresentation(spec, payload, inputContext);
  if (!rendered || !operations.isCurrent()) return null;
  const exportDir = ensureOperatorExportDir(repoContext.repoRoot, spec);
  const baseName = buildPresentationExportBase(spec, payload, inputContext);
  const jsonPath = path.join(exportDir, `${baseName}.json`);
  const markdownPath = path.join(exportDir, `${baseName}.md`);
  fs.writeFileSync(jsonPath, rendered.json, 'utf8');
  fs.writeFileSync(markdownPath, rendered.markdown, 'utf8');
  output.appendLine(`- exported markdown: ${markdownPath}`);
  output.appendLine(`- exported json: ${jsonPath}`);
  if (presentationMode === 'markdown' || presentationMode === 'both') {
    await openPresentationDocument(markdownPath, 'markdown');
  }
  if (presentationMode === 'json' || presentationMode === 'both') {
    await openPresentationDocument(jsonPath, 'json');
  }
  return { jsonPath, markdownPath };
}

async function resolveRiskExplainSeedContext({ repoContext, cliResolution, seed, output }) {
  const resolutionSpec = {
    title: 'PairOfCleats: Risk Seed Resolution',
    progressTitle: 'PairOfCleats risk seed resolution',
    timeoutMs: 2 * 60 * 1000
  };
  const args = [
    ...cliResolution.argsPrefix,
    'context-pack',
    '--json',
    '--repo',
    repoContext.repoRoot,
    '--seed',
    seed,
    '--hops',
    '0',
    '--includeRisk'
  ];
  const result = await runBufferedJsonCommand({
    spec: resolutionSpec,
    repoRoot: repoContext.repoRoot,
    command: cliResolution.command,
    args,
    env: buildSpawnEnv(getExtensionConfiguration(repoContext)),
    output
  });
  if (!result.ok || !result.payload) {
    return {
      ok: false,
      message: result.message || 'PairOfCleats could not resolve the selected risk seed.',
      detail: result.detail || null
    };
  }
  try {
    return { ok: true, ...resolveRiskSource(result.payload, { repoRoot: repoContext.repoRoot, seed }) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function promptRiskExplainInput(repoContext, { cliResolution, output }) {
  const seed = await promptSeedRefInput(repoContext, {
    title: 'PairOfCleats risk explain seed',
    prompt: 'Risk-explain seed ref',
    placeHolder: 'e.g. chunk:ck123, symbol:AuthToken, or file:src/app.ts'
  });
  if (!seed) return null;
  const maxFlows = await promptPositiveInteger({
    prompt: 'Maximum risk flows',
    value: 5,
    placeHolder: '5'
  });
  if (!maxFlows) return null;
  const presentationMode = await promptPresentationMode('PairOfCleats risk explain presentation');
  if (!presentationMode) return null;
  const resolved = await resolveRiskExplainSeedContext({ repoContext, cliResolution, seed, output });
  if (!resolved.ok) {
    if (resolved.detail) output.appendLine(resolved.detail);
    output.show?.(true);
    vscode.window.showErrorMessage(resolved.message);
    return null;
  }
  return {
    seed,
    chunkUid: resolved.chunkUid,
    indexDir: resolved.indexDir,
    sourceQualification: resolved.sourceQualification,
    maxFlows,
    presentationMode
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
    invocation: 'cli',
    cliArgs: ['config', 'dump'],
    buildArgs(repoRoot) {
      return ['--json', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.indexHealth',
    title: 'PairOfCleats: Index Health',
    progressTitle: 'PairOfCleats index health',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['index', 'report'],
    buildArgs(repoRoot) {
      return ['--json', '--repo', repoRoot];
    }
  },
  {
    id: 'pairofcleats.indexValidate',
    title: 'PairOfCleats: Index Validate',
    progressTitle: 'PairOfCleats index validate',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['index', 'validate'],
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
    id: 'pairofcleats.contextPack',
    title: 'PairOfCleats: Context Pack',
    progressTitle: 'PairOfCleats context pack',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['context-pack'],
    async resolveInput(repoContext) {
      return promptContextPackInput(repoContext);
    },
    buildArgs(repoRoot, inputContext) {
      return [
        '--json',
        '--repo',
        repoRoot,
        '--seed',
        inputContext.seed,
        '--hops',
        String(inputContext.hops),
        '--includeRisk',
        '--includeTypes'
      ];
    },
    disableNavigationArtifacts: true
  },
  {
    id: 'pairofcleats.riskExplain',
    title: 'PairOfCleats: Risk Explain',
    progressTitle: 'PairOfCleats risk explain',
    timeoutMs: 2 * 60 * 1000,
    invocation: 'cli',
    cliArgs: ['risk', 'explain'],
    async resolveInput(repoContext, { cliResolution, output }) {
      return promptRiskExplainInput(repoContext, { cliResolution, output });
    },
    buildArgs(_repoRoot, inputContext) {
      return [
        '--json',
        '--index',
        inputContext.indexDir,
        '--chunk',
        inputContext.chunkUid,
        '--max',
        String(inputContext.maxFlows)
      ];
    },
    disableNavigationArtifacts: true
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
      return ['--repo', repoRoot, '--progress', 'jsonl'];
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
      return ['--repo', repoRoot, '--progress', 'jsonl'];
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
      return ['--repo', repoRoot, '--json'];
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
  if (!cliResolution?.ok) return cliResolution || { ok: false, message: 'Configured CLI is unavailable.' };
  if (spec.invocation !== 'cli' || !Array.isArray(spec.cliArgs) || !spec.cliArgs.length) {
    return { ok: false, message: `${spec.title} has no canonical configured-CLI dispatch.`,
      detail: 'Operator scripts are never discovered or executed from the target repository.' };
  }
  return {
    ok: true,
    command: cliResolution.command,
    args: [...cliResolution.argsPrefix, ...spec.cliArgs, ...extraArgs],
    inputContext
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

function summarizeContextPackPayload(payload) {
  const graphCounts = payload?.graph?.summary?.counts || payload?.graph?.counts || {};
  const typeFacts = Array.isArray(payload?.types?.facts) ? payload.types.facts.length : 0;
  const riskFlows = Array.isArray(payload?.risk?.flows) ? payload.risk.flows.length : 0;
  return [
    `- primary file: ${payload?.primary?.file || 'unknown'}`,
    `- seed type: ${payload?.primary?.ref?.type || 'unknown'}`,
    `- graph nodes: ${graphCounts.nodes ?? 0}`,
    `- graph edges: ${graphCounts.edges ?? 0}`,
    `- type facts: ${typeFacts}`,
    `- risk flows: ${riskFlows}`
  ];
}

function summarizeRiskExplainPayload(payload) {
  const filters = payload?.filters || {};
  const flows = Array.isArray(payload?.flows) ? payload.flows.length : 0;
  return [
    `- chunkUid: ${payload?.chunk?.chunkUid || 'unknown'}`,
    `- file: ${payload?.chunk?.file || 'unknown'}`,
    `- symbol: ${payload?.chunk?.name || 'n/a'}`,
    `- flows: ${flows}`,
    `- source rule: ${filters.sourceRule || 'n/a'}`,
    `- sink rule: ${filters.sinkRule || 'n/a'}`
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
  if (spec.disableNavigationArtifacts) return [];
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
    case 'pairofcleats.contextPack':
      return summarizeContextPackPayload(payload);
    case 'pairofcleats.riskExplain':
      return summarizeRiskExplainPayload(payload);
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
        windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
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
          killChildProcess(child);
        } catch {}
      }, spec.timeoutMs);
      timeout.unref?.();
      const cancelSub = token.onCancellationRequested(() => {
        output.appendLine('[command] cancellation requested');
        try {
          killChildProcess(child);
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
  const config = getExtensionConfiguration(repoContext);
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
    if (spec.id === 'pairofcleats.riskExplain' && result.kind !== 'cancelled') {
      output.appendLine('The selected generation or chunk may no longer be available. Run Risk Explain again to deliberately select the current generation.');
    }
    return;
  }
  if (spec.id === 'pairofcleats.riskExplain' && invocation.inputContext?.sourceQualification) {
    result.payload = { ...result.payload, sourceQualification: invocation.inputContext.sourceQualification };
  }
  appendOutputLines(output, summarizeOperatorPayload(spec, result.payload));
  output.appendLine('- raw-json:');
  appendJsonBlock(output, result.payload);
  try {
    await maybeOpenOperatorArtifacts(spec, result.payload, repoContext, output);
  } catch (err) {
    output.appendLine(`- warning: failed to open operator artifacts: ${err?.message || err}`);
  }
  try {
    await presentOperatorPayload(spec, result.payload, repoContext, invocation.inputContext || null, output);
  } catch (err) {
    output.appendLine(`- warning: failed to present operator payload: ${err?.message || err}`);
  }
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
  if (spec.id === 'pairofcleats.riskExplain') {
    output.appendLine('The selected generation or chunk may no longer be available. Run Risk Explain again to deliberately select the current generation.');
  }
  vscode.window.showErrorMessage(`${spec.title} reported issues. See PairOfCleats output for details.`);
}

async function runOperatorCommand(spec, { repoContext: seededRepoContext = null, inputContext: seededInputContext = undefined } = {}) {
  let config = getExtensionConfiguration();
  const workflow = spec.id === 'pairofcleats.indexHealth' ? 'index-health' : spec.id;
  const execution = await resolveExecutionMode(config, workflow);
  if (!execution.ok) {
    const output = getOutputChannel();
    output.appendLine(execution.detail || execution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(execution.message);
    return;
  }
  appendExecutionFallbackNote(getOutputChannel(), execution);
  const repoContext = seededRepoContext || await resolveRepoContext({ allowRemote: execution.mode === 'api' });
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
  config = getExtensionConfiguration(repoContext);
  if (seededRepoContext && !validateReplayRepoContext(repoContext, execution.mode)) return;
  const cliResolution = execution.mode === 'cli' ? resolveCli(repoRoot, config) : { ok: true };
  if (execution.mode === 'cli' && !cliResolution.ok) {
    const output = getOutputChannel();
    output.appendLine(cliResolution.detail || cliResolution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(cliResolution.message);
    return;
  }
  const output = getOutputChannel();
  const inputContext = seededInputContext !== undefined ? seededInputContext : typeof spec.resolveInput === 'function'
    ? await spec.resolveInput(repoContext, { cliResolution, config, output, execution })
    : undefined;
  if (inputContext === null) {
    return;
  }
  if (spec.id === 'pairofcleats.riskExplain') {
    const sourceError = validateRiskSource(inputContext, repoRoot);
    if (sourceError) {
      output.appendLine(sourceError);
      output.show?.(true);
      vscode.window.showErrorMessage(sourceError);
      return;
    }
  }
  if (execution.mode === 'api' && spec.id === 'pairofcleats.indexHealth') {
    let mapping;
    try { mapping = await resolveServiceRepository(repoContext, execution); }
    catch (error) { vscode.window.showErrorMessage(error.message); return; }
    if (!mapping) return;
    const requestPath = `/status?repo=${encodeURIComponent(mapping.serviceRoot)}`;
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
  const invocation = resolveOperatorInvocation(spec, repoContext, cliResolution, inputContext, config);
  if (!invocation.ok) {
    const output = getOutputChannel();
    output.appendLine(invocation.detail || invocation.message);
    output.show?.(true);
    vscode.window.showErrorMessage(invocation.message);
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

function killChildProcess(child) {
  void operations.stopChild(child);
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
  if (!entry) return { ok: false };
  if (entry.stopping || entry.settling) return entry.completion;
  entry.stopping = true;
  entry.stopReason = reason;
  entry.stopSummaryLine = summaryLine || '';
  entry.progress = { ...entry.progress, phase: 'stopping', cancellationRequestedAt: Date.now(),
    message: 'Cancellation requested; waiting for owned process and termination-helper settlement.' };
  entry.termination = Promise.resolve().then(() => operations.stopChild(entry.child));
  return entry.completion;
}

async function stopManagedCommand(stopSpec, { sessionId = null, repoRoot = null } = {}) {
  if (sessionId) {
    const active = Array.from(managedProcesses.values()).find((entry) => entry.sessionId === sessionId
      && entry.spec.id === stopSpec.targetId);
    if (!active) {
      vscode.window.showInformationMessage('PairOfCleats: that workflow has already stopped; refresh workflow status.');
      return;
    }
    await stopManagedProcessEntry(active, { reason: 'cancelled', summaryLine: `${active.spec.title} stopped.` });
    return;
  }
  const repoContext = repoRoot ? { ok: true, repoRoot } : await resolveRepoContext();
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
  const result = await stopManagedProcessEntry(active, {
    reason: 'cancelled',
    summaryLine: `${managedSpec.title} stopped.`
  });
  if (result?.ok !== true) {
    vscode.window.showErrorMessage('PairOfCleats could not confirm the selected process-tree stop. Inspect Tasks and logs for recovery.');
    return;
  }
  vscode.window.showInformationMessage(`${managedSpec.title} stopped.`);
}

async function startManagedCommand(spec, { repoContext: seededRepoContext = null } = {}) {
  let config = getExtensionConfiguration();
  const execution = await resolveExecutionMode(config, spec.id);
  if (!execution.ok) {
    vscode.window.showErrorMessage(execution.message);
    return;
  }
  const repoContext = seededRepoContext || await resolveRepoContext();
  if (!repoContext.ok) {
    if (repoContext.message) {
      vscode.window.showErrorMessage(repoContext.message);
    }
    return;
  }
  const { repoRoot } = repoContext;
  config = getExtensionConfiguration(repoContext);
  if (seededRepoContext && !validateReplayRepoContext(repoContext, 'cli')) return;
  const cliResolution = resolveCli(repoRoot, config);
  const invocation = resolveManagedInvocation(spec, repoContext, cliResolution);
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
    if (existing.cleanupUnconfirmed) {
      vscode.window.showErrorMessage(`${spec.title} cannot restart for ${formatRepoLabel(repoRoot)} while its earlier owned tree stop remains unconfirmed. Inspect the exact task logs and resolve that process lifetime first.`);
      return { ok: false, status: 'cleanup-unconfirmed', sessionId: existing.sessionId };
    }
    const output = getOutputChannel();
    output.appendLine(`[managed] ${spec.title} already running for ${repoRoot}`);
    output.show?.(true);
    vscode.window.showInformationMessage(`${spec.title} is already running for ${formatRepoLabel(repoRoot)}.`);
    return spec.persistent ? { ok: true, status: 'already-running', sessionId: existing.sessionId } : existing.completion;
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
  // Persist the operation identity before spawning. No await may separate a
  // successful spawn from attaching its output/terminal listeners.
  const session = await beginWorkflowSession(spec, repoContext, {
    kind: 'managed-process',
    command: invocation.command,
    args: invocation.args,
    timeoutMs: Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : 0,
    persistent: spec.persistent === true
  });
  const spawned = spawnBufferedProcess(cp, resolved.command, resolved.args, {
    cwd: repoRoot,
    env: resolved.env ? { ...env, ...resolved.env } : env,
    shell: false,
    windowsVerbatimArguments: resolved.windowsVerbatimArguments === true,
    windowsHide: true
  });
  if (!spawned.ok) {
    const failure = summarizeSpawnFailure(spec.title, spawned.error);
    await finishWorkflowSession(session.sessionId, { status: 'failed', summaryLine: failure.message });
    output.appendLine(failure.detail || failure.message);
    output.show?.(true);
    vscode.window.showErrorMessage(failure.message);
    return;
  }
  const child = spawned.child;
  noteRepoContext(repoContext);
  let timedOut = false;
  let resolvedCompletion = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const finalize = async ({ code = 0, error = null } = {}) => {
    if (resolvedCompletion) return;
    resolvedCompletion = true;
    entry.settling = true;
    entry.progress = { ...entry.progress, phase: entry.stopping ? 'stopping' : 'settling' };
    entry.stdoutDecoder?.flush();
    entry.stderrDecoder?.flush();
    const termination = entry.termination ? await entry.termination : null;
    const stopUnconfirmed = entry.stopping && termination?.ok !== true;
    const watchOwnershipPending = entry.watchOwnershipPending === true;
    entry.cleanupUnconfirmed = stopUnconfirmed || watchOwnershipPending;
    if (!entry.cleanupUnconfirmed && managedProcesses.get(key) === entry) managedProcesses.delete(key);
    const stoppedByUser = entry.stopReason === 'cancelled';
    const failed = Boolean(error) || timedOut || entry.cleanupUnconfirmed || entry.watchFailure === true || (!stoppedByUser && code !== 0);
    const status = failed ? 'failed' : stoppedByUser ? 'cancelled' : 'succeeded';
    const summaryLine = watchOwnershipPending
      ? `${spec.title} canonical watch teardown ownership remains pending. Inspect Tasks before any deliberate recovery.`
      : stopUnconfirmed
        ? `${spec.title} stop remains unconfirmed: ${termination?.message || 'owned termination did not settle successfully'}`
        : entry.watchFailure
          ? `${spec.title} canonical watch teardown reported failure; cancellation does not prove success.`
          : stoppedByUser
            ? (entry.stopSummaryLine || `${spec.title} stopped.`)
            : failed
              ? `${spec.title} exited with code ${code}.`
              : `${spec.title} completed.`;
    entry.status = status;
    entry.summaryLine = summaryLine;
    entry.progress = { ...entry.progress, phase: stopUnconfirmed ? 'stop-unconfirmed' : status, message: summaryLine };
    taskObservations.remember(entry, { status, summaryLine });
    await finishWorkflowSession(session.sessionId, { status, summaryLine });
    if (!stoppedByUser || failed) {
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
    repoRoot,
    repoUri: repoContext.repoUri,
    progress: { phase: 'starting', startedAt: Date.now(), lastActivityAt: Date.now() },
    logBytes: 0,
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
  const taskText = (prefix, line, truncated) => {
    entry.progress.lastActivityAt = Date.now();
    if (!entry.stopping && !entry.settling && managedProcesses.get(key) === entry
      && spec.id === 'pairofcleats.serviceApiStart' && prefix === '[stdout] ') {
      const endpoint = !truncated && apiReadinessFrame(line, entry.repoRoot);
      if (endpoint && entry.progress.endpoint !== endpoint) {
        entry.progress = { ...entry.progress, phase: 'ready', endpoint,
          message: 'API listener readiness observed in its authoritative startup frame.' };
        vscode.window.showInformationMessage(`${spec.title} ready at ${endpoint}.`);
      }
    }
    if (!line) return;
    retainTaskLog(entry, prefix, line);
    if (entry.logBytes >= 1024 * 1024 || (entry.logLinesShown || 0) >= 4096) return;
    const bounded = boundedLogLine(line, Math.min(8192, 1024 * 1024 - entry.logBytes));
    entry.logBytes += Buffer.byteLength(bounded);
    entry.logLinesShown = (entry.logLinesShown || 0) + 1;
    output.appendLine(`${prefix}${bounded}${truncated ? ' [line truncated]' : ''}`);
    if (entry.logBytes >= 1024 * 1024 || entry.logLinesShown >= 4096) output.appendLine('[managed] Raw task log reached its byte/line display bound. Inspect Tasks retains a bounded tail; structured status remains active.');
  };
  for (const [stream, prefix] of [[child.stdout, '[stdout] '], [child.stderr, '[stderr] ']]) {
    const decoder = createEditorProgressDecoder({
      onEvent: event => {
        if (managedProcesses.get(key) !== entry) return;
        const watch = spec.id === 'pairofcleats.indexWatchStart' ? readWatchProgress(event, entry.progress.watch) : null;
        if (watch && event.event === 'task:end') {
          entry.watchFailure = entry.watchFailure === true || event.status === 'failed' || watch.ownershipPending;
          entry.watchOwnershipPending = entry.watchOwnershipPending === true || watch.ownershipPending;
          if (entry.stopping || entry.settling) entry.progress = { ...entry.progress, watch };
        }
        if (entry.stopping || entry.settling) return;
        entry.progress = applyProgressEvent(entry.progress, event);
        if (operations.isCurrent()) entry.progressReporter?.report?.({ message: `${entry.progress.stage}: ${entry.progress.message}` });
      },
      onText: (line, truncated) => taskText(prefix, line, truncated)
    });
    if (prefix === '[stdout] ') entry.stdoutDecoder = decoder;
    else entry.stderrDecoder = decoder;
    stream?.on('data', chunk => decoder.push(chunk));
  }
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
    vscode.window.showInformationMessage(`${spec.title} is starting. Readiness has not been observed. Use ${stopTitle} or Inspect Tasks to stop it.`);
    return { ok: true, status: 'running', sessionId: session.sessionId };
  }
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: spec.progressTitle,
      cancellable: true
    },
    async (progress, token) => {
      entry.progressReporter = progress;
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

function executeSearchCommand(options = {}) {
  return operations.run('foreground-search', () => executeOwnedSearchCommand(options), { key: 'foreground-search' });
}

async function executeOwnedSearchCommand({
  query,
  explain = false,
  workflow = 'search',
  prompt = 'PairOfCleats search query',
  placeHolder = 'e.g. auth token validation',
  enumeration = false,
  optionOverrides = null
} = {}) {
  let config = getExtensionConfiguration();
  const execution = await resolveExecutionMode(config, explain ? 'explain-search' : workflow);
  if (!operations.isCurrent()) return;
  if (!execution.ok) {
    const output = getOutputChannel();
    output.appendLine(execution.detail || execution.message);
    output.show?.(true);
    vscode.window.showErrorMessage(execution.message);
    return;
  }
  const repoContext = await resolveSearchRepoContext({ allowRemote: execution.mode === 'api' });
  if (!repoContext || !operations.isCurrent()) return;
  const { repoRoot } = repoContext;
  config = getExtensionConfiguration(repoContext);
  let serviceMapping = null;
  if (execution.mode === 'api') {
    try { serviceMapping = await resolveServiceRepository(repoContext, execution); }
    catch (error) { vscode.window.showErrorMessage(error.message); return; }
    if (!serviceMapping || !operations.isCurrent()) return;
  }
  const resolvedQuery = enumeration ? '' : query && String(query).trim()
    ? String(query).trim()
    : await promptSearchQuery({ prompt, placeHolder });
  if ((!resolvedQuery && !enumeration) || !operations.isCurrent()) return;

  const cliResolution = resolveCli(repoRoot, config);
  if (execution.mode === 'cli' && !cliResolution.ok) {
    vscode.window.showErrorMessage(cliResolution.message);
    const output = getOutputChannel();
    output.appendLine(cliResolution.detail || cliResolution.message);
    output.show?.(true);
    return;
  }
  let searchOptions;
  let searchArgs = null;
  let searchPayload = null;
  try {
    searchOptions = { ...readSearchOptions(config, VSCODE_SETTINGS), ...(optionOverrides || {}), explain };
    if (execution.mode === 'api') {
      searchPayload = buildApiSearchRequest(resolvedQuery, serviceMapping.serviceRoot, searchOptions);
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
      cancellable: true
    },
    async (_, token) => {
      if (execution.mode === 'api') {
        const scope = operations.current();
        const cancelSub = token.onCancellationRequested(() => operations.cancelScope(scope));
        if (token.isCancellationRequested) operations.cancelScope(scope);
        let result;
        try {
          result = await requestApiJson(execution.baseUrl, '/search', {
            method: 'POST',
            payload: searchPayload,
            headers: execution.headers || null,
            timeoutMs: execution.timeoutMs,
            label: 'PairOfCleats search'
          });
        } finally {
          cancelSub.dispose();
        }
        if (!operations.isCurrent()) return;
        if (!result.ok) {
          appendRuntimeFailure(output, '[search api]', result);
          output.show?.(true);
          vscode.window.showErrorMessage(result.message);
          return;
        }
        let payload;
        try { payload = mapServicePayload(result.payload?.result || result.payload, serviceMapping.serviceRoot); }
        catch (error) { vscode.window.showErrorMessage(error.message); return; }
        const hits = collectSearchHits(payload);
        if (enumeration) {
          try { admitFilterPage(payload?.pagination, hits); }
          catch (error) { vscode.window.showErrorMessage(error.message); return; }
        }
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
          hits,
          payload,
          explain
        });
        if (!hits.length) {
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
          windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
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
            killChildProcess(child);
          } catch {}
        }, searchTimeoutMs);
        timeout.unref?.();
        const cancelSub = token.onCancellationRequested(() => {
          output.appendLine('[search] cancellation requested');
          try {
            killChildProcess(child);
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
          if (!operations.isCurrent()) { resolve(); return; }
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
          if (enumeration) {
            try { admitFilterPage(payload?.pagination, hits); }
            catch (error) { vscode.window.showErrorMessage(error.message); resolve(); return; }
          }
          const resultSet = await recordSearchResultSet({
            repoContext,
            query: resolvedQuery,
            searchOptions,
            invocation: {
              kind: 'cli-search',
              command,
              args,
              transport: 'cli'
            },
            hits,
            payload,
            explain
          });

          if (!hits.length) {
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
          if (explain && resultSet) {
            appendOutputLines(output, renderSearchExplanation(resultSet, normalizeSearchHit(selected)));
            output.show?.(true);
          }
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
function currentQualifiedSemanticSeed(repoContext) {
  const captured = latestNavigationEvidence;
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  const position = editor?.selection?.active;
  if (!captured || captured.repoContext.repoRoot !== repoContext.repoRoot
      || document?.uri?.fsPath !== captured.sourceFile || !position
      || position.line !== captured.position.line || position.character !== captured.position.character) return null;
  try {
    const args = sourceNavigationArgs(document, position, true, repoContext.repoRoot);
    if (args[args.indexOf('--source-hash') + 1] !== captured.payload.sourceHash
        || args[args.indexOf('--source-version') + 1] !== captured.payload.sourceVersion) return null;
    return qualifiedBindingSeed(captured.payload);
  } catch { return null; }
}

const runSemanticEvidence = createSemanticEvidenceWorkflow({
  vscode, operations,
  getCursorSeed: currentQualifiedSemanticSeed,
  resolveCursorSeed: async repoContext => {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document, position = editor?.selection?.active;
    if (!document?.uri?.fsPath || !position) return null;
    const relative = path.relative(repoContext.repoRoot, document.uri.fsPath);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    await runNavigationCommand({ kind: 'definitions', repoContext, sourceDocument: document, position,
      query: getWordQueryAtPosition(document, position), filePath: document.uri.fsPath, limit: NAVIGATION_RESULT_LIMIT });
    const seed = currentQualifiedSemanticSeed(repoContext);
    if (!seed && operations.isCurrent()) vscode.window.showInformationMessage(
      `Current indexed cursor binding is ${latestNavigationEvidence?.payload?.status || 'unavailable'}. Select a source/structural query or explicit generation; no unique semantic target was inferred.`);
    return seed;
  },
  resolveRepo: node => node?.resultSet ? Promise.resolve(createStoredRepoContext(node.resultSet)) : resolveSearchRepoContext(),
  chooseTransport: async repoContext => {
    const config = getExtensionConfiguration(repoContext);
    const execution = await resolveExecutionMode(config, 'semantic-find');
    if (!execution.ok) throw new Error(execution.message);
    if (execution.mode === 'api' && execution.capabilities?.['semantic-find'] !== true) throw new Error('The selected service does not advertise semantic find. Use an explicitly supported transport.');
    const mapping = execution.mode === 'api' ? await resolveServiceRepository(repoContext, execution) : null;
    if (execution.mode === 'api' && !mapping) return null;
    return { transport: execution.mode, execution, config, serviceMapping: mapping };
  },
  discoverGeneration: async (repoContext, state, seedNode) => {
    const { execution, config } = state;
    let seed = seedNode?.hit?.chunkUid ? `chunk:${seedNode.hit.chunkUid}` : null;
    if (!seed) {
      let file = seedNode?.hit?.file || vscode.window.activeTextEditor?.document?.uri?.fsPath || '';
      if (path.isAbsolute(file)) file = path.relative(repoContext.repoRoot, file).replace(/\\/g, '/');
      if (!file || file === '..' || file.startsWith('../') || path.isAbsolute(file)) {
        file = await vscode.window.showInputBox({ prompt: 'Retained source path for canonical semantic generation discovery',
          placeHolder: 'Repository-relative path; no directory scan or build' });
      }
      if (!file) throw new Error('Select a source file or search hit to discover its published semantic generation.');
      if (file.startsWith('/') || file.includes(':') || file.split(/[\\/]/).some(part => ['.', '..'].includes(part))) throw new Error('Generation discovery source must remain inside the selected repository.');
      seed = `file:${file.replace(/\\/g, '/')}`;
    }
    let payload, expectedRepo = repoContext.repoRoot;
    if (execution.mode === 'api') {
      if (execution.capabilities?.['context-pack'] !== true) throw new Error('Service supports semantic requests but does not advertise context-pack generation discovery. Enter a known immutable generation.');
      expectedRepo = state.serviceMapping.serviceRoot;
      const response = await requestApiJson(execution.baseUrl, '/analysis/context-pack', { method: 'POST',
        payload: contextDiscoveryRequest(expectedRepo, seed), timeoutMs: execution.timeoutMs,
        label: 'Canonical semantic generation discovery' });
      if (!response.ok) throw new Error(response.message);
      payload = response.payload?.result || response.payload;
    } else {
      const cli = resolveCli(repoContext.repoRoot, config);
      if (!cli.ok) throw new Error(cli.message);
      const response = await runBufferedJsonCommand({
        spec: { title: 'Semantic generation discovery', progressTitle: 'PairOfCleats semantic generation discovery', timeoutMs: 5000 },
        repoRoot: repoContext.repoRoot, command: cli.command, args: [...cli.argsPrefix, ...contextDiscoveryCliArgs(repoContext.repoRoot, seed)],
        env: buildSpawnEnv(config), output: getOutputChannel() });
      if (!response?.ok) throw new Error(response?.message || 'Canonical semantic generation discovery failed.');
      payload = response.payload;
    }
    if (Buffer.byteLength(JSON.stringify(payload)) > 131072) throw new Error('Generation discovery exceeds the 128 KiB editor response bound.');
    const witness = generationFromContextPack(payload, expectedRepo);
    if (!witness) throw new Error('Selected source has no authoritative semantic generation section. Choose another source or an explicit immutable generation.');
    return witness;
  },
  execute: async (operation, request, state) => {
    const { execution, config, repoContext } = state;
    if (execution.mode === 'api') {
      request = { ...request, repoRoot: state.serviceMapping.serviceRoot };
      const probe = await getCachedApiCapabilities(execution.baseUrl, execution.timeoutMs);
      if (probe.capabilities?.[`semantic-${operation}`] !== true) throw new Error(`Service does not advertise semantic ${operation}.`);
      const response = await requestApiJson(execution.baseUrl, `/analysis/semantic-${operation}`, {
        method: 'POST', payload: request, timeoutMs: execution.timeoutMs, label: `Semantic ${operation}` });
      if (!response.ok) throw new Error(response.message);
      return response.payload?.result || response.payload;
    }
    const cli = resolveCli(repoContext.repoRoot, config);
    if (!cli.ok) throw new Error(cli.message);
    const storage = extensionContext?.globalStorageUri?.fsPath;
    if (!storage) throw new Error('Extension-owned request storage is unavailable.');
    fs.mkdirSync(storage, { recursive: true });
    const directory = fs.mkdtempSync(path.join(storage, 'semantic-request-'));
    const requestPath = path.join(directory, 'request.json');
    try {
      fs.writeFileSync(requestPath, JSON.stringify(request), { encoding: 'utf8', flag: 'wx' });
      const result = await runBufferedJsonCommand({
        spec: { title: `Semantic ${operation}`, progressTitle: `PairOfCleats semantic ${operation}`, timeoutMs: 5000 },
        repoRoot: repoContext.repoRoot, command: cli.command,
        args: [...cli.argsPrefix, 'semantic', operation, '--request', requestPath],
        env: buildSpawnEnv(config), output: getOutputChannel()
      });
      if (!result?.ok || !result.payload) throw new Error(result?.message || 'Semantic operation failed.');
      if (Buffer.byteLength(JSON.stringify(result.payload)) > 128 * 1024) throw new Error('Semantic response exceeds the editor evidence bound.');
      // Process-local CLI cursors cannot be resumed by another invocation.
      if (result.payload.cursor) result.payload.warnings = [...(result.payload.warnings || []),
        'Additional bounded pages require a persistent API session; CLI cursor expires with this process.'];
      return result.payload;
    } finally {
      try { fs.unlinkSync(requestPath); } catch {}
      try { fs.rmdirSync(directory); } catch {}
    }
  }
});

const copySelectedContext = createEvidenceCollection({
  vscode, operations, getResults: getActiveSearchResultSet,
  fetchContext: async (seed, resultSet) => {
    const repoContext = createStoredRepoContext(resultSet);
    const config = getExtensionConfiguration(repoContext);
    const execution = await resolveExecutionMode(config, 'context-collection');
    if (!execution.ok) throw new Error(execution.message);
    if (execution.mode === 'api') {
      const probe = await getCachedApiCapabilities(execution.baseUrl, execution.timeoutMs);
      if (probe.capabilities?.['context-pack'] !== true) throw new Error('Service does not advertise context-pack.');
      const mapping = await resolveServiceRepository(repoContext, execution);
      if (!mapping) throw new Error('Service repository selection was cancelled.');
      const response = await requestApiJson(execution.baseUrl, '/analysis/context-pack', {
        method: 'POST', payload: { repo: mapping.serviceRoot, seed, hops: 0, includeRisk: true,
          maxBytes: 24576, maxNodes: 16, maxEdges: 32 },
        timeoutMs: execution.timeoutMs, label: 'PairOfCleats selected context' });
      if (!response.ok) throw new Error(response.message);
      return response.payload?.result || response.payload;
    }
    const cli = resolveCli(repoContext.repoRoot, config);
    if (!cli.ok) throw new Error(cli.message);
    const response = await runBufferedJsonCommand({ spec: { title: 'Selected context', progressTitle: 'PairOfCleats selected context', timeoutMs: 5000 },
      repoRoot: repoContext.repoRoot, command: cli.command,
      args: [...cli.argsPrefix, 'context-pack', '--repo', repoContext.repoRoot, '--seed', seed,
        '--hops', '0', '--includeRisk', '--maxBytes', '24576', '--maxNodes', '16', '--maxEdges', '32', '--json'],
      env: buildSpawnEnv(config), output: getOutputChannel() });
    if (!response?.ok || !response.payload) throw new Error(response?.message || 'Canonical context collection failed.');
    return response.payload;
  }
});

const openCapturedEvidence = createCapturedEvidenceOpener({ vscode, operations,
  getEvidence: () => latestAnalysisEvidence, collectSources: collectEvidenceSources,
  resolveTarget: (repoContext, hit) => resolveValidatedHitTarget(vscode, repoContext, hit),
  createContext: (node, isCurrent) => copySelectedContext(node, isCurrent) });

function inspectIndexedNavigation(kind) {
  return operations.run('indexed-navigation-picker', () => inspectOwnedIndexedNavigation(kind), { key: 'indexed-navigation-picker' });
}

function inspectIndexedDocumentSymbols() {
  return operations.run('indexed-document-symbols', async () => {
    const document = vscode.window.activeTextEditor?.document;
    const request = captureNavigationRequest(document, null, true, { allowDirty: true });
    if (!request) return;
    const repoContext = await resolveRepoContext({ pathHint: document.uri, allowPrompt: false });
    if (!repoContext.ok || !operations.isCurrent() || !request.isCurrent()) return;
    const rows = await runNavigationCommand({ kind: 'document-symbols', repoContext,
      filePath: request.file, limit: DOCUMENT_SYMBOL_LIMIT });
    if (!operations.isCurrent() || !request.isCurrent()) return;
    const evidence = await vscode.workspace.openTextDocument({ language: 'plaintext', content: [
      'PairOfCleats indexed document symbols — retained evidence',
      `Repository: ${repoContext.repoRoot}`, `Source: ${request.file}`,
      'Indexed labels and chunk lines may be stale or unlocated. These are not native Outline positions.',
      ...(document.isDirty ? ['Unsaved source differs: save before requesting exact native symbols.'] : []),
      'Save source, then run PairOfCleats: Index Build to refresh indexed evidence.', '',
      ...rows.map(row => `${row.name || row.qualifiedName || 'symbol'} • ${row.kind || 'unknown kind'} • indexed lines ${
        row.startLine ?? 'unknown'}–${row.endLine ?? 'unknown'}`),
      ...(rows.length ? [] : ['No retained indexed symbol evidence is available.'])
    ].join('\n') });
    if (!operations.isCurrent() || !request.isCurrent()) return;
    await vscode.window.showTextDocument(evidence, { preview: true });
  }, { key: 'indexed-document-symbols' });
}

function currentNavigationCursor(request) {
  const editor = vscode.window.activeTextEditor, position = editor?.selection?.active;
  return operations.isCurrent() && request.isCurrent() && editor?.document === request.document
    && position?.line === request.position?.line && position?.character === request.position?.character;
}

async function inspectOwnedIndexedNavigation(kind) {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  const position = editor?.selection?.active;
  if (!document || !position) return;
  const sourceRequest = captureNavigationRequest(document, position);
  if (!sourceRequest) return;
  const locations = kind === 'references'
    ? await provideOwnedReferences(document, sourceRequest.position, { includeDeclaration: true }, sourceRequest)
    : await provideOwnedDefinitions(document, sourceRequest.position, sourceRequest);
  if (!currentNavigationCursor(sourceRequest)) return;
  if (!locations?.length && latestNavigationEvidence?.sourceRequest === sourceRequest && latestNavigationEvidence.payload?.binding?.candidates?.length) {
    const evidence = latestNavigationEvidence;
    const candidates = evidence.payload.binding.candidates.map(original => {
      const value = Object.freeze({ ...original, span: Array.isArray(original.span) ? Object.freeze([...original.span]) : original.span });
      return { label: `${value.status || 'candidate'} • ${value.targetId}`, description: value.file || 'external source',
        detail: `Binding remains ${evidence.payload.status}; inspect one candidate without pooling references`, candidate: value };
    });
    const candidate = await vscode.window.showQuickPick(candidates, { title: 'Inspect ambiguous indexed binding candidates' });
    if (!candidates.includes(candidate) || !currentNavigationCursor(sourceRequest)) return;
    try {
      sourceRequest.args(evidence.repoContext.repoRoot);
      const value = candidate.candidate;
      const target = sourceQualifiedSelection(evidence.repoContext, { path: value.file, sourceHash: value.sourceHash,
        coordinateUnit: value.coordinateUnit }, { span: value.span });
      const authority = createDocumentAuthority({ workspace: vscode.workspace, isCurrent: () => operations.isCurrent(), maxDocuments: 1 });
      const qualified = await authority.qualify({ repoRoot: evidence.repoContext.repoRoot, file: target.file,
        uri: vscode.Uri.file(target.file), sourceHash: target.sourceHash, span: { start: target.start, end: target.end } });
      if (!qualified) return;
      if (!operations.isCurrent()) return;
      sourceRequest.args(evidence.repoContext.repoRoot);
      const editor = await vscode.window.showTextDocument(qualified.document);
      await authority.assertCurrent();
      if (!operations.isCurrent()) return;
      sourceRequest.args(evidence.repoContext.repoRoot);
      assertQualifiedEditor(editor, qualified);
      editor.selection = new vscode.Selection(qualified.document.positionAt(qualified.offsets.start), qualified.document.positionAt(qualified.offsets.end));
      editor.revealRange(editor.selection);
      vscode.window.showInformationMessage('Opened candidate evidence. The indexed binding remains ambiguous; references were not pooled.');
    } catch (error) { if (operations.isCurrent()) vscode.window.showErrorMessage(error.message); }
    return;
  }
  if (!locations?.length) return;
  const items = locations.map(location => ({
    label: location.uri?.path || location.uri?.fsPath || 'source',
    description: `${location.range?.start.line + 1}:${location.range?.start.character + 1}`, location
  }));
  const selected = await vscode.window.showQuickPick(items, { title: `Indexed ${kind}: source-qualified candidates` });
  if (!items.includes(selected) || !currentNavigationCursor(sourceRequest)) return;
  const source = navigationLocationSources.get(selected.location);
  if (!source || source.sourceRequest !== sourceRequest) { vscode.window.showErrorMessage('The selected native location has no original request/source witness. Inspect indexed navigation again.'); return; }
  try {
    sourceRequest.args(source.repoContext.repoRoot);
    const authority = createDocumentAuthority({ workspace: vscode.workspace, isCurrent: () => operations.isCurrent(), maxDocuments: 1 });
    const target = resolveValidatedHitTarget(vscode, source.repoContext, source.entry);
    if (!target.ok) throw new Error(target.message);
    const qualified = await authority.qualify({ repoRoot: source.repoContext.repoRoot, file: target.filePath,
      uri: target.targetUri, sourceHash: source.entry.sourceHash, range: source.entry });
    if (!qualified) return;
    if (!operations.isCurrent()) return;
    sourceRequest.args(source.repoContext.repoRoot);
    const editor = await vscode.window.showTextDocument(qualified.document);
    await authority.assertCurrent();
    if (!operations.isCurrent()) return;
    sourceRequest.args(source.repoContext.repoRoot);
    assertQualifiedEditor(editor, qualified);
    editor.selection = new vscode.Selection(qualified.document.positionAt(qualified.offsets.start), qualified.document.positionAt(qualified.offsets.end));
    editor.revealRange(editor.selection);
  } catch (error) { if (operations.isCurrent()) vscode.window.showErrorMessage(`Indexed selection unavailable: ${error.message}`); }
}

async function resolveServiceRepository(repoContext, execution, { force = false } = {}) {
  if (repoContext.repoUri?.scheme !== 'file' || repoContext.supportsLocalFs === false) {
    throw new Error('Service mapping requires a file checkout on the workspace extension host. Virtual/non-file URI roots cannot be source-qualified.');
  }
  const editorUri = repoContext.repoUri?.toString?.() || '';
  const mappings = readWorkspaceState('pairofcleats.serviceRepositories', {}) || {};
  const key = `${execution.baseUrl}::${editorUri}`;
  let mapping = force ? null : mappings[key];
  const commit = readGitHead(repoContext.repoRoot);
  if (!commit) throw new Error('Service mapping needs a readable Git HEAD for source identity. Use a supported local CLI checkout or select a source-qualified service workflow.');
  let root = mapping?.serviceRoot;
  if (!root) {
    const value = await vscode.window.showInputBox({ prompt: `Repository path on ${execution.baseUrl} (service host)`,
      value: repoContext.repoRoot, placeHolder: '/srv/repositories/project or C:\\repositories\\project' });
    if (!value) return null;
    root = validateServiceRoot(value);
  }
  const response = await requestApiJson(execution.baseUrl, `/status?repo=${encodeURIComponent(root)}`, {
    timeoutMs: execution.timeoutMs, label: 'PairOfCleats service repository identity' });
  if (!response.ok) throw new Error(response.message);
  const identity = verifyServiceRevision(response.payload?.status, commit);
  if (!mapping) {
    const action = await vscode.window.showInformationMessage(
      `Service ${execution.baseUrl} repository ${root} matches revision ${identity.commit.slice(0, 12)}. ` +
      `Open results in ${editorUri}. Editor working-tree freshness remains unverified.`, 'Use repository mapping');
    if (action !== 'Use repository mapping') return null;
    mapping = { serviceRoot: root, editorUri, commit, verifiedAt: new Date().toISOString() };
    mappings[key] = mapping;
    await writeWorkspaceState('pairofcleats.serviceRepositories', mappings);
  }
  return { ...mapping, ...identity };
}

async function inspectTasks() {
  const active = Array.from(managedProcesses.values());
  const activeIds = new Set(active.map(entry => entry.sessionId));
  const entries = [...active, ...taskObservations.list().filter(entry => !activeIds.has(entry.sessionId))];
  if (!entries.length) { await showWorkflowStatus(); return; }
  const picked = await vscode.window.showQuickPick(entries.map(entry => ({
    label: entry.spec.title, description: `${entry.repoRoot} • ${entry.progress?.phase || 'starting'}`,
    detail: entry.sessionId, entry
  })), { title: 'PairOfCleats exact task', placeHolder: 'Choose the repository and operation to inspect' });
  if (!picked) return;
  const entry = picked.entry;
  const document = await vscode.workspace.openTextDocument({ content: describeTask(entry), language: 'plaintext' });
  await vscode.window.showTextDocument(document, { preview: true });
  const activeEntry = managedProcesses.get(entry.key)?.sessionId === entry.sessionId && !entry.cleanupUnconfirmed && !entry.settling;
  const actions = taskRecoveryActions(entry, activeEntry);
  const pickedAction = await vscode.window.showQuickPick(actions.map(item => item.label),
    { title: `${entry.spec.title} • ${entry.repoRoot}`, placeHolder: 'Safe registered recovery actions' });
  const action = actions.find(item => item.label === pickedAction)?.action;
  const repoContext = { ok: true, ...createStoredRepoContext({ repoRoot: entry.repoRoot,
    repoUri: entry.workspaceUri || entry.repoUri?.toString?.() || '' }) };
  if (action === 'logs') {
    const text = [describeTask(entry), '', `Task log tail${entry.logTailTruncated ? ' (older lines omitted)' : ''}:`,
      ...(entry.logTail || []).map(row => row.text)].join('\n');
    const logs = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
    await vscode.window.showTextDocument(logs, { preview: true });
  }
  else if (action === 'settings') await showEffectiveSettings(repoContext);
  else if (action === 'doctor' || action === 'health') {
    const id = action === 'doctor' ? 'pairofcleats.doctor' : 'pairofcleats.indexHealth';
    await runOperatorCommand(OPERATOR_COMMANDS_BY_ID.get(id), { repoContext });
  }
  else if (action === 'select') await selectRepo();
  else if (action === 'retry') {
    const session = workflowSessions.find(item => item.sessionId === entry.sessionId);
    if (session) await rerunWorkflowSession(session);
    else vscode.window.showInformationMessage('This task observation has no admitted saved workflow. Run its registered command deliberately.');
  }
  else if (action === 'stop') {
    if (managedProcesses.get(entry.key)?.sessionId !== entry.sessionId) {
      vscode.window.showInformationMessage('That exact task already settled. Inspect tasks again.');
      return;
    }
    entry.progress.phase = 'cancellation-requested';
    await stopManagedProcessEntry(entry, { reason: 'cancelled', summaryLine: `${entry.spec.title} stopped after owned process settlement.` });
  }
}

async function selectServiceRepository() {
  return operations.run('service-repository', async () => {
    try {
      const repoContext = await resolveSearchRepoContext();
      if (!repoContext) return;
      const config = getExtensionConfiguration(repoContext);
      const execution = await resolveExecutionMode(config, 'search', 'api');
      if (!execution.ok) throw new Error(execution.message);
      await resolveServiceRepository(repoContext, execution, { force: true });
    } catch (error) { if (operations.isCurrent()) vscode.window.showErrorMessage(error.message); }
  });
}

async function browseIndexedMatches() {
  const filter = await promptTextInput({ prompt: 'Browse indexed metadata: filter expression',
    placeHolder: 'e.g. lang:javascript — current repo, modes, backend and time settings apply' });
  if (!filter?.trim()) return;
  await executeSearchCommand({ enumeration: true, optionOverrides: { filter: filter.trim() } });
}

async function loadMoreIndexedMatches() {
  const previous = getActiveSearchResultSet();
  if (!previous?.pagination?.hasMore || !previous.pagination.nextCursor) {
    vscode.window.showInformationMessage('No indexed continuation is available. Ranked text search is top-k.');
    return;
  }
  const config = getExtensionConfiguration(createStoredRepoContext(previous));
  const policy = readApiSettings(config);
  if (policy.error) { vscode.window.showErrorMessage(policy.error); return; }
  const capturedApi = previous.invocation?.kind === 'api-search';
  if ((capturedApi && (policy.mode === 'cli' || policy.baseUrl !== previous.invocation.baseUrl))
    || (!capturedApi && policy.mode === 'require')) {
    vscode.window.showErrorMessage('Transport policy or endpoint changed. Restart indexed browsing with the intended transport.');
    return;
  }
  let invocation;
  try { invocation = continuationInvocation(previous.invocation, previous.pagination.nextCursor); }
  catch (error) { vscode.window.showErrorMessage(`${error.message} Restart indexed browsing to capture its scope.`); return; }
  await operations.run('foreground-search', () => runOwnedSavedSearch(
    { ...previous, invocation }, createStoredRepoContext(previous), previous), { key: 'foreground-search' });
}

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

function runSavedSearchInvocation(resultSet, repoContext) {
  return operations.run('foreground-search', () => runOwnedSavedSearch(resultSet, repoContext), { key: 'foreground-search' });
}

async function runOwnedSavedSearch(resultSet, repoContext, appendTo = null) {
  const output = getOutputChannel();
  const invocation = resultSet?.invocation || null;
  let hits = [];
  let payload = null;
  if (invocation?.kind === 'api-search') {
    const result = await requestApiJson(invocation.baseUrl, '/search', {
      method: 'POST',
      payload: invocation.payload,
      headers: buildApiHeaders(getExtensionConfiguration(repoContext), invocation.baseUrl),
      timeoutMs: invocation.timeoutMs || DEFAULT_API_TIMEOUT_MS,
      label: 'PairOfCleats search'
    });
    if (!result.ok) {
      if (result.detail) output.appendLine(result.detail);
      output.show?.(true);
      vscode.window.showErrorMessage(result.message || 'PairOfCleats search failed.');
      return { ok: false };
    }
    payload = mapServicePayload(result.payload?.result || result.payload, invocation.payload.repo);
    hits = collectSearchHits(payload);
  } else {
    const searchTimeoutMs = 60000;
    const spec = { title: 'PairOfCleats search', progressTitle: 'PairOfCleats search', timeoutMs: searchTimeoutMs };
    const env = buildSpawnEnv(getExtensionConfiguration(repoContext));
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
    payload = result.payload;
    hits = collectSearchHits(payload);
  }
  if (appendTo) {
    if (!operations.isCurrent() || getActiveSearchResultSet()?.resultSetId !== appendTo.resultSetId) return { ok: false };
    try {
      const pagination = normalizeFilterPagination(payload?.pagination);
      const merged = mergeFilterPage(appendTo, pagination, hits);
      const updated = normalizeSearchResultSet({ ...appendTo, hits: merged, totalHits: merged.length, pagination });
      searchHistory = searchHistory.map(entry => entry.resultSetId === updated.resultSetId ? updated : entry);
      await persistSearchHistory();
      refreshResultsExplorer();
      vscode.window.showInformationMessage(`PairOfCleats indexed matches: ${merged.length} loaded; ${pagination.total ?? 'unknown'} total. ${pagination.coverageNote}`);
      return { ok: true, hits: merged };
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
      return { ok: false };
    }
  }
  await recordSearchResultSet({
    repoContext,
    query: resultSet.query,
    searchOptions: {
      mode: resultSet.mode,
      backend: resultSet.backend
    },
    invocation: resultSet.invocation,
    hits,
    payload,
    explain: Boolean(resultSet.explanation)
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
  inlineRiskDiagnostics = typeof vscode.languages?.createDiagnosticCollection === 'function'
    ? vscode.languages.createDiagnosticCollection('pairofcleats-inline-risk')
    : null;
  if (inlineRiskDiagnostics) {
    context.subscriptions.push(inlineRiskDiagnostics);
  }
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
  const definitionProvider = typeof vscode.languages?.registerDefinitionProvider === 'function'
    ? vscode.languages.registerDefinitionProvider({ scheme: 'file' }, { provideDefinition: provideDefinitionsAtPosition })
    : null;
  const referenceProvider = typeof vscode.languages?.registerReferenceProvider === 'function'
    ? vscode.languages.registerReferenceProvider({ scheme: 'file' }, { provideReferences: provideReferencesAtPosition })
    : null;
  const documentSymbolProvider = typeof vscode.languages?.registerDocumentSymbolProvider === 'function'
    ? vscode.languages.registerDocumentSymbolProvider({ scheme: 'file' }, { provideDocumentSymbols: provideDocumentSymbolsForDocument })
    : null;
  const completionProvider = typeof vscode.languages?.registerCompletionItemProvider === 'function'
    ? vscode.languages.registerCompletionItemProvider(
      { scheme: 'file' },
      { provideCompletionItems: provideCompletionItemsAtPosition }
    )
    : null;
  const hoverProvider = typeof vscode.languages?.registerHoverProvider === 'function'
    ? vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: provideInlineHoverAtPosition })
    : null;
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
  if (definitionProvider) context.subscriptions.push(definitionProvider);
  if (referenceProvider) context.subscriptions.push(referenceProvider);
  if (documentSymbolProvider) context.subscriptions.push(documentSymbolProvider);
  if (completionProvider) context.subscriptions.push(completionProvider);
  if (hoverProvider) context.subscriptions.push(hoverProvider);
  for (const spec of OPERATOR_COMMAND_SPECS) {
    const command = vscode.commands.registerCommand(spec.id, () => runOperatorCommand(spec));
    context.subscriptions.push(command);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('pairofcleats.showEffectiveSettings', showEffectiveSettings),
    vscode.commands.registerCommand('pairofcleats.browseIndexedMatches', browseIndexedMatches),
    vscode.commands.registerCommand('pairofcleats.loadMoreResults', loadMoreIndexedMatches),
    vscode.commands.registerCommand('pairofcleats.semanticEvidence', runSemanticEvidence),
    vscode.commands.registerCommand('pairofcleats.selectServiceRepository', selectServiceRepository),
    vscode.commands.registerCommand('pairofcleats.inspectTasks', inspectTasks),
    vscode.commands.registerCommand('pairofcleats.copyContext', node => copySelectedContext(node)),
    vscode.commands.registerCommand('pairofcleats.openEvidence', openCapturedEvidence),
    vscode.commands.registerCommand('pairofcleats.navigateDefinitions', () => inspectIndexedNavigation('definitions')),
    vscode.commands.registerCommand('pairofcleats.navigateReferences', () => inspectIndexedNavigation('references')),
    vscode.commands.registerCommand('pairofcleats.inspectDocumentSymbols', inspectIndexedDocumentSymbols)
  );
  if (typeof vscode.workspace.onDidChangeConfiguration === 'function') {
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (!event?.affectsConfiguration || event.affectsConfiguration(VSCODE_SETTINGS.namespace)) {
        if (typeof apiCapabilityCache !== 'undefined') apiCapabilityCache.clear();
        invalidateInlineSignals();
        updateWorkflowStatusBar();
      }
    }));
  }
  if (typeof vscode.window.onDidChangeActiveTextEditor === 'function') {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
      updateWorkflowStatusBar();
      void refreshInlineSignalsForActiveEditor();
    }));
  }
  if (typeof vscode.workspace.onDidChangeWorkspaceFolders === 'function') {
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      operations.invalidate('workspace-folders-changed');
      invalidateInlineSignals();
      updateWorkflowStatusBar();
      void refreshInlineSignalsForActiveEditor();
    }));
  }
  for (const event of ['onDidChangeTextDocument', 'onDidSaveTextDocument', 'onDidCloseTextDocument', 'onDidChangeConfiguration']) {
    if (typeof vscode.workspace[event] !== 'function') continue;
    context.subscriptions.push(vscode.workspace[event](() => {
      invalidateInlineSignals();
      void refreshInlineSignalsForActiveEditor();
    }));
  }
  if (typeof vscode.workspace.createFileSystemWatcher === 'function') {
    const watcher = vscode.workspace.createFileSystemWatcher('**/{current.json,artifacts.manifest.json}');
    const refresh = () => { invalidateInlineSignals(); void refreshInlineSignalsForActiveEditor(); };
    context.subscriptions.push(watcher);
    for (const event of ['onDidCreate', 'onDidChange', 'onDidDelete']) {
      const subscription = watcher[event]?.(refresh);
      if (subscription) context.subscriptions.push(subscription);
    }
  }
  void restoreWorkflowSessions();
  refreshResultsExplorer();
  void refreshInlineSignalsForActiveEditor();
}

/**
 * Extension deactivation hook.
 *
 * @returns {void}
 */
async function deactivate() {
  inlineRiskDiagnostics?.clear?.();
  clearInlineDecorations(vscode.window.activeTextEditor || null);
  inlineSignalCache.clear();
  apiCapabilityCache.clear();
  const result = await operations.dispose();
  const pendingOwners = [...managedProcesses.values()].filter(entry => entry.cleanupUnconfirmed);
  if (pendingOwners.length) {
    result.ok = false;
    result.pendingOwners = pendingOwners.map(entry => ({ sessionId: entry.sessionId, repoRoot: entry.repoRoot }));
  }
  if (result.ok) managedProcesses.clear();
  else console.error('[PairOfCleats] Owned editor work did not finish shutdown:', result);
  taskObservations.clear();
  return result;
}

let outputChannel = null;
const workspaceWrites = new Map();
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
let inlineRiskDiagnostics = null;
let inlineRiskDecorationType = null;

function getOutputChannel() {
  if (!operations.isCurrent()) return { appendLine() {}, show() {}, clear() {} };
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
    resolveOperatorInvocation,
    getExtensionConfiguration,
    resolveExecutionMode,
    resolveRepoContext,
    resolvePassiveRepoContext,
    resolveRepoRelativePathSeed,
    resolveRiskExplainSeedContext,
    runOperatorCommand,
    executeOperatorWorkflow,
    runSavedSearchInvocation,
    executeSearchCommand,
    runSearch,
    runSelectionSearch,
    runSymbolSearch,
    runExplainSearch,
    provideDefinitionsAtPosition,
    provideReferencesAtPosition,
    provideDocumentSymbolsForDocument,
    provideCompletionItemsAtPosition,
    provideInlineHoverAtPosition,
    refreshInlineSignalsForActiveEditor,
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
    createRangeFromNavigationEntry,
    MANAGED_COMMAND_SPECS
  }
};
