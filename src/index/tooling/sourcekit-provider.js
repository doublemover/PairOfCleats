import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execaSync } from 'execa';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { isTestingEnv } from '../../shared/env.js';
import { throwIfAborted } from '../../shared/abort.js';
import { acquireFileLock } from '../../shared/locks/file-lock.js';
import { spawnSubprocess } from '../../shared/subprocess.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parseSwiftSignature } from './signature-parse/swift.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';

export const SWIFT_EXTS = ['.swift'];

const SOURCEKIT_HOST_LOCK_STALE_MS = 15 * 60 * 1000;
const SOURCEKIT_HOST_LOCK_WAIT_MS = 2 * 60 * 1000;
const SOURCEKIT_HOST_LOCK_POLL_MS = 250;
const SOURCEKIT_DEFAULT_HOVER_TIMEOUT_MS = 3500;
const SOURCEKIT_DEFAULT_HOVER_MAX_PER_FILE = 10;
const SOURCEKIT_DEFAULT_HOVER_DISABLE_AFTER_TIMEOUTS = 2;
const SOURCEKIT_TOP_OFFENDER_LIMIT = 8;
const SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION = 1;
const SOURCEKIT_PACKAGE_PREFLIGHT_MARKER_RELATIVE_PATH = path.join(
  '.build',
  'pairofcleats',
  'sourcekit-package-preflight.json'
);
const SOURCEKIT_PACKAGE_PREFLIGHT_TIMEOUT_MS = 90 * 1000;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_WAIT_MS = 90 * 1000;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_POLL_MS = 250;
const SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_STALE_MS = 10 * 60 * 1000;
const SOURCEKIT_DEFAULT_EXCLUDE_PATH_REGEXES = [
  /\/test\/sourcekit\/misc\/parser-cutoff\.swift$/i
];

const buildRegex = (value) => {
  if (value instanceof RegExp) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const slashMatch = /^\/(.+)\/([a-z]*)$/i.exec(text);
  if (slashMatch) {
    try {
      return new RegExp(slashMatch[1], slashMatch[2]);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(text, 'i');
  } catch {
    return null;
  }
};

const resolveSourcekitExcludePathRegexes = (sourcekitConfig) => {
  const configured = Array.isArray(sourcekitConfig?.excludePathRegexes)
    ? sourcekitConfig.excludePathRegexes
    : (Array.isArray(sourcekitConfig?.excludePathPatterns)
      ? sourcekitConfig.excludePathPatterns
      : []);
  const parsed = configured
    .map((entry) => buildRegex(entry))
    .filter((entry) => entry instanceof RegExp);
  return [...SOURCEKIT_DEFAULT_EXCLUDE_PATH_REGEXES, ...parsed];
};

const shouldSkipSourcekitPath = (virtualPath, excludePathRegexes) => {
  const normalized = String(virtualPath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  for (const pattern of excludePathRegexes || []) {
    if (!(pattern instanceof RegExp)) continue;
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) return true;
  }
  return false;
};

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
const quoteWindowsCmdArg = (value) => {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^();]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};
const runProbeCommand = (cmd, args) => {
  if (!shouldUseShell(cmd)) {
    return execaSync(cmd, args, {
      stdio: 'ignore',
      reject: false
    });
  }
  const commandLine = [cmd, ...(Array.isArray(args) ? args : [])]
    .map(quoteWindowsCmdArg)
    .join(' ');
  const shellExe = process.env.ComSpec || 'cmd.exe';
  return execaSync(shellExe, ['/d', '/s', '/c', commandLine], {
    stdio: 'ignore',
    reject: false
  });
};

/**
 * Build a spawn-safe command tuple for platform-specific binaries.
 *
 * On Windows, `.cmd` and `.bat` files cannot be executed directly with
 * `shell: false`, so we route through `cmd.exe /c` while still preserving
 * explicit argument quoting.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{command:string,args:string[]}}
 */
const resolveSpawnCommandForExec = (cmd, args) => {
  if (!shouldUseShell(cmd)) {
    return {
      command: cmd,
      args: Array.isArray(args) ? args : []
    };
  }
  const shellExe = process.env.ComSpec || 'cmd.exe';
  const commandLine = [cmd, ...(Array.isArray(args) ? args : [])]
    .map(quoteWindowsCmdArg)
    .join(' ');
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

const canRunCommand = (cmd, args = ['--help']) => {
  try {
    const result = runProbeCommand(cmd, args);
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

const canRunSourcekit = (cmd) => {
  return canRunCommand(cmd, ['--help']);
};

const acquireHostSourcekitLock = async ({
  lockPath,
  waitMs = SOURCEKIT_HOST_LOCK_WAIT_MS,
  pollMs = SOURCEKIT_HOST_LOCK_POLL_MS,
  staleMs = SOURCEKIT_HOST_LOCK_STALE_MS,
  signal = null,
  log = () => {}
}) => {
  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
    signal,
    metadata: { scope: 'sourcekit-provider' },
    forceStaleCleanup: true,
    onStale: () => {
      log('[tooling] sourcekit host lock stale; removed.');
    }
  });
  if (!lock) return null;
  return {
    release: async () => {
      await lock.release();
    }
  };
};

const readUtf8IfExists = async (targetPath) => {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * Determine whether SwiftPM dependency resolution should run before sourcekit.
 *
 * SourceKit can trigger background dependency/network activity when the repo is
 * SwiftPM-based. We proactively resolve that work once per manifest fingerprint
 * to avoid side effects happening during LSP enrichment.
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

const summarizeSubprocessOutput = (value, maxChars = 240) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
};

const readSourcekitPreflightMarker = async (markerPath) => {
  const raw = await readUtf8IfExists(markerPath);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.schemaVersion !== SOURCEKIT_PACKAGE_PREFLIGHT_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
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
  await fs.writeFile(markerPath, JSON.stringify(payload), 'utf8');
};

/**
 * Run bounded `swift package resolve` preflight to drain package side effects
 * before sourcekit starts serving symbol requests.
 *
 * @param {{repoRoot:string,swiftCmd:string,timeoutMs:number}} input
 * @returns {Promise<{ok:boolean,timeout:boolean,durationMs:number,message:string}>}
 */
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
      detached: false,
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
 * @param {{repoRoot:string,log:(line:string)=>void}} input
 * @returns {Promise<{blockSourcekit:boolean,check:object|null}>}
 */
const ensureSourcekitPackageResolutionPreflight = async ({
  repoRoot,
  log,
  signal = null
}) => {
  try {
    throwIfAborted(signal);
    const need = await resolveSourcekitPackagePreflightNeed({ repoRoot });
    if (!need.required) {
      return { blockSourcekit: false, check: null };
    }
    const markerPath = path.join(repoRoot, SOURCEKIT_PACKAGE_PREFLIGHT_MARKER_RELATIVE_PATH);
    const marker = await readSourcekitPreflightMarker(markerPath);
    if (marker?.fingerprint === need.fingerprint) {
      log('[tooling] sourcekit package preflight cache hit.');
      return { blockSourcekit: false, check: null };
    }

    const resolvedSwiftCmd = resolveCommand('swift');
    if (!canRunCommand(resolvedSwiftCmd, ['--version'])) {
      const message = 'sourcekit package preflight skipped because `swift` command is unavailable.';
      return {
        blockSourcekit: true,
        check: {
          name: 'sourcekit_package_preflight_unavailable',
          status: 'warn',
          message
        }
      };
    }

    const preflightLockPath = path.join(os.tmpdir(), 'pairofcleats', 'locks', 'sourcekit-package-preflight.lock');
    const timeoutMs = SOURCEKIT_PACKAGE_PREFLIGHT_TIMEOUT_MS;
    let preflightLock = null;
    try {
      preflightLock = await acquireHostSourcekitLock({
        lockPath: preflightLockPath,
        waitMs: SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_WAIT_MS,
        pollMs: SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_POLL_MS,
        staleMs: SOURCEKIT_PACKAGE_PREFLIGHT_LOCK_STALE_MS,
        signal,
        log
      });
      if (!preflightLock) {
        log('[tooling] sourcekit package preflight lock wait elapsed; continuing without lock.');
      }
      throwIfAborted(signal);
      log('[tooling] sourcekit package preflight: running `swift package resolve`.');
      const preflight = await runSourcekitPackagePreflight({
        repoRoot,
        swiftCmd: resolvedSwiftCmd,
        timeoutMs,
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
        blockSourcekit: true,
        check: {
          name: 'sourcekit_package_preflight_failed',
          status: 'warn',
          message,
          timeout: preflight.timeout === true
        }
      };
    } finally {
      if (preflightLock?.release) {
        await preflightLock.release();
      }
    }
  } catch (err) {
    if (err?.code === 'ABORT_ERR') throw err;
    const message = summarizeSubprocessOutput(err?.message || err, 200) || 'unknown preflight error';
    return {
      blockSourcekit: true,
      check: {
        name: 'sourcekit_package_preflight_error',
        status: 'warn',
        message: `sourcekit package preflight error: ${message}`
      }
    };
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

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
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
    for (const ext of ['.exe', '.cmd', '.bat']) {
      for (const dir of pathEntries) {
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

const sourcekitCandidateScore = (candidate) => {
  const lowered = String(candidate || '').toLowerCase();
  let score = 0;
  if (lowered.includes('+asserts')) score += 100;
  if (lowered.includes('preview')) score += 10;
  return score;
};

const resolveCommand = (cmd) => {
  const candidates = resolveCommandCandidates(cmd)
    .filter((candidate) => candidate !== cmd && fsSync.existsSync(candidate))
    .sort((a, b) => {
      const scoreA = sourcekitCandidateScore(a);
      const scoreB = sourcekitCandidateScore(b);
      if (scoreA !== scoreB) return scoreA - scoreB;
      return String(a).localeCompare(String(b));
    });
  for (const candidate of candidates) {
    if (canRunSourcekit(candidate)) return candidate;
  }
  if (canRunSourcekit(cmd)) return cmd;
  return cmd;
};

const formatLatency = (value) => (Number.isFinite(value) ? `${Math.round(value)}ms` : 'n/a');

const logHoverMetrics = (log, metrics) => {
  if (!metrics || typeof metrics !== 'object') return;
  const requested = metrics.requested || 0;
  const timedOut = metrics.timedOut || 0;
  if (requested <= 0 && timedOut <= 0) return;
  log(
    '[tooling] sourcekit hover metrics '
      + `requested=${requested} `
      + `succeeded=${metrics.succeeded || 0} `
      + `timedOut=${timedOut} `
      + `skippedByBudget=${metrics.skippedByBudget || 0} `
      + `skippedByKind=${metrics.skippedByKind || 0} `
      + `skippedByReturnSufficient=${metrics.skippedByReturnSufficient || 0} `
      + `skippedByAdaptiveDisable=${metrics.skippedByAdaptiveDisable || 0} `
      + `skippedByGlobalDisable=${metrics.skippedByGlobalDisable || 0} `
      + `p50=${formatLatency(metrics.p50Ms)} `
      + `p95=${formatLatency(metrics.p95Ms)}`
  );
  const files = Array.isArray(metrics.files) ? metrics.files : [];
  const top = files
    .filter((entry) => (entry?.requested || 0) > 0 || (entry?.timedOut || 0) > 0)
    .slice(0, SOURCEKIT_TOP_OFFENDER_LIMIT);
  for (const entry of top) {
    log(
      '[tooling] sourcekit hover file '
        + `${entry.virtualPath || '<unknown>'} `
        + `requested=${entry.requested || 0} `
        + `succeeded=${entry.succeeded || 0} `
        + `timedOut=${entry.timedOut || 0} `
        + `p50=${formatLatency(entry.p50Ms)} `
        + `p95=${formatLatency(entry.p95Ms)}`
    );
  }
};

export const createSourcekitProvider = () => ({
  id: 'sourcekit',
  version: '2.0.0',
  label: 'sourcekit-lsp',
  priority: 40,
  languages: ['swift'],
  kinds: ['types'],
  requires: { cmd: 'sourcekit-lsp' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ sourcekit: ctx?.toolingConfig?.sourcekit || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const abortSignal = ctx?.abortSignal && typeof ctx.abortSignal.aborted === 'boolean'
      ? ctx.abortSignal
      : null;
    throwIfAborted(abortSignal);
    const sourcekitConfig = ctx?.toolingConfig?.sourcekit || {};
    const excludePathRegexes = resolveSourcekitExcludePathRegexes(sourcekitConfig);
    const docsAll = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => SWIFT_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const docs = docsAll.filter((doc) => !shouldSkipSourcekitPath(doc?.virtualPath, excludePathRegexes));
    if (docs.length < docsAll.length) {
      log(`[tooling] sourcekit skipped ${docsAll.length - docs.length} document(s) by path filter.`);
    }
    const docPaths = new Set(docs.map((doc) => doc.virtualPath));
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docPaths.has(target.virtualPath))
      : [];
    const checks = buildDuplicateChunkUidChecks(targets, { label: 'sourcekit' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const commandProfile = resolveToolingCommandProfile({
      providerId: 'sourcekit',
      cmd: 'sourcekit-lsp',
      args: [],
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    const resolvedCmd = commandProfile.resolved.cmd;
    if (!canRunSourcekit(resolvedCmd)) {
      log('[index] sourcekit-lsp not detected; skipping tooling-based types.');
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const runtimeConfig = resolveLspRuntimeConfig({
      providerConfig: sourcekitConfig,
      globalConfigs: [ctx?.toolingConfig || null],
      defaults: {
        timeoutMs: 45000,
        retries: 2,
        breakerThreshold: 3
      }
    });
    const timeoutMs = Number(runtimeConfig.timeoutMs);
    const hoverTimeoutMs = Math.max(
      750,
      Math.floor(
        asFiniteNumber(sourcekitConfig.hoverTimeoutMs)
          ?? asFiniteNumber(ctx?.toolingConfig?.hoverTimeoutMs)
          ?? SOURCEKIT_DEFAULT_HOVER_TIMEOUT_MS
      )
    );
    const hoverMaxPerFile = Math.max(
      1,
      asFiniteInteger(sourcekitConfig.hoverMaxPerFile) ?? SOURCEKIT_DEFAULT_HOVER_MAX_PER_FILE
    );
    const hoverDisableAfterTimeouts = Math.max(
      1,
      asFiniteInteger(sourcekitConfig.hoverDisableAfterTimeouts)
        ?? SOURCEKIT_DEFAULT_HOVER_DISABLE_AFTER_TIMEOUTS
    );
    const hoverRequireMissingReturn = sourcekitConfig.hoverRequireMissingReturn !== false;
    const hoverSymbolKinds = Array.isArray(sourcekitConfig.hoverSymbolKinds)
      && sourcekitConfig.hoverSymbolKinds.length
      ? sourcekitConfig.hoverSymbolKinds
      : [SymbolKind.Function, SymbolKind.Method];

    const preflight = await ensureSourcekitPackageResolutionPreflight({
      repoRoot: ctx.repoRoot,
      log,
      signal: abortSignal
    });
    throwIfAborted(abortSignal);
    if (preflight.check) checks.push(preflight.check);
    if (preflight.blockSourcekit) {
      log('[tooling] sourcekit skipped because package preflight did not complete safely.');
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const hostLockEnabled = sourcekitConfig.hostConcurrencyGate === true
      || (sourcekitConfig.hostConcurrencyGate !== false && isTestingEnv());
    const hostLockWaitMs = Math.max(
      0,
      asFiniteInteger(sourcekitConfig.hostConcurrencyWaitMs) ?? SOURCEKIT_HOST_LOCK_WAIT_MS
    );
    const hostLockPath = path.join(os.tmpdir(), 'pairofcleats', 'locks', 'sourcekit-provider.lock');
    let hostLock = null;
    if (hostLockEnabled) {
      hostLock = await acquireHostSourcekitLock({
        lockPath: hostLockPath,
        waitMs: hostLockWaitMs,
        signal: abortSignal,
        log
      });
      if (!hostLock) {
        log('[tooling] sourcekit host lock wait elapsed; continuing without lock.');
      }
    }

    try {
      const result = await collectLspTypes({
        ...runtimeConfig,
        rootDir: ctx.repoRoot,
        documents: docs,
        targets,
        abortSignal,
        log,
        cmd: resolvedCmd,
        args: [],
        hoverTimeoutMs,
        hoverEnabled: sourcekitConfig.hover !== false,
        hoverRequireMissingReturn,
        hoverSymbolKinds,
        hoverMaxPerFile,
        hoverDisableAfterTimeouts,
        parseSignature: (detail) => parseSwiftSignature(detail),
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null
      });

      logHoverMetrics(log, result.hoverMetrics);
      const diagnostics = appendDiagnosticChecks(
        result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : null,
        [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
      );
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: result.byChunkUid,
        diagnostics: result.runtime
          ? { ...(diagnostics || {}), runtime: result.runtime }
          : diagnostics
      };
    } finally {
      if (hostLock?.release) {
        await hostLock.release();
      }
    }
  }
});
