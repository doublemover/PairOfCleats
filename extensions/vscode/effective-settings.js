const MACHINE_KEYS = new Set(['cliPath', 'nodePath', 'cliArgs', 'env', 'apiServerUrl',
  'apiExecutionMode', 'apiToken', 'extraSearchArgs']);
const SECRET_KEY = /token|secret|password|credential|authorization|cookie|env|args/i;

function displayValue(key, value) {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (key === 'apiServerUrl' && value) {
    try {
      const url = new URL(String(value));
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.toString();
    } catch { return '[invalid service endpoint; inspect User Settings]'; }
  }
  return value;
}

/** Snapshot values once per invocation. Runtime and destination authority remain
 * in User Settings even when presentation and query options are resource scoped. */
function snapshotConfiguration(configuration, keys) {
  const values = new Map();
  const inspections = new Map();
  const evidence = [];
  for (const key of keys) {
    const inspected = JSON.parse(JSON.stringify(configuration.inspect?.(key) || {}));
    inspections.set(key, inspected);
    const machine = MACHINE_KEYS.has(key);
    const value = machine
      ? (inspected.globalValue ?? inspected.defaultValue)
      : configuration.get(key);
    const source = machine ? (inspected.globalValue !== undefined ? 'user' : 'default')
      : inspected.workspaceFolderValue !== undefined ? 'folder'
        : inspected.workspaceValue !== undefined ? 'workspace'
          : inspected.globalValue !== undefined ? 'user' : 'default';
    values.set(key, value == null ? value : JSON.parse(JSON.stringify(value)));
    evidence.push({ key, value: displayValue(key, values.get(key)), source,
      ignoredWorkspaceValue: machine && (inspected.workspaceValue !== undefined
        || inspected.workspaceFolderValue !== undefined) });
  }
  return Object.freeze({
    get(key, fallback) { return values.has(key) ? values.get(key) ?? fallback : fallback; },
    inspect(key) { return inspections.get(key); },
    evidence: Object.freeze(evidence)
  });
}

function renderEffectiveSettings({ snapshot, repoContext, remoteName = '', cli = null, api = null }) {
  return ['PairOfCleats effective settings', '', `Repository: ${repoContext.repoRoot}`,
    `Editor URI: ${repoContext.repoUri?.toString?.() || ''}`,
    `Execution host: ${remoteName || 'local workspace host'}`,
    `CLI: ${cli?.command || 'unresolved'}`,
    `Transport policy: ${api?.mode || 'cli'}`,
    ...(api?.error ? [`Correction: ${api.error}`] : []),
    'Credentials and environment values are redacted.', '',
    ...snapshot.evidence.map(row => `${row.key} = ${JSON.stringify(row.value)} [${row.source}]${
      row.ignoredWorkspaceValue ? ' (workspace override ignored; use User Settings)' : ''}`), '',
    'Use Settings > PairOfCleats for this folder, User Settings for runtime/connection authority,',
    'and PairOfCleats: Doctor / Index Validate for installation and index diagnostics.'].join('\n');
}

module.exports = { MACHINE_KEYS, snapshotConfiguration, renderEffectiveSettings };
