import fsSync from 'node:fs';
import path from 'node:path';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';

const DEFAULT_MODULE_ARGS = Object.freeze(['list', '-m']);
const DEFAULT_MODULE_TIMEOUT_MS = 8000;

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
  return runWorkspaceCommandPreflight({
    ctx,
    cmd: command.cmd,
    args: command.args,
    timeoutMs: command.timeoutMs,
    reasonPrefix: 'go_workspace_module_probe',
    label: 'go workspace module'
  });
};
