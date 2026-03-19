import fsSync from 'node:fs';
import path from 'node:path';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';
import { findWorkspaceMarkersNearPaths } from '../workspace-model.js';

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

export const resolveRustWorkspaceMetadataPreflight = async ({
  ctx,
  server,
  abortSignal = null,
  documents = null
}) => {
  if (!isRustWorkspacePreflightServer(server)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const selectedDocuments = Array.isArray(documents)
    ? documents
    : (Array.isArray(ctx?.documents) ? ctx.documents : []);
  const rustDocuments = selectedDocuments.filter((doc) => {
    const languageId = String(doc?.languageId || '').trim().toLowerCase();
    if (languageId === 'rust') return true;
    return path.extname(String(doc?.virtualPath || doc?.path || '')).toLowerCase() === '.rs';
  });
  if (selectedDocuments.length > 0 && rustDocuments.length <= 0) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const nearbyWorkspaces = findWorkspaceMarkersNearPaths(
    repoRoot,
    rustDocuments.map((doc) => doc?.virtualPath || doc?.path || '')
      .filter(Boolean),
    { exactNames: ['Cargo.toml', 'Cargo.lock'] }
  );
  const nearbyWorkspace = nearbyWorkspaces.length > 0
    ? nearbyWorkspaces[0]
    : {
      found: false,
      markerDirAbs: null,
      markerDirRel: null,
      markerPathAbs: null,
      markerName: null
    };
  const cargoTomlPath = path.join(repoRoot, 'Cargo.toml');
  const cargoLockPath = path.join(repoRoot, 'Cargo.lock');
  const cargoConfigTomlPath = path.join(repoRoot, '.cargo', 'config.toml');
  const cargoConfigPath = path.join(repoRoot, '.cargo', 'config');
  if (!nearbyWorkspace.found && !fsSync.existsSync(cargoTomlPath) && !fsSync.existsSync(cargoLockPath)) {
    const message = 'rust-analyzer workspace markers (Cargo.toml/Cargo.lock) not found near selected Rust documents.';
    return {
      state: 'blocked',
      reasonCode: 'rust_workspace_model_missing',
      message,
      check: {
        name: 'rust_workspace_model_missing',
        status: 'warn',
        message
      },
      checks: [],
      blockProvider: true
    };
  }
  if (nearbyWorkspaces.length > 1) {
    const sample = nearbyWorkspaces
      .map((entry) => String(entry?.markerDirRel || '.'))
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
    const suffix = nearbyWorkspaces.length > 4
      ? ` (+${nearbyWorkspaces.length - 4} more)`
      : '';
    const message = `rust workspace markers found in multiple selected roots (${sample}${suffix}); runtime will partition rust-analyzer sessions per workspace root.`;
    return {
      state: 'ready',
      reasonCode: 'rust_workspace_root_partitioned',
      message,
      check: {
        name: 'rust_workspace_root_partitioned',
        status: 'info',
        message
      },
      checks: []
    };
  }

  const command = resolveMetadataCommand(server);
  const workspaceRoot = nearbyWorkspace.found ? nearbyWorkspace.markerDirAbs : repoRoot;
  const workspaceCargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
  const workspaceCargoLockPath = path.join(workspaceRoot, 'Cargo.lock');
  const workspaceCargoConfigTomlPath = path.join(workspaceRoot, '.cargo', 'config.toml');
  const workspaceCargoConfigPath = path.join(workspaceRoot, '.cargo', 'config');
  return await runWorkspaceCommandPreflight({
    ctx,
    cwd: workspaceRoot,
    cmd: command.cmd,
    args: command.args,
    timeoutMs: command.timeoutMs,
    abortSignal,
    reasonPrefix: 'rust_workspace_metadata',
    label: 'rust workspace metadata',
    log: typeof ctx?.logger === 'function' ? ctx.logger : () => {},
    successCache: {
      repoRoot: workspaceRoot,
      cacheRoot: ctx?.cache?.dir || null,
      namespace: 'rust-workspace-metadata',
      watchedFiles: [
        workspaceCargoTomlPath,
        workspaceCargoLockPath,
        workspaceCargoConfigTomlPath,
        workspaceCargoConfigPath
      ],
      extra: {
        workspaceRoot: nearbyWorkspace.found ? nearbyWorkspace.markerDirRel : '.',
        command: command.cmd,
        args: command.args
      }
    }
  });
};
