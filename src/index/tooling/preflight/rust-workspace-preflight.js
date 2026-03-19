import fsSync from 'node:fs';
import path from 'node:path';
import {
  buildRustWorkspacePartitionKey,
  buildSelectedRustWorkspacePartitions,
  classifyRustWorkspaceManifest
} from '../rust-workspace-partitioning.js';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';

const DEFAULT_METADATA_ARGS = Object.freeze(['metadata', '--no-deps', '--format-version', '1']);
const DEFAULT_METADATA_TIMEOUT_MS = 12000;

const toPartitionScopedCheck = (check, partition) => {
  if (!check || typeof check !== 'object') return null;
  const rootRel = String(partition?.rootRel || '.').trim() || '.';
  const message = String(check.message || '').trim();
  return {
    ...check,
    message: message ? `${message} [partition=${rootRel}]` : `[partition=${rootRel}]`
  };
};

const formatPartitionList = (partitions) => (
  (Array.isArray(partitions) ? partitions : [])
    .map((entry) => String(entry?.rootRel || '.'))
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
);

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

const selectRustDocumentPaths = (documents) => (
  Array.isArray(documents)
    ? documents
      .filter((doc) => {
        const languageId = String(doc?.languageId || '').trim().toLowerCase();
        if (languageId === 'rust') return true;
        return path.extname(String(doc?.virtualPath || doc?.path || '')).toLowerCase() === '.rs';
      })
      .map((doc) => doc?.virtualPath || doc?.path || '')
      .filter(Boolean)
    : []
);

const classifyRustProbeFailureCheck = (partitionResult, partition) => {
  const message = String(partitionResult?.message || '').trim();
  const lower = message.toLowerCase();
  const partitionLabel = String(partition?.rootRel || '.').trim() || '.';
  if (
    lower.includes('rustlib')
    || lower.includes('toolchain')
    || lower.includes('sysroot')
    || lower.includes('/library/')
    || lower.includes('\\library\\')
  ) {
    return {
      name: 'rust_workspace_toolchain_metadata_noise',
      status: 'warn',
      message: `rust workspace probe hit toolchain or stdlib metadata noise for partition "${partitionLabel}". ${message}`.trim()
    };
  }
  if (
    lower.includes('manifest')
    || lower.includes('cargo.toml')
    || lower.includes('workspace root')
    || lower.includes('fetchworkspaceerror')
    || lower.includes('locate-project')
    || lower.includes('cargo metadata')
  ) {
    return {
      name: 'rust_workspace_repo_invalidity',
      status: 'warn',
      message: `rust workspace probe found repo-local workspace invalidity for partition "${partitionLabel}". ${message}`.trim()
    };
  }
  return {
    name: 'rust_workspace_probe_runtime_problem',
    status: 'warn',
    message: `rust workspace probe failed for partition "${partitionLabel}" due to a runtime or tooling problem. ${message}`.trim()
  };
};

const toDiskCandidateFromSelectedPath = (repoRoot, selectedPath) => {
  const normalized = String(selectedPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/#.*$/u, '')
    .replace(/^\.poc-vfs\//u, '')
    .replace(/^file:\/+/u, '');
  if (!normalized) return null;
  return path.join(String(repoRoot || process.cwd()), normalized);
};

const partitionHasOnDiskRustSource = (repoRoot, partition) => (
  (Array.isArray(partition?.selectedPaths) ? partition.selectedPaths : [])
    .map((selectedPath) => toDiskCandidateFromSelectedPath(repoRoot, selectedPath))
    .filter(Boolean)
    .some((candidatePath) => fsSync.existsSync(candidatePath))
);

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
  const selectedDocuments = Array.isArray(documents) ? documents : (Array.isArray(ctx?.documents) ? ctx.documents : []);
  const rustPaths = selectRustDocumentPaths(selectedDocuments);
  if (selectedDocuments.length > 0 && rustPaths.length <= 0) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const cargoTomlPath = path.join(repoRoot, 'Cargo.toml');
  const cargoLockPath = path.join(repoRoot, 'Cargo.lock');
  const selectedWorkspace = buildSelectedRustWorkspacePartitions(repoRoot, rustPaths);
  let partitions = selectedWorkspace.partitions;
  const repoHasWorkspaceMarker = fsSync.existsSync(cargoTomlPath) || fsSync.existsSync(cargoLockPath);

  if (!partitions.length && repoHasWorkspaceMarker) {
    const classification = classifyRustWorkspaceManifest({
      repoRoot,
      rootDir: repoRoot,
      rootRel: '.'
    });
    partitions = [{
      rootRel: '.',
      rootDir: repoRoot,
      markerName: fsSync.existsSync(cargoTomlPath) ? 'Cargo.toml' : 'Cargo.lock',
      workspaceKey: buildRustWorkspacePartitionKey({
        repoRoot,
        rootRel: '.',
        markerName: fsSync.existsSync(cargoTomlPath) ? 'Cargo.toml' : 'Cargo.lock',
        role: classification.role
      }),
      role: classification.role,
      validSessionRoot: classification.validSessionRoot === true,
      classificationReasonCode: classification.reasonCode || null,
      classificationMessage: classification.message || '',
      cargoTomlPath: classification.cargoTomlPath,
      cargoLockPath: classification.cargoLockPath,
      exampleLike: classification.exampleLike === true,
      selectedPaths: rustPaths.slice()
    }];
  }

  if (rustPaths.length > 0 && !partitions.length) {
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
  if (!partitions.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  const command = resolveMetadataCommand(server);
  const checks = [];
  const readyPartitions = [];
  const blockedPartitions = [];
  let cachedPartitionCount = 0;

  for (const partition of partitions) {
    if (partition.validSessionRoot !== true) {
      const invalidCheck = toPartitionScopedCheck({
        name: partition.classificationReasonCode || 'rust_workspace_invalid_root',
        status: 'warn',
        message: partition.classificationMessage || 'rust workspace partition is not a valid session root.'
      }, partition);
      if (invalidCheck) checks.push(invalidCheck);
      blockedPartitions.push({
        partition,
        result: {
          state: 'blocked',
          reasonCode: partition.classificationReasonCode || 'rust_workspace_invalid_root',
          message: partition.classificationMessage || 'rust workspace partition is not a valid session root.'
        }
      });
      continue;
    }

    if (!partitionHasOnDiskRustSource(repoRoot, partition)) {
      const manifestOnlyCheck = toPartitionScopedCheck({
        name: 'rust_workspace_manifest_only_preflight',
        status: 'info',
        message: 'rust workspace preflight used manifest-only validation because selected Rust documents are virtual and do not exist on disk.'
      }, partition);
      if (manifestOnlyCheck) checks.push(manifestOnlyCheck);
      readyPartitions.push(partition);
      continue;
    }

    const workspaceRoot = partition.rootDir;
    const workspaceCargoTomlPath = path.join(workspaceRoot, 'Cargo.toml');
    const workspaceCargoLockPath = path.join(workspaceRoot, 'Cargo.lock');
    const workspaceCargoConfigTomlPath = path.join(workspaceRoot, '.cargo', 'config.toml');
    const workspaceCargoConfigPath = path.join(workspaceRoot, '.cargo', 'config');
    const metadataPreflight = await runWorkspaceCommandPreflight({
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
          workspaceRoot: partition.rootRel,
          workspaceKey: partition.workspaceKey,
          role: partition.role,
          command: command.cmd,
          args: command.args
        }
      }
    });
    if (metadataPreflight.cached === true) cachedPartitionCount += 1;
    if (metadataPreflight.check) {
      const scoped = toPartitionScopedCheck(metadataPreflight.check, partition);
      if (scoped) checks.push(scoped);
    }
    if (Array.isArray(metadataPreflight.checks)) {
      for (const check of metadataPreflight.checks) {
        const scoped = toPartitionScopedCheck(check, partition);
        if (scoped) checks.push(scoped);
      }
    }
    if (metadataPreflight.state === 'ready') {
      readyPartitions.push(partition);
      continue;
    }
    const classifiedFailure = toPartitionScopedCheck(
      classifyRustProbeFailureCheck(metadataPreflight, partition),
      partition
    );
    if (classifiedFailure) checks.push(classifiedFailure);
    blockedPartitions.push({
      partition,
      result: metadataPreflight
    });
  }

  const blockedWorkspaceKeys = blockedPartitions.map((entry) => entry.partition.workspaceKey);
  const blockedWorkspaceRoots = blockedPartitions.map((entry) => entry.partition.rootRel);
  const runnablePartitionCount = partitions.filter((entry) => entry.validSessionRoot === true).length;
  const cached = runnablePartitionCount > 0 && cachedPartitionCount === runnablePartitionCount;

  if (!readyPartitions.length && blockedPartitions.length) {
    const blockedMessage = `rust-analyzer blocked all selected workspace partitions (${formatPartitionList(blockedPartitions.map((entry) => entry.partition)) || 'none'}).`;
    return {
      state: 'blocked',
      reasonCode: 'rust_workspace_blocked_all_partitions',
      message: blockedMessage,
      check: {
        name: 'rust_workspace_blocked_all_partitions',
        status: 'warn',
        message: blockedMessage
      },
      checks,
      blockProvider: true,
      cached,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    };
  }

  if (selectedWorkspace.unmatchedPaths.length || blockedPartitions.length) {
    const message = `rust-analyzer achieved only partial repo coverage: ready=${readyPartitions.length}, blocked=${blockedPartitions.length}, unmatched=${selectedWorkspace.unmatchedPaths.length}.`;
    return {
      state: 'degraded',
      reasonCode: 'rust_workspace_partial_repo_coverage',
      message,
      check: {
        name: 'rust_workspace_partial_repo_coverage',
        status: 'warn',
        message
      },
      checks,
      cached,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    };
  }

  if (partitions.length > 1) {
    const sample = formatPartitionList(partitions);
    const suffix = partitions.length > 4 ? ` (+${partitions.length - 4} more)` : '';
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
      checks,
      cached
    };
  }

  return {
    state: 'ready',
    reasonCode: null,
    message: '',
    check: null,
    checks,
    cached
  };
};
