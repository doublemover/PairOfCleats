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
import { buildWindowsShellCommand } from '../../../shared/subprocess/windows-cmd.js';
import { resolveToolingCommandProfile } from '../command-resolver.js';
import { splitPathEntries } from '../binary-utils.js';

const SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION = 1;
const SOURCEKIT_PACKAGE_PREFLIGHT_MARKER_FILENAME = 'sourcekit-package-preflight.json';
const SOURCEKIT_PACKAGE_PREFLIGHT_TIMEOUT_MS = 90 * 1000;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_WAIT_MS = 90 * 1000;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_POLL_MS = 250;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_STALE_MS = 10 * 60 * 1000;
const SOURCEKIT_LOCK_NAMESPACE_SUFFIX = path.join('locks', 'sourcekit');

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const resolveSpawnCommandForExec = (cmd, args) => {
  if (!shouldUseShell(cmd)) {
    return {
      command: cmd,
      args: Array.isArray(args) ? args : []
    };
  }
  const shellExe = process.env.ComSpec || 'cmd.exe';
  const commandLine = buildWindowsShellCommand(cmd, args);
  return {
    command: shellExe,
    args: ['/d', '/s', '/c', commandLine]
  };
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
const resolveSourcekitPackagePreflightNeed = async ({ repoRoot }) => {
  const packageManifestPath = path.join(repoRoot, 'Package.swift');
  const packageResolvedPath = path.join(repoRoot, 'Package.resolved');
  const packageManifest = await readUtf8IfExists(packageManifestPath);
  if (typeof packageManifest !== 'string') {
    return {
      required: false,
      reason: 'no-package-manifest',
      packageManifestPath,
      packageResolvedPath,
      fingerprint: null
    };
  }
  const hasPackageDependencies = /\.package\s*\(/u.test(packageManifest);
  if (!hasPackageDependencies) {
    return {
      required: false,
      reason: 'no-package-dependencies',
      packageManifestPath,
      packageResolvedPath,
      fingerprint: null
    };
  }
  const packageResolved = await readUtf8IfExists(packageResolvedPath);
  const fingerprintHash = crypto.createHash('sha1');
  fingerprintHash.update(`schema:${SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION}`);
  fingerprintHash.update(`manifest:${packageManifest}`);
  fingerprintHash.update(`resolved:${packageResolved || '<missing>'}`);
  return {
    required: true,
    reason: 'swiftpm-dependencies-detected',
    packageManifestPath,
    packageResolvedPath,
    fingerprint: fingerprintHash.digest('hex')
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
    const need = await resolveSourcekitPackagePreflightNeed({ repoRoot });
    if (!need.required) {
      return { blockSourcekit: false, check: null };
    }
    const markerPath = resolveSourcekitPreflightMarkerPath({
      repoRoot,
      cacheRoot
    });
    const marker = await readSourcekitPreflightMarker(markerPath);
    if (marker?.fingerprint === need.fingerprint) {
      log('[tooling] sourcekit package preflight cache hit.');
      return { blockSourcekit: false, check: null };
    }

    const resolvedSwiftCmd = resolveCommand('swift');
    if (!canRunCommand(resolvedSwiftCmd, ['--version'])) {
      const message = 'sourcekit package preflight skipped because `swift` command is unavailable.';
      return {
        blockSourcekit: failClosed,
        check: {
          name: 'sourcekit_package_preflight_unavailable',
          status: 'warn',
          message
        }
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
        return {
          blockSourcekit: failClosed,
          check: {
            name: 'sourcekit_package_preflight_lock_unavailable',
            status: 'warn',
            message
          }
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
          await writeSourcekitPreflightMarker({
            markerPath,
            fingerprint: need.fingerprint,
            swiftCmd: resolvedSwiftCmd,
            durationMs: preflight.durationMs
          });
        } catch {}
        log(`[tooling] sourcekit package preflight completed in ${preflight.durationMs}ms.`);
        return { blockSourcekit: false, check: null };
      }
      const timeoutText = preflight.timeout ? 'timeout' : 'failed';
      const message = `sourcekit package preflight ${timeoutText}: ${preflight.message || 'unknown failure'}`;
      return {
        blockSourcekit: failClosed,
        check: {
          name: 'sourcekit_package_preflight_failed',
          status: 'warn',
          message,
          timeout: preflight.timeout === true
        }
      };
    } finally {
      if (preflightLock?.release) {
        await releaseFileLockOrThrow(preflightLock);
      }
    }
  } catch (err) {
    if (err?.code === 'ABORT_ERR') throw err;
    const message = summarizeSubprocessOutput(err?.message || err, 200) || 'unknown preflight error';
    return {
      blockSourcekit: failClosed,
      check: {
        name: 'sourcekit_package_preflight_error',
        status: 'warn',
        message: `sourcekit package preflight error: ${message}`
      }
    };
  }
};
