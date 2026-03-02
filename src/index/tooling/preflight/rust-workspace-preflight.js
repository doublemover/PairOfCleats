import fsSync from 'node:fs';
import path from 'node:path';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';

const DEFAULT_METADATA_ARGS = Object.freeze(['metadata', '--no-deps', '--format-version', '1']);
const DEFAULT_METADATA_TIMEOUT_MS = 12000;

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
  return runWorkspaceCommandPreflight({
    ctx,
    cmd: command.cmd,
    args: command.args,
    timeoutMs: command.timeoutMs,
    reasonPrefix: 'rust_workspace_metadata',
    label: 'rust workspace metadata'
  });
};
