import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCacheRoot } from '../../../shared/cache-roots.js';
import { resolveEnvPath } from '../../../shared/env-path.js';
import { readJsonFileSafe } from '../../../shared/files.js';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../../shared/locks/file-lock.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import { resolveWindowsCmdInvocation } from '../../../shared/subprocess/windows-cmd.js';
import { resolveToolingCommandProfile } from '../command-resolver.js';
import { splitPathEntries } from '../binary-utils.js';

const SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION = 2;
const SOURCEKIT_PACKAGE_PREFLIGHT_MARKER_FILENAME = 'sourcekit-package-preflight.json';
const SOURCEKIT_PACKAGE_PREFLIGHT_TIMEOUT_MS = 90 * 1000;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_WAIT_MS = 90 * 1000;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_POLL_MS = 250;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_STALE_MS = 10 * 60 * 1000;
const SOURCEKIT_LOCK_NAMESPACE_SUFFIX = path.join('locks', 'sourcekit');
const SOURCEKIT_PREFLIGHT_STATE = Object.freeze({
  READY: 'ready',
  BLOCKED_DEPENDENCY: 'blocked_dependency',
  BLOCKED_NETWORK: 'blocked_network',
  BLOCKED_MANIFEST: 'blocked_manifest',
  UNSUPPORTED_WORKSPACE: 'unsupported_workspace'
});
const SOURCEKIT_WORKSPACE_KIND = Object.freeze({
  PACKAGE_MANAGED: 'package_managed_workspace',
  MIXED: 'mixed_workspace',
  XCODE: 'xcode_workspace',
  NONPACKAGE: 'nonpackage_workspace',
  MALFORMED: 'malformed_workspace'
});

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const resolveSpawnCommandForExec = (cmd, args) => {
  if (!shouldUseShell(cmd)) {
    return {
      command: cmd,
      args: Array.isArray(args) ? args : []
    };
  }
  return resolveWindowsCmdInvocation(cmd, args);
};

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asFiniteInteger = (value) => {
  const parsed = asFiniteNumber(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const readUtf8IfExists = async (targetPath) => {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

const summarizeSubprocessOutput = (value, maxChars = 240) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
};

const readStatSignature = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return `${filePath}:${Number(stat?.size) || 0}:${Number(stat?.mtimeMs) || 0}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return `${filePath}:missing`;
    return `${filePath}:error`;
  }
};

const canRunCommand = (cmd, args = ['--help']) => {
  try {
    const profile = resolveToolingCommandProfile({
      providerId: 'sourcekit',
      cmd,
      args: Array.isArray(args) ? args : [],
      repoRoot: process.cwd(),
      toolingConfig: {}
    });
    return profile?.probe?.ok === true;
  } catch {
    return false;
  }
};

const resolveCommandCandidates = (cmd) => {
  const output = [];
  const seen = new Set();
  const add = (candidate) => {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  };

  const pathEntries = splitPathEntries(resolveEnvPath(process.env));
  const lowered = String(cmd || '').toLowerCase();
  const hasExt = /\.(exe|cmd|bat)$/i.test(lowered);

  if (path.isAbsolute(cmd)) {
    add(cmd);
    if (process.platform === 'win32' && !hasExt) {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        add(`${cmd}${ext}`);
      }
    }
  } else if (process.platform === 'win32' && hasExt) {
    for (const dir of pathEntries) {
      add(path.join(dir, cmd));
    }
  } else if (process.platform === 'win32') {
    for (const dir of pathEntries) {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        add(path.join(dir, `${cmd}${ext}`));
      }
    }
  } else {
    for (const dir of pathEntries) {
      add(path.join(dir, cmd));
    }
  }

  add(cmd);
  return output;
};

const resolveCommand = (cmd) => {
  const candidates = resolveCommandCandidates(cmd);
  for (const candidate of candidates) {
    if (canRunCommand(candidate, ['--version'])) return candidate;
  }
  return cmd;
};

const acquireHostSourcekitLock = async ({
  lockPath,
  waitMs = SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_WAIT_MS,
  pollMs = SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_POLL_MS,
  staleMs = SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_STALE_MS,
  signal = null
}) => {
  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    signal,
    metadata: { scope: 'sourcekit-preflight' },
    forceStaleCleanup: true
  });
  if (!lock) return null;
  return lock;
};

/**
 * Determine whether SwiftPM dependency resolution should run before sourcekit.
 *
 * @param {{repoRoot:string}} input
 * @returns {Promise<{
 *   required:boolean,
 *   reason:string,
 *   packageManifestPath:string,
 *   packageResolvedPath:string,
 *   fingerprint:string|null
 * }>}
 */
const classifySourcekitWorkspace = async ({ repoRoot }) => {
  const startedAt = Date.now();
  const packageManifestPath = path.join(repoRoot, 'Package.swift');
  const packageResolvedPath = path.join(repoRoot, 'Package.resolved');
  const rootEntries = await fs.readdir(repoRoot, { withFileTypes: true }).catch(() => []);
  const xcodeMarkers = rootEntries
    .filter((entry) => (
      entry?.isDirectory?.()
      && (
        String(entry.name || '').toLowerCase().endsWith('.xcodeproj')
        || String(entry.name || '').toLowerCase().endsWith('.xcworkspace')
      )
    ))
    .map((entry) => String(entry.name || ''))
    .sort((left, right) => left.localeCompare(right));
  let packageManifest = null;
  let manifestReadError = null;
  try {
    packageManifest = await readUtf8IfExists(packageManifestPath);
  } catch (error) {
    manifestReadError = error;
  }
  if (manifestReadError) {
    const fingerprint = crypto.createHash('sha1')
      .update(`schema:${SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION}`)
      .update(await readStatSignature(packageManifestPath))
      .digest('hex');
    return {
      workspaceKind: SOURCEKIT_WORKSPACE_KIND.MALFORMED,
      dependencyResolutionRequired: false,
      dependencyState: 'not_applicable',
      preflightState: SOURCEKIT_PREFLIGHT_STATE.BLOCKED_MANIFEST,
      reasonCode: 'sourcekit_blocked_manifest_unreadable',
      message: `Package.swift is unreadable: ${manifestReadError.message || 'read failed'}`,
      packageManifestPath,
      packageResolvedPath,
      xcodeMarkers,
      fingerprint,
      classificationDurationMs: Math.max(0, Date.now() - startedAt)
    };
  }
  if (typeof packageManifest !== 'string') {
    const workspaceKind = xcodeMarkers.length > 0
      ? SOURCEKIT_WORKSPACE_KIND.XCODE
      : SOURCEKIT_WORKSPACE_KIND.NONPACKAGE;
    const fingerprint = crypto.createHash('sha1')
      .update(`schema:${SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION}`)
      .update(`workspace:${workspaceKind}`)
      .update(`markers:${JSON.stringify(xcodeMarkers)}`)
      .digest('hex');
    return {
      workspaceKind,
      dependencyResolutionRequired: false,
      dependencyState: 'not_applicable',
      preflightState: SOURCEKIT_PREFLIGHT_STATE.READY,
      reasonCode: workspaceKind === SOURCEKIT_WORKSPACE_KIND.XCODE
        ? 'sourcekit_nonpackage_xcode_workspace'
        : 'sourcekit_nonpackage_workspace',
      message: '',
      packageManifestPath,
      packageResolvedPath,
      xcodeMarkers,
      fingerprint,
      classificationDurationMs: Math.max(0, Date.now() - startedAt)
    };
  }
  const hasPackageDependencies = /\.package\s*\(/u.test(packageManifest);
  const packageResolved = await readUtf8IfExists(packageResolvedPath);
  const workspaceKind = xcodeMarkers.length > 0
    ? SOURCEKIT_WORKSPACE_KIND.MIXED
    : SOURCEKIT_WORKSPACE_KIND.PACKAGE_MANAGED;
  const fingerprintHash = crypto.createHash('sha1');
  fingerprintHash.update(`schema:${SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION}`);
  fingerprintHash.update(`workspace:${workspaceKind}`);
  fingerprintHash.update(`manifest:${packageManifest}`);
  fingerprintHash.update(`resolved:${packageResolved || '<missing>'}`);
  fingerprintHash.update(`markers:${JSON.stringify(xcodeMarkers)}`);
  const dependencyResolutionRequired = hasPackageDependencies;
  const dependencyState = hasPackageDependencies ? 'required' : 'not_needed';
  return {
    workspaceKind,
    dependencyResolutionRequired,
    dependencyState,
    preflightState: SOURCEKIT_PREFLIGHT_STATE.READY,
    reasonCode: hasPackageDependencies
      ? 'sourcekit_swiftpm_dependencies_detected'
      : 'sourcekit_package_workspace_no_dependencies',
    message: '',
    packageManifestPath,
    packageResolvedPath,
    xcodeMarkers,
    fingerprint: fingerprintHash.digest('hex'),
    classificationDurationMs: Math.max(0, Date.now() - startedAt)
  };
};

/**
 * Build a repo-scoped sourcekit lock path with stable hashing.
 *
 * @param {string} repoRoot
 * @param {string} suffix
 * @returns {string}
 */
export const buildSourcekitRepoScopedLockPath = (repoRoot, suffix) => {
  const lockNamespace = path.join(getCacheRoot(), SOURCEKIT_LOCK_NAMESPACE_SUFFIX);
  const hash = crypto
    .createHash('sha1')
    .update(path.resolve(String(repoRoot || '')).toLowerCase())
    .digest('hex');
  return path.join(lockNamespace, `${suffix}-${hash}.lock`);
};

export const resolveSourcekitPreflightLockPath = (repoRoot) => (
  buildSourcekitRepoScopedLockPath(repoRoot, 'sourcekit-package-preflight')
);

const readSourcekitPreflightMarker = async (markerPath) => {
  const parsed = await readJsonFileSafe(markerPath, {
    fallback: null,
    maxBytes: 64 * 1024
  });
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.schemaVersion !== SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION) return null;
  return parsed;
};

const writeSourcekitPreflightMarker = async ({ markerPath, fingerprint, swiftCmd, durationMs }) => {
  const payload = {
    schemaVersion: SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION,
    completedAt: new Date().toISOString(),
    fingerprint,
    swiftCmd: String(swiftCmd || ''),
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : null
  };
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await atomicWriteJson(markerPath, payload, {
    spaces: 0,
    newline: false
  });
};

const resolveSourcekitPreflightMarkerPath = ({
  repoRoot,
  cacheRoot = null
}) => {
  if (typeof cacheRoot === 'string' && cacheRoot.trim()) {
    const repoHash = crypto
      .createHash('sha1')
      .update(path.resolve(repoRoot || '').toLowerCase())
      .digest('hex');
    return path.join(
      path.resolve(cacheRoot),
      'tooling',
      'sourcekit-preflight',
      repoHash,
      SOURCEKIT_PACKAGE_PREFLIGHT_MARKER_FILENAME
    );
  }
  return path.join(
    repoRoot,
    '.build',
    'pairofcleats',
    SOURCEKIT_PACKAGE_PREFLIGHT_MARKER_FILENAME
  );
};

const runSourcekitPackagePreflight = async ({
  repoRoot,
  swiftCmd,
  timeoutMs,
  signal = null
}) => {
  const startedAt = Date.now();
  const resolvedCommand = resolveSpawnCommandForExec(swiftCmd, ['package', 'resolve']);
  try {
    const result = await spawnSubprocess(resolvedCommand.command, resolvedCommand.args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(resolvedCommand.env || {}),
        GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || '0'
      },
      timeoutMs,
      killTree: true,
      detached: process.platform !== 'win32',
      captureStdout: true,
      captureStderr: true,
      outputMode: 'string',
      maxOutputBytes: 48 * 1024,
      rejectOnNonZeroExit: false,
      signal,
      name: 'sourcekit-package-resolve'
    });
    const durationMs = Date.now() - startedAt;
    if (result.exitCode === 0) {
      return {
        ok: true,
        timeout: false,
        durationMs,
        message: ''
      };
    }
    const summary = summarizeSubprocessOutput(result.stderr || result.stdout);
    return {
      ok: false,
      timeout: false,
      durationMs,
      message: summary || `swift package resolve failed with exit code ${result.exitCode ?? 'unknown'}`
    };
  } catch (err) {
    if (err?.code === 'ABORT_ERR') throw err;
    const durationMs = Date.now() - startedAt;
    const timeout = err?.code === 'SUBPROCESS_TIMEOUT';
    const summary = summarizeSubprocessOutput(
      err?.result?.stderr || err?.result?.stdout || err?.message || err
    );
    return {
      ok: false,
      timeout,
      durationMs,
      message: summary || (timeout ? 'swift package resolve timed out' : 'swift package resolve failed')
    };
  }
};

const classifyPreflightFailure = (message, timeout = false) => {
  const lowered = String(message || '').toLowerCase();
  if (timeout) {
    return {
      preflightState: SOURCEKIT_PREFLIGHT_STATE.BLOCKED_DEPENDENCY,
      reasonCode: 'sourcekit_blocked_dependency_timeout'
    };
  }
  if (
    lowered.includes('package.swift')
    || lowered.includes('manifest')
    || lowered.includes('package description')
  ) {
    return {
      preflightState: SOURCEKIT_PREFLIGHT_STATE.BLOCKED_MANIFEST,
      reasonCode: 'sourcekit_blocked_manifest'
    };
  }
  if (
    lowered.includes('timed out')
    || lowered.includes('could not resolve host')
    || lowered.includes('network')
    || lowered.includes('connection')
    || lowered.includes('repository not found')
    || lowered.includes('authentication failed')
  ) {
    return {
      preflightState: SOURCEKIT_PREFLIGHT_STATE.BLOCKED_NETWORK,
      reasonCode: 'sourcekit_blocked_network'
    };
  }
  return {
    preflightState: SOURCEKIT_PREFLIGHT_STATE.BLOCKED_DEPENDENCY,
    reasonCode: 'sourcekit_blocked_dependency'
  };
};

const buildPreflightCheck = ({
  name,
  message,
  reasonCode,
  workspaceKind,
  preflightState,
  timeout = false
} = {}) => ({
  name,
  status: 'warn',
  message,
  reasonCode: String(reasonCode || '').trim() || null,
  workspaceKind: String(workspaceKind || '').trim() || null,
  preflightState: String(preflightState || '').trim() || null,
  timeout: timeout === true
});

/**
 * Ensure SwiftPM dependency resolution side effects are completed before
 * sourcekit begins LSP work for Swift repos.
 *
 * @param {{
 *   repoRoot:string,
 *   log:(line:string)=>void,
 *   signal?:AbortSignal|null,
 *   sourcekitConfig?:Record<string,unknown>,
 *   cacheRoot?:string|null,
 *   timeoutMs?:number|null
 * }} input
 * @returns {Promise<{blockSourcekit:boolean,check:object|null}>}
 */
export const ensureSourcekitPackageResolutionPreflight = async ({
  repoRoot,
  log,
  signal = null,
  sourcekitConfig = {},
  cacheRoot = null,
  timeoutMs = null
}) => {
  const failClosed = sourcekitConfig?.preflightFailOpen !== true;
  try {
    throwIfAborted(signal);
    const workspace = await classifySourcekitWorkspace({ repoRoot });
    const markerPath = resolveSourcekitPreflightMarkerPath({
      repoRoot,
      cacheRoot
    });
    const marker = await readSourcekitPreflightMarker(markerPath);
    if (marker?.fingerprint === workspace.fingerprint) {
      log('[tooling] sourcekit package preflight cache hit.');
      const cachedBlocked = marker?.preflightState && marker.preflightState !== SOURCEKIT_PREFLIGHT_STATE.READY;
      const cachedReasonCode = String(marker?.reasonCode || workspace.reasonCode || '').trim() || null;
      return {
        blockSourcekit: cachedBlocked && failClosed,
        state: cachedBlocked ? (failClosed ? 'blocked' : 'degraded') : 'ready',
        reasonCode: cachedReasonCode,
        message: String(marker?.message || workspace.message || ''),
        cached: true,
        markerPath,
        workspaceKind: marker?.workspaceKind || workspace.workspaceKind,
        dependencyState: marker?.dependencyState || workspace.dependencyState,
        preflightState: marker?.preflightState || workspace.preflightState,
        classificationDurationMs: Number(marker?.classificationDurationMs) || workspace.classificationDurationMs || 0,
        resolveDurationMs: Number(marker?.resolveDurationMs) || 0,
        check: cachedBlocked
          ? buildPreflightCheck({
            name: 'sourcekit_package_preflight_failed',
            message: String(marker?.message || workspace.message || 'sourcekit package preflight blocked'),
            reasonCode: cachedReasonCode,
            workspaceKind: marker?.workspaceKind || workspace.workspaceKind,
            preflightState: marker?.preflightState || workspace.preflightState,
            timeout: marker?.timeout === true
          })
          : null
      };
    }
    if (workspace.preflightState !== SOURCEKIT_PREFLIGHT_STATE.READY) {
      const message = workspace.message || 'sourcekit workspace preflight blocked';
      const preflightState = workspace.preflightState;
      const reasonCode = workspace.reasonCode;
      const record = {
        schemaVersion: SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION,
        completedAt: new Date().toISOString(),
        fingerprint: workspace.fingerprint,
        swiftCmd: '',
        durationMs: 0,
        classificationDurationMs: workspace.classificationDurationMs,
        resolveDurationMs: 0,
        workspaceKind: workspace.workspaceKind,
        dependencyState: workspace.dependencyState,
        preflightState,
        reasonCode,
        message,
        timeout: false
      };
      await fs.mkdir(path.dirname(markerPath), { recursive: true });
      await atomicWriteJson(markerPath, record, {
        spaces: 0,
        newline: false
      });
      return {
        blockSourcekit: failClosed,
        state: failClosed ? 'blocked' : 'degraded',
        reasonCode,
        message,
        markerPath,
        workspaceKind: workspace.workspaceKind,
        dependencyState: workspace.dependencyState,
        preflightState,
        classificationDurationMs: workspace.classificationDurationMs,
        resolveDurationMs: 0,
        check: buildPreflightCheck({
          name: 'sourcekit_package_preflight_failed',
          message,
          reasonCode,
          workspaceKind: workspace.workspaceKind,
          preflightState
        })
      };
    }
    if (workspace.dependencyResolutionRequired !== true) {
      return {
        blockSourcekit: false,
        state: 'ready',
        reasonCode: workspace.reasonCode,
        message: '',
        cached: false,
        markerPath,
        workspaceKind: workspace.workspaceKind,
        dependencyState: workspace.dependencyState,
        preflightState: workspace.preflightState,
        classificationDurationMs: workspace.classificationDurationMs,
        resolveDurationMs: 0,
        check: null
      };
    }

    const resolvedSwiftCmd = resolveCommand('swift');
    if (!canRunCommand(resolvedSwiftCmd, ['--version'])) {
      const message = 'sourcekit package preflight skipped because `swift` command is unavailable.';
      const preflightState = SOURCEKIT_PREFLIGHT_STATE.BLOCKED_DEPENDENCY;
      const reasonCode = 'sourcekit_blocked_dependency_unavailable';
      return {
        blockSourcekit: failClosed,
        state: failClosed ? 'blocked' : 'degraded',
        reasonCode,
        message,
        markerPath,
        workspaceKind: workspace.workspaceKind,
        dependencyState: workspace.dependencyState,
        preflightState,
        classificationDurationMs: workspace.classificationDurationMs,
        resolveDurationMs: 0,
        check: buildPreflightCheck({
          name: 'sourcekit_package_preflight_unavailable',
          message,
          reasonCode,
          workspaceKind: workspace.workspaceKind,
          preflightState
        })
      };
    }

    const preflightLockPath = resolveSourcekitPreflightLockPath(repoRoot);
    const resolvedTimeoutMs = Math.max(
      1000,
      asFiniteInteger(timeoutMs)
        ?? asFiniteInteger(sourcekitConfig.preflightTimeoutMs)
        ?? SOURCEKIT_PACKAGE_PREFLIGHT_TIMEOUT_MS
    );
    const preflightLockWaitMs = Math.max(
      0,
      asFiniteInteger(sourcekitConfig.preflightLockWaitMs) ?? SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_WAIT_MS
    );
    const preflightLockPollMs = Math.max(
      10,
      asFiniteInteger(sourcekitConfig.preflightLockPollMs) ?? SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_POLL_MS
    );
    const preflightLockStaleMs = Math.max(
      1000,
      asFiniteInteger(sourcekitConfig.preflightLockStaleMs) ?? SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_STALE_MS
    );
    let preflightLock = null;
    try {
      preflightLock = await acquireHostSourcekitLock({
        lockPath: preflightLockPath,
        waitMs: preflightLockWaitMs,
        pollMs: preflightLockPollMs,
        staleMs: preflightLockStaleMs,
        signal
      });
      if (!preflightLock) {
        const message = (
          `sourcekit package preflight skipped because lock acquisition timed out `
          + `(${preflightLockWaitMs}ms).`
        );
        log(`[tooling] ${message}`);
        const preflightState = SOURCEKIT_PREFLIGHT_STATE.BLOCKED_DEPENDENCY;
        const reasonCode = 'sourcekit_preflight_lock_unavailable';
        return {
          blockSourcekit: failClosed,
          state: failClosed ? 'blocked' : 'degraded',
          reasonCode,
          message,
          markerPath,
          workspaceKind: workspace.workspaceKind,
          dependencyState: workspace.dependencyState,
          preflightState,
          classificationDurationMs: workspace.classificationDurationMs,
          resolveDurationMs: 0,
          check: buildPreflightCheck({
            name: 'sourcekit_package_preflight_lock_unavailable',
            message,
            reasonCode,
            workspaceKind: workspace.workspaceKind,
            preflightState
          })
        };
      }
      throwIfAborted(signal);
      log('[tooling] sourcekit package preflight: running `swift package resolve`.');
      const preflight = await runSourcekitPackagePreflight({
        repoRoot,
        swiftCmd: resolvedSwiftCmd,
        timeoutMs: resolvedTimeoutMs,
        signal
      });
      throwIfAborted(signal);
      if (preflight.ok) {
        try {
          throwIfAborted(signal);
          await fs.mkdir(path.dirname(markerPath), { recursive: true });
          await atomicWriteJson(markerPath, {
            schemaVersion: SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION,
            completedAt: new Date().toISOString(),
            fingerprint: workspace.fingerprint,
            swiftCmd: resolvedSwiftCmd,
            durationMs: Number.isFinite(Number(preflight.durationMs)) ? Math.max(0, Math.round(Number(preflight.durationMs))) : null,
            classificationDurationMs: workspace.classificationDurationMs,
            resolveDurationMs: Number.isFinite(Number(preflight.durationMs)) ? Math.max(0, Math.round(Number(preflight.durationMs))) : null,
            workspaceKind: workspace.workspaceKind,
            dependencyState: workspace.dependencyState,
            preflightState: SOURCEKIT_PREFLIGHT_STATE.READY,
            reasonCode: workspace.reasonCode,
            message: '',
            timeout: false
          }, {
            spaces: 0,
            newline: false
          });
        } catch {}
        log(`[tooling] sourcekit package preflight completed in ${preflight.durationMs}ms.`);
        return {
          blockSourcekit: false,
          state: 'ready',
          reasonCode: workspace.reasonCode,
          message: '',
          markerPath,
          workspaceKind: workspace.workspaceKind,
          dependencyState: workspace.dependencyState,
          preflightState: SOURCEKIT_PREFLIGHT_STATE.READY,
          classificationDurationMs: workspace.classificationDurationMs,
          resolveDurationMs: preflight.durationMs,
          check: null
        };
      }
      const classifiedFailure = classifyPreflightFailure(preflight.message, preflight.timeout === true);
      const timeoutText = preflight.timeout ? 'timeout' : 'failed';
      const message = `sourcekit package preflight ${timeoutText}: ${preflight.message || 'unknown failure'}`;
      await fs.mkdir(path.dirname(markerPath), { recursive: true });
      await atomicWriteJson(markerPath, {
        schemaVersion: SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION,
        completedAt: new Date().toISOString(),
        fingerprint: workspace.fingerprint,
        swiftCmd: resolvedSwiftCmd,
        durationMs: Number.isFinite(Number(preflight.durationMs)) ? Math.max(0, Math.round(Number(preflight.durationMs))) : null,
        classificationDurationMs: workspace.classificationDurationMs,
        resolveDurationMs: Number.isFinite(Number(preflight.durationMs)) ? Math.max(0, Math.round(Number(preflight.durationMs))) : null,
        workspaceKind: workspace.workspaceKind,
        dependencyState: workspace.dependencyState,
        preflightState: classifiedFailure.preflightState,
        reasonCode: classifiedFailure.reasonCode,
        message,
        timeout: preflight.timeout === true
      }, {
        spaces: 0,
        newline: false
      });
      return {
        blockSourcekit: failClosed,
        state: failClosed ? 'blocked' : 'degraded',
        reasonCode: classifiedFailure.reasonCode,
        message,
        markerPath,
        workspaceKind: workspace.workspaceKind,
        dependencyState: workspace.dependencyState,
        preflightState: classifiedFailure.preflightState,
        classificationDurationMs: workspace.classificationDurationMs,
        resolveDurationMs: preflight.durationMs,
        check: buildPreflightCheck({
          name: 'sourcekit_package_preflight_failed',
          message,
          reasonCode: classifiedFailure.reasonCode,
          workspaceKind: workspace.workspaceKind,
          preflightState: classifiedFailure.preflightState,
          timeout: preflight.timeout === true
        })
      };
    } finally {
      if (preflightLock?.release) {
        await releaseFileLockOrThrow(preflightLock);
      }
    }
  } catch (err) {
    if (err?.code === 'ABORT_ERR') throw err;
    const message = summarizeSubprocessOutput(err?.message || err, 200) || 'unknown preflight error';
    const preflightState = SOURCEKIT_PREFLIGHT_STATE.BLOCKED_DEPENDENCY;
    const reasonCode = 'sourcekit_preflight_error';
    return {
      blockSourcekit: failClosed,
      state: failClosed ? 'blocked' : 'degraded',
      reasonCode,
      message: `sourcekit package preflight error: ${message}`,
      check: buildPreflightCheck({
        name: 'sourcekit_package_preflight_error',
        message: `sourcekit package preflight error: ${message}`,
        reasonCode,
        workspaceKind: null,
        preflightState
      })
    };
  }
};
