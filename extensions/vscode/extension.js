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
  const command = vscode.commands.registerCommand('pairofcleats.search', runSearch);
  context.subscriptions.push(command);
}

/**
 * Extension deactivation hook.
 *
 * @returns {void}
 */
function deactivate() {}

let outputChannel = null;

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
    runSearch
  }
};
