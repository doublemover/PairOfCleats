import fsSync from 'node:fs';
import path from 'node:path';
import {
  isSyncCommandTimedOut,
  runSyncCommandWithTimeout,
  toSyncCommandExitCode
} from '../../../shared/subprocess/sync-command.js';

const DEFAULT_MODULE_ARGS = Object.freeze(['list', '-m']);
const DEFAULT_MODULE_TIMEOUT_MS = 8000;

const summarize = (value, maxChars = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

const normalizeGoLanguages = (server) => {
  if (!Array.isArray(server?.languages)) return [];
  return server.languages
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
};

const isGoWorkspacePreflightServer = (server) => {
  const id = String(server?.id || '').trim().toLowerCase();
  const cmd = path.basename(String(server?.cmd || '').trim().toLowerCase() || '');
  const languages = normalizeGoLanguages(server);
  return id === 'gopls' || cmd === 'gopls' || languages.includes('go');
};

const resolveModuleCommand = (server) => {
  const cmd = String(server?.goWorkspaceModuleCmd || 'go').trim() || 'go';
  const args = Array.isArray(server?.goWorkspaceModuleArgs) && server.goWorkspaceModuleArgs.length
    ? server.goWorkspaceModuleArgs.map((entry) => String(entry))
    : Array.from(DEFAULT_MODULE_ARGS);
  const timeoutRaw = Number(server?.goWorkspaceModuleTimeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.floor(timeoutRaw))
    : DEFAULT_MODULE_TIMEOUT_MS;
  return { cmd, args, timeoutMs };
};

export const resolveGoWorkspaceModulePreflight = ({ ctx, server }) => {
  if (!isGoWorkspacePreflightServer(server)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const goModPath = path.join(repoRoot, 'go.mod');
  const goWorkPath = path.join(repoRoot, 'go.work');
  if (!fsSync.existsSync(goModPath) && !fsSync.existsSync(goWorkPath)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  const command = resolveModuleCommand(server);
  const result = runSyncCommandWithTimeout(command.cmd, command.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: command.timeoutMs,
    killTree: true
  });

  if (isSyncCommandTimedOut(result)) {
    const message = `go workspace module probe timed out after ${command.timeoutMs}ms.`;
    return {
      state: 'degraded',
      reasonCode: 'go_workspace_module_probe_timeout',
      message,
      check: {
        name: 'go_workspace_module_probe_timeout',
        status: 'warn',
        message
      },
      checks: []
    };
  }

  const exitCode = toSyncCommandExitCode(result);
  if (exitCode === 0) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  if (result?.error) {
    const message = `go workspace module probe error: ${summarize(result.error?.message || result.error) || 'unknown error'}`;
    return {
      state: 'degraded',
      reasonCode: 'go_workspace_module_probe_error',
      message,
      check: {
        name: 'go_workspace_module_probe_error',
        status: 'warn',
        message
      },
      checks: []
    };
  }

  const summary = summarize(result?.stderr || result?.stdout);
  const message = summary
    ? `go workspace module probe failed (exit ${exitCode}): ${summary}`
    : `go workspace module probe failed (exit ${exitCode}).`;
  return {
    state: 'degraded',
    reasonCode: 'go_workspace_module_probe_failed',
    message,
    check: {
      name: 'go_workspace_module_probe_failed',
      status: 'warn',
      message
    },
    checks: []
  };
};
