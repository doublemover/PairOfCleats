import fsSync from 'node:fs';
import path from 'node:path';
import {
  isSyncCommandTimedOut,
  runSyncCommandWithTimeout,
  toSyncCommandExitCode
} from '../../../shared/subprocess/sync-command.js';

const DEFAULT_METADATA_ARGS = Object.freeze(['metadata', '--no-deps', '--format-version', '1']);
const DEFAULT_METADATA_TIMEOUT_MS = 12000;

const summarize = (value, maxChars = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

const normalizeRustLanguages = (server) => {
  if (!Array.isArray(server?.languages)) return [];
  return server.languages
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
};

const isRustWorkspacePreflightServer = (server) => {
  const id = String(server?.id || '').trim().toLowerCase();
  const cmd = path.basename(String(server?.cmd || '').trim().toLowerCase() || '');
  const languages = normalizeRustLanguages(server);
  return id === 'rust-analyzer' || cmd === 'rust-analyzer' || languages.includes('rust');
};

const resolveMetadataCommand = (server) => {
  const cmd = String(server?.rustWorkspaceMetadataCmd || 'cargo').trim() || 'cargo';
  const args = Array.isArray(server?.rustWorkspaceMetadataArgs) && server.rustWorkspaceMetadataArgs.length
    ? server.rustWorkspaceMetadataArgs.map((entry) => String(entry))
    : Array.from(DEFAULT_METADATA_ARGS);
  const timeoutRaw = Number(server?.rustWorkspaceMetadataTimeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.floor(timeoutRaw))
    : DEFAULT_METADATA_TIMEOUT_MS;
  return { cmd, args, timeoutMs };
};

export const resolveRustWorkspaceMetadataPreflight = ({ ctx, server }) => {
  if (!isRustWorkspacePreflightServer(server)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const cargoTomlPath = path.join(repoRoot, 'Cargo.toml');
  const cargoLockPath = path.join(repoRoot, 'Cargo.lock');
  if (!fsSync.existsSync(cargoTomlPath) && !fsSync.existsSync(cargoLockPath)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  const command = resolveMetadataCommand(server);
  const result = runSyncCommandWithTimeout(command.cmd, command.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: command.timeoutMs,
    killTree: true
  });

  if (isSyncCommandTimedOut(result)) {
    const message = `rust workspace metadata probe timed out after ${command.timeoutMs}ms.`;
    return {
      state: 'degraded',
      reasonCode: 'rust_workspace_metadata_timeout',
      message,
      check: {
        name: 'rust_workspace_metadata_timeout',
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
    const message = `rust workspace metadata probe error: ${summarize(result.error?.message || result.error) || 'unknown error'}`;
    return {
      state: 'degraded',
      reasonCode: 'rust_workspace_metadata_error',
      message,
      check: {
        name: 'rust_workspace_metadata_error',
        status: 'warn',
        message
      },
      checks: []
    };
  }

  const summary = summarize(result?.stderr || result?.stdout);
  const message = summary
    ? `rust workspace metadata probe failed (exit ${exitCode}): ${summary}`
    : `rust workspace metadata probe failed (exit ${exitCode}).`;
  return {
    state: 'degraded',
    reasonCode: 'rust_workspace_metadata_failed',
    message,
    check: {
      name: 'rust_workspace_metadata_failed',
      status: 'warn',
      message
    },
    checks: []
  };
};
