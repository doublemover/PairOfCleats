import fsSync from 'node:fs';
import path from 'node:path';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { resolveEnvPath } from '../../shared/env-path.js';
import { toPosix } from '../../shared/files.js';
import { throwIfAborted } from '../../shared/abort.js';
import { acquireFileLock } from '../../shared/locks/file-lock.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import {
  invalidateProbeCacheOnInitializeFailure,
  isProbeCommandDefinitelyMissing,
  resolveToolingCommandProfile
} from './command-resolver.js';
import { splitPathEntries } from './binary-utils.js';
import { parseSwiftSignature } from './signature-parse/swift.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { filterTargetsForDocuments } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import {
  buildSourcekitRepoScopedLockPath,
  ensureSourcekitPackageResolutionPreflight,
  resolveSourcekitPreflightLockPath
} from './preflight/sourcekit-package-resolution.js';

export const SWIFT_EXTS = ['.swift'];

const SOURCEKIT_HOST_LOCK_STALE_MS = 15 * 60 * 1000;
const SOURCEKIT_HOST_LOCK_WAIT_MS = 2 * 60 * 1000;
const SOURCEKIT_HOST_LOCK_POLL_MS = 250;
const SOURCEKIT_DEFAULT_HOVER_TIMEOUT_MS = 3500;
const SOURCEKIT_DEFAULT_HOVER_MAX_PER_FILE = 10;
const SOURCEKIT_DEFAULT_HOVER_DISABLE_AFTER_TIMEOUTS = 2;
const SOURCEKIT_TOP_OFFENDER_LIMIT = 8;
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
  const normalized = toPosix(String(virtualPath || ''));
  if (!normalized) return false;
  for (const pattern of excludePathRegexes || []) {
    if (!(pattern instanceof RegExp)) continue;
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) return true;
  }
  return false;
};

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asFiniteInteger = (value) => {
  const parsed = asFiniteNumber(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const readStatSignature = (filePath) => {
  try {
    const stat = fsSync.statSync(filePath);
    return `${filePath}:${Number(stat?.size) || 0}:${Number(stat?.mtimeMs) || 0}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return `${filePath}:missing`;
    return `${filePath}:error`;
  }
};

const resolveSourcekitPackageSignatureKey = (repoRoot) => {
  const normalizedRoot = path.resolve(String(repoRoot || ''));
  const manifestPath = path.join(normalizedRoot, 'Package.swift');
  const resolvedPath = path.join(normalizedRoot, 'Package.resolved');
  return `${readStatSignature(manifestPath)}|${readStatSignature(resolvedPath)}`;
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

export const resolveSourcekitHostLockPath = (repoRoot) => (
  buildSourcekitRepoScopedLockPath(repoRoot, 'sourcekit-provider')
);
export { resolveSourcekitPreflightLockPath };

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

export const scoreSourcekitCandidate = (candidate) => {
  const lowered = String(candidate || '').toLowerCase();
  let score = 0;
  // Higher score means lower priority (penalties); comparator sorts ascending.
  if (lowered.includes('+asserts')) score += 100;
  if (lowered.includes('preview')) score += 10;
  return score;
};

const normalizeSourcekitCandidateSortKey = (candidate) => (
  String(candidate || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
);

export const compareSourcekitCandidatePriority = (left, right) => {
  const scoreDelta = (Number(left?.score) || 0) - (Number(right?.score) || 0);
  if (scoreDelta !== 0) return scoreDelta;
  const indexDelta = (Number(left?.index) || 0) - (Number(right?.index) || 0);
  if (indexDelta !== 0) return indexDelta;
  const leftNormalized = normalizeSourcekitCandidateSortKey(left?.candidate);
  const rightNormalized = normalizeSourcekitCandidateSortKey(right?.candidate);
  if (leftNormalized !== rightNormalized) {
    return leftNormalized.localeCompare(rightNormalized);
  }
  const leftRaw = String(left?.candidate || '').trim();
  const rightRaw = String(right?.candidate || '').trim();
  if (leftRaw !== rightRaw) {
    return leftRaw.localeCompare(rightRaw);
  }
  return 0;
};

const resolveCommand = (cmd) => {
  const prioritizeSourcekitCandidates = String(cmd || '').toLowerCase().includes('sourcekit');
  const candidates = resolveCommandCandidates(cmd)
    .filter((candidate) => candidate !== cmd && fsSync.existsSync(candidate))
    .map((candidate, index) => ({
      candidate,
      index,
      score: prioritizeSourcekitCandidates ? scoreSourcekitCandidate(candidate) : 0
    }))
    .sort(compareSourcekitCandidatePriority)
    .map((entry) => entry.candidate);
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
  preflightId: 'sourcekit.package-resolution',
  preflightClass: 'dependency',
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
  getPreflightKey(ctx) {
    return resolveSourcekitPackageSignatureKey(ctx?.repoRoot || process.cwd());
  },
  async preflight(ctx, inputs = {}) {
    const log = typeof inputs?.log === 'function'
      ? inputs.log
      : (typeof ctx?.logger === 'function' ? ctx.logger : (() => {}));
    const abortSignal = inputs?.abortSignal && typeof inputs.abortSignal.aborted === 'boolean'
      ? inputs.abortSignal
      : (ctx?.abortSignal && typeof ctx.abortSignal.aborted === 'boolean' ? ctx.abortSignal : null);
    throwIfAborted(abortSignal);
    const sourcekitConfig = inputs?.sourcekitConfig || ctx?.toolingConfig?.sourcekit || {};
    const docsAll = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => SWIFT_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const excludePathRegexes = resolveSourcekitExcludePathRegexes(sourcekitConfig);
    const docs = docsAll.filter((doc) => !shouldSkipSourcekitPath(doc?.virtualPath, excludePathRegexes));
    const targets = filterTargetsForDocuments(inputs?.targets, docs);
    if (!docs.length || !targets.length) {
      return {
        state: 'skipped',
        blockSourcekit: false,
        check: null
      };
    }
    const preflight = await ensureSourcekitPackageResolutionPreflight({
      repoRoot: ctx.repoRoot,
      log,
      signal: abortSignal,
      sourcekitConfig,
      cacheRoot: ctx?.cache?.dir || null,
      timeoutMs: inputs?.preflightTimeoutMs
    });
    return {
      ...preflight,
      state: preflight?.blockSourcekit ? 'blocked' : 'ready'
    };
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
    const targets = filterTargetsForDocuments(inputs?.targets, docs);
    const checks = buildDuplicateChunkUidChecks(targets, { label: 'sourcekit' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const requestedCommand = resolveProviderRequestedCommand({
      providerId: 'sourcekit',
      toolingConfig: ctx?.toolingConfig || {},
      defaultCmd: 'sourcekit-lsp',
      defaultArgs: []
    });
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'sourcekit',
      cmd: requestedCommand.cmd,
      args: requestedCommand.args,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      if (isProbeCommandDefinitelyMissing(commandProfile.probe)) {
        log('[index] sourcekit-lsp not detected; skipping.');
        checks.push({
          name: 'sourcekit_command_unavailable',
          status: 'warn',
          message: 'sourcekit-lsp not detected; skipping.'
        });
        return {
          provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
      log('[index] sourcekit-lsp command probe failed; attempting stdio initialization.');
      checks.push({
        name: 'sourcekit_command_unavailable',
        status: 'warn',
        message: 'sourcekit-lsp command probe failed; attempting stdio initialization anyway.'
      });
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
          ?? asFiniteNumber(runtimeConfig.hoverTimeoutMs)
          ?? SOURCEKIT_DEFAULT_HOVER_TIMEOUT_MS
      )
    );
    const signatureHelpTimeoutMs = Math.max(
      750,
      Math.floor(
        asFiniteNumber(sourcekitConfig.signatureHelpTimeoutMs)
          ?? asFiniteNumber(runtimeConfig.signatureHelpTimeoutMs)
          ?? hoverTimeoutMs
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
    const hoverRequireMissingReturn = sourcekitConfig.hoverRequireMissingReturn === false
      ? false
      : runtimeConfig.hoverRequireMissingReturn !== false;
    const hoverEnabled = sourcekitConfig.hoverEnabled === false || sourcekitConfig.hover === false
      ? false
      : runtimeConfig.hoverEnabled !== false;
    const signatureHelpEnabled = sourcekitConfig.signatureHelpEnabled === false
      || sourcekitConfig.signatureHelp === false
      ? false
      : runtimeConfig.signatureHelpEnabled !== false;
    const hoverSymbolKinds = Array.isArray(sourcekitConfig.hoverSymbolKinds)
      && sourcekitConfig.hoverSymbolKinds.length
      ? sourcekitConfig.hoverSymbolKinds
      : [SymbolKind.Function, SymbolKind.Method];

    const preflight = await awaitToolingProviderPreflight(ctx, {
      provider: this,
      inputs: {
        documents: docs,
        targets,
        sourcekitConfig,
        abortSignal,
        log
      },
      waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
        ? inputs.toolingPreflightWaveToken
        : null
    });
    throwIfAborted(abortSignal);
    if (preflight?.check) checks.push(preflight.check);
    if (preflight?.blockSourcekit) {
      log('[tooling] sourcekit skipped because package preflight did not complete safely.');
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const hostLockEnabled = sourcekitConfig.hostConcurrencyGate !== false;
    const hostLockWaitMs = Math.max(
      0,
      asFiniteInteger(sourcekitConfig.hostConcurrencyWaitMs) ?? SOURCEKIT_HOST_LOCK_WAIT_MS
    );
    const hostLockPath = resolveSourcekitHostLockPath(ctx.repoRoot);
    let hostLock = null;
    if (hostLockEnabled) {
      hostLock = await acquireHostSourcekitLock({
        lockPath: hostLockPath,
        waitMs: hostLockWaitMs,
        signal: abortSignal,
        log
      });
      if (!hostLock) {
        log('[tooling] sourcekit host lock wait elapsed; skipping sourcekit provider for this run.');
        checks.push({
          name: 'sourcekit_host_lock_unavailable',
          status: 'warn',
          message: `sourcekit host lock timed out after ${hostLockWaitMs}ms; skipping provider to avoid unlocked contention.`
        });
        return {
          provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
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
        providerId: 'sourcekit',
        cmd: commandProfile.resolved.cmd,
        args: commandProfile.resolved.args || requestedCommand.args,
        hoverTimeoutMs,
        signatureHelpTimeoutMs,
        hoverEnabled,
        signatureHelpEnabled,
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
        sessionPoolingEnabled: !hostLockEnabled,
        indexDir: ctx?.buildRoot || null
      });
      invalidateProbeCacheOnInitializeFailure({
        checks: result?.checks,
        providerId: 'sourcekit',
        command: commandProfile.resolved.cmd
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
        try {
          await hostLock.release();
        } catch (error) {
          log(`[tooling] sourcekit host lock release failed: ${error?.message || error}`);
        }
      }
    }
  }
});
