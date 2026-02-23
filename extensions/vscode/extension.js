const vscode = require('vscode');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
 * Resolve a configured path relative to repo root when not absolute.
 *
 * @param {string|null} repoRoot
 * @param {string} rawPath
 * @returns {string}
 */
function resolveConfigPath(repoRoot, rawPath) {
  if (!rawPath) return '';
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
  if (repoRoot) return path.join(repoRoot, rawPath);
  return rawPath;
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
function resolveRepoRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return null;
  const workspacePath = folders[0].uri.fsPath;
  if (!VSCODE_REPO_WALKUP) return workspacePath;
  return findRepoRoot(workspacePath) || workspacePath;
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
    const resolvedPath = resolveConfigPath(repoRoot, configuredPath);
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      if (resolvedPath.toLowerCase().endsWith(CLI_JS_EXTENSION)) {
        return { command: process.execPath, argsPrefix: [resolvedPath, ...extraArgs] };
      }
      return { command: resolvedPath, argsPrefix: extraArgs };
    }
  }

  if (repoRoot) {
    const localCli = path.join(repoRoot, ...CLI_REPO_ENTRYPOINT_PARTS);
    if (fs.existsSync(localCli)) {
      return { command: process.execPath, argsPrefix: [localCli] };
    }
  }

  return { command: CLI_DEFAULT_COMMAND, argsPrefix: extraArgs };
}

/**
 * Build search CLI args from extension settings and query input.
 *
 * @param {string} query
 * @param {string|null} repoRoot
 * @param {import('vscode').WorkspaceConfiguration} config
 * @returns {string[]}
 */
function buildArgs(query, repoRoot, config) {
  const mode = String(config.get(VSCODE_SETTINGS.modeKey) || 'both');
  const backend = String(config.get(VSCODE_SETTINGS.backendKey) || '').trim();
  const annEnabled = config.get(VSCODE_SETTINGS.annKey) !== false;
  const maxResults = Number.isFinite(Number(config.get(VSCODE_SETTINGS.maxResultsKey)))
    ? Math.max(1, Number(config.get(VSCODE_SETTINGS.maxResultsKey)))
    : 25;
  const extra = normalizeStringArray(config.get(VSCODE_SETTINGS.extraSearchArgsKey));

  const args = ['search', '--json', '--top', String(maxResults)];
  if (mode && mode !== 'both') args.push('--mode', mode);
  if (backend) args.push('--backend', backend);
  if (!annEnabled) args.push('--no-ann');
  if (repoRoot) args.push('--repo', repoRoot);
  args.push(...extra);
  args.push('--', query);
  return args;
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
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    vscode.window.showErrorMessage('PairOfCleats: open a workspace to search.');
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: 'PairOfCleats search query',
    placeHolder: 'e.g. auth token validation'
  });
  if (!query || !query.trim()) return;

  const config = getExtensionConfiguration();
  const { command, argsPrefix } = resolveCli(repoRoot, config);
  const args = [...argsPrefix, ...buildArgs(query.trim(), repoRoot, config)];
  const env = buildSpawnEnv(config);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'PairOfCleats search',
      cancellable: false
    },
    () => new Promise((resolve) => {
      cp.execFile(
        command,
        args,
        { cwd: repoRoot, env, maxBuffer: 20 * 1024 * 1024 },
        async (error, stdout, stderr) => {
          if (error) {
            const message = stderr || error.message;
            vscode.window.showErrorMessage(`PairOfCleats search failed: ${message}`);
            resolve();
            return;
          }

          let payload = null;
          try {
            payload = JSON.parse(stdout || '{}');
          } catch (err) {
            vscode.window.showErrorMessage(`PairOfCleats search returned invalid JSON: ${err.message}`);
            resolve();
            return;
          }

          const hits = [];
          const pushHits = (items, kind) => {
            if (!Array.isArray(items)) return;
            items.forEach((hit) => {
              if (!hit || !hit.file) return;
              hits.push({
                ...hit,
                section: kind
              });
            });
          };
          pushHits(payload.code, 'code');
          pushHits(payload.prose, 'prose');
          pushHits(payload.records, 'records');

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
          const filePath = path.isAbsolute(selected.file)
            ? selected.file
            : path.join(repoRoot, selected.file);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
          const editor = await vscode.window.showTextDocument(document, { preview: true });
          if (Number.isFinite(selected.startLine) && selected.startLine > 0) {
            const line = Math.max(0, Number(selected.startLine) - 1);
            const pos = new vscode.Position(line, 0);
            const range = new vscode.Range(pos, pos);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          }

          resolve();
        }
      );
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

module.exports = {
  activate,
  deactivate
};
