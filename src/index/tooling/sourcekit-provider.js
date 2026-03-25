import fsSync from 'node:fs';
import path from 'node:path';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { toPosix } from '../../shared/files.js';
import { throwIfAborted } from '../../shared/abort.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../shared/locks/file-lock.js';
import {
  appendDiagnosticChecks,
  buildDuplicateChunkUidChecks,
  buildProviderFidelityContract,
  hashProviderConfig,
  PROVIDER_FIDELITY_STATE
} from './provider-contract.js';
import {
  invalidateProbeCacheOnInitializeFailure,
  isProbeCommandDefinitelyMissing
} from './command-resolver.js';
import { parseSwiftSignature } from './signature-parse/swift.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { filterTargetsForDocuments } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import {
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from './preflight/command-profile-preflight.js';
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
const SOURCEKIT_DEFAULT_HOVER_CONCURRENCY = 2;
const SOURCEKIT_TOP_OFFENDER_LIMIT = 8;
const SOURCEKIT_DEFAULT_EXCLUDE_PATH_REGEXES = [
  /\/test\/sourcekit\/misc\/parser-cutoff\.swift$/i
];
const SOURCEKIT_ADMISSION_STARTUP_MODE = Object.freeze({
  HEALTHY: 'healthy',
  WEAK_STARTUP: 'weak_startup',
  DEPENDENCY_BLOCKED: 'dependency_blocked',
  HOST_LOCK_UNAVAILABLE: 'host_lock_unavailable',
  RUNTIME_TIMEOUT_STORM: 'runtime_timeout_storm'
});
const SOURCEKIT_REQUEST_CLASSES = Object.freeze([
  'hover',
  'semanticTokens',
  'signatureHelp',
  'inlayHints'
]);

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

const resolveSourcekitRequestedCommand = (ctx) => resolveProviderRequestedCommand({
  providerId: 'sourcekit',
  toolingConfig: ctx?.toolingConfig || {},
  defaultCmd: 'sourcekit-lsp',
  defaultArgs: []
});

const buildSourcekitCommandUnavailableCheck = ({ definitelyMissing = false } = {}) => ({
  name: 'sourcekit_command_unavailable',
  status: 'warn',
  message: definitelyMissing
    ? 'sourcekit-lsp not detected; skipping.'
    : 'sourcekit-lsp command probe failed; attempting stdio initialization anyway.'
});

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
  return lock;
};

export const resolveSourcekitHostLockPath = (repoRoot) => (
  buildSourcekitRepoScopedLockPath(repoRoot, 'sourcekit-provider')
);
export { resolveSourcekitPreflightLockPath };

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

const formatLatency = (value) => (Number.isFinite(value) ? `${Math.round(value)}ms` : 'n/a');

const logHoverMetrics = (log, metrics) => {
  if (!metrics || typeof metrics !== 'object') return;
  const requested = metrics.requested || 0;
  const timedOut = metrics.hoverTimedOut || 0;
  const semanticTokensTimedOut = metrics.semanticTokensTimedOut || 0;
  const signatureHelpTimedOut = metrics.signatureHelpTimedOut || 0;
  if (requested <= 0 && timedOut <= 0 && semanticTokensTimedOut <= 0 && signatureHelpTimedOut <= 0) return;
  log(
    '[tooling] sourcekit hover metrics '
      + `requested=${requested} `
      + `succeeded=${metrics.succeeded || 0} `
      + `timedOut=${timedOut} `
      + `semanticTokensTimedOut=${semanticTokensTimedOut} `
      + `signatureHelpTimedOut=${signatureHelpTimedOut} `
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
        + `timedOut=${entry.hoverTimedOut || 0} `
        + `semanticTokensTimedOut=${entry.semanticTokensTimedOut || 0} `
        + `signatureHelpTimedOut=${entry.signatureHelpTimedOut || 0} `
        + `p50=${formatLatency(entry.p50Ms)} `
        + `p95=${formatLatency(entry.p95Ms)}`
    );
  }
};

const shouldSuppressSourcekitSemanticTokensForStartup = (preflight, sourcekitConfig, runtimeConfig) => {
  if (sourcekitConfig?.semanticTokensEnabled === false || sourcekitConfig?.semanticTokens === false) {
    return {
      suppress: true,
      reasonCode: 'sourcekit_semantic_tokens_disabled',
      message: 'sourcekit semantic tokens are disabled by configuration.'
    };
  }
  if (runtimeConfig?.semanticTokensEnabled === false) {
    return {
      suppress: true,
      reasonCode: 'sourcekit_semantic_tokens_disabled',
      message: 'sourcekit semantic tokens are disabled by runtime policy.'
    };
  }
  const startupState = String(
    preflight?.state === 'degraded'
      ? preflight.state
      : (
        preflight?.preflightState && String(preflight.preflightState).trim().toLowerCase() !== 'ready'
          ? 'degraded'
          : preflight?.state || ''
      )
  ).trim().toLowerCase();
  if (startupState !== 'degraded') {
    return {
      suppress: false,
      reasonCode: null,
      message: ''
    };
  }
  return {
    suppress: true,
    reasonCode: 'sourcekit_semantic_tokens_suppressed_weak_startup',
    message: `sourcekit semantic tokens suppressed because startup is degraded (${String(preflight?.reasonCode || 'unknown')}).`
  };
};

const resolveSourcekitStartupMode = ({
  preflight = null,
  hostLockUnavailable = false,
  runtime = null
} = {}) => {
  if (hostLockUnavailable) {
    return SOURCEKIT_ADMISSION_STARTUP_MODE.HOST_LOCK_UNAVAILABLE;
  }
  if (preflight?.blockSourcekit) {
    return SOURCEKIT_ADMISSION_STARTUP_MODE.DEPENDENCY_BLOCKED;
  }
  if (Number(runtime?.guard?.tripCount || 0) > 0) {
    return SOURCEKIT_ADMISSION_STARTUP_MODE.RUNTIME_TIMEOUT_STORM;
  }
  const startupState = String(
    preflight?.state === 'degraded'
      ? preflight.state
      : (
        preflight?.preflightState && String(preflight.preflightState).trim().toLowerCase() !== 'ready'
          ? 'degraded'
          : preflight?.state || ''
      )
  ).trim().toLowerCase();
  if (startupState === 'degraded') {
    return SOURCEKIT_ADMISSION_STARTUP_MODE.WEAK_STARTUP;
  }
  return SOURCEKIT_ADMISSION_STARTUP_MODE.HEALTHY;
};

const resolveSourcekitAdmissionPolicy = ({
  preflight = null,
  hostLockUnavailable = false,
  runtime = null
} = {}) => {
  const startupMode = resolveSourcekitStartupMode({
    preflight,
    hostLockUnavailable,
    runtime
  });
  const requestedRequestClasses = [...SOURCEKIT_REQUEST_CLASSES];
  const suppressedRequestClasses = [];
  const degradedRequestClasses = [];
  const checks = [];
  let blockSourcekit = false;
  let reasonCode = null;
  let message = '';
  if (startupMode === SOURCEKIT_ADMISSION_STARTUP_MODE.DEPENDENCY_BLOCKED) {
    blockSourcekit = true;
    reasonCode = String(preflight?.reasonCode || 'sourcekit_dependency_blocked').trim() || 'sourcekit_dependency_blocked';
    message = `sourcekit blocked because startup dependencies are not ready (${reasonCode}).`;
  } else if (startupMode === SOURCEKIT_ADMISSION_STARTUP_MODE.HOST_LOCK_UNAVAILABLE) {
    blockSourcekit = true;
    reasonCode = 'sourcekit_host_lock_unavailable';
    message = 'sourcekit blocked because the host lock is unavailable.';
  } else if (startupMode === SOURCEKIT_ADMISSION_STARTUP_MODE.WEAK_STARTUP) {
    reasonCode = String(preflight?.reasonCode || 'sourcekit_weak_startup').trim() || 'sourcekit_weak_startup';
    suppressedRequestClasses.push('semanticTokens', 'signatureHelp', 'inlayHints');
    message = `sourcekit weak startup policy active (${reasonCode}); suppressing high-cost semantic request classes.`;
    checks.push({
      name: 'sourcekit_weak_startup_request_suppression',
      status: 'warn',
      message
    });
  } else if (startupMode === SOURCEKIT_ADMISSION_STARTUP_MODE.RUNTIME_TIMEOUT_STORM) {
    reasonCode = 'sourcekit_timeout_storm_truncated';
    degradedRequestClasses.push('hover', 'semanticTokens', 'signatureHelp', 'inlayHints');
    message = 'sourcekit runtime timeout storm detected; later request classes may be truncated or quarantined by the shared LSP runtime.';
  }
  return {
    startupMode,
    blockSourcekit,
    reasonCode,
    message,
    requestedRequestClasses,
    admittedRequestClasses: requestedRequestClasses.filter(
      (requestClass) => !suppressedRequestClasses.includes(requestClass)
    ),
    suppressedRequestClasses,
    degradedRequestClasses,
    checks
  };
};

const resolveSourcekitRuntimeIssueClasses = ({
  preflight = null,
  checks = [],
  semanticTokenStartupPolicy = null,
  runtime = null,
  admissionPolicy = null
} = {}) => {
  const issueClasses = new Set();
  const preflightState = String(preflight?.preflightState || '').trim().toLowerCase();
  const preflightReasonCode = String(preflight?.reasonCode || '').trim().toLowerCase();
  if (preflightReasonCode === 'sourcekit_preflight_lock_unavailable') {
    issueClasses.add('package_preflight_lock_unavailable');
  }
  if (preflightReasonCode.startsWith('sourcekit_blocked_dependency')) {
    issueClasses.add('package_resolution_blocked');
  }
  if (preflightReasonCode === 'sourcekit_blocked_network') {
    issueClasses.add('package_resolution_network_blocked');
  }
  if (
    preflightReasonCode === 'sourcekit_blocked_manifest'
    || preflightReasonCode === 'sourcekit_blocked_manifest_unreadable'
  ) {
    issueClasses.add('package_manifest_blocked');
  }
  if (preflightState === 'blocked_dependency') {
    issueClasses.add('dependency_resolution_required');
  }
  if (String(semanticTokenStartupPolicy?.reasonCode || '').trim() === 'sourcekit_semantic_tokens_suppressed_weak_startup') {
    issueClasses.add('weak_startup_semantic_tokens_suppressed');
  }
  if (Array.isArray(admissionPolicy?.suppressedRequestClasses) && admissionPolicy.suppressedRequestClasses.length > 0) {
    issueClasses.add('weak_startup_request_suppression');
  }
  if (Array.isArray(checks) && checks.some((check) => check?.name === 'sourcekit_host_lock_unavailable')) {
    issueClasses.add('host_lock_unavailable');
  }
  if (Number(runtime?.requests?.byMethod?.['textDocument/semanticTokens/full']?.timedOut || 0) > 0) {
    issueClasses.add('semantic_tokens_timeout');
  }
  if (Number(runtime?.requests?.byMethod?.['textDocument/hover']?.timedOut || 0) > 0) {
    issueClasses.add('hover_timeout');
  }
  if (Number(runtime?.requests?.byMethod?.['textDocument/signatureHelp']?.timedOut || 0) > 0) {
    issueClasses.add('signature_help_timeout');
  }
  if (Number(runtime?.guard?.tripCount || 0) > 0) {
    issueClasses.add('circuit_breaker_tripped');
    issueClasses.add('timeout_storm_truncated');
  }
  return Array.from(issueClasses).sort((left, right) => left.localeCompare(right));
};

export const createSourcekitProvider = () => ({
  id: 'sourcekit',
  preflightId: 'sourcekit.package-resolution',
  preflightClass: 'dependency',
  version: '2.1.0',
  label: 'sourcekit-lsp',
  priority: 40,
  languages: ['swift'],
  kinds: ['types'],
  requires: { cmd: 'sourcekit-lsp' },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'swift',
    cmd: 'swift',
    args: ['--version'],
    label: 'Swift toolchain'
  }],
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
    const requestedCommand = resolveSourcekitRequestedCommand(ctx);
    const commandPreflight = resolveCommandProfilePreflightResult({
      providerId: 'sourcekit',
      requestedCommand,
      ctx,
      blockWhenDefinitelyMissing: true,
      blockFlag: 'blockSourcekit',
      unavailableCheck: ({ definitelyMissing }) => (
        buildSourcekitCommandUnavailableCheck({ definitelyMissing })
      )
    });
    if (commandPreflight.state === 'blocked') {
      if (commandPreflight.definitelyMissing) {
        log('[index] sourcekit-lsp not detected; skipping.');
      }
      return commandPreflight;
    }
    let commandCheck = null;
    if (commandPreflight.state !== 'ready') {
      log('[index] sourcekit-lsp command probe failed; attempting stdio initialization.');
      commandCheck = commandPreflight.check || buildSourcekitCommandUnavailableCheck({ definitelyMissing: false });
    }
    const preflight = await ensureSourcekitPackageResolutionPreflight({
      repoRoot: ctx.repoRoot,
      log,
      signal: abortSignal,
      sourcekitConfig,
      cacheRoot: ctx?.cache?.dir || null,
      timeoutMs: inputs?.preflightTimeoutMs
    });
    if (preflight?.blockSourcekit) {
      const checks = [];
      if (commandCheck) checks.push(commandCheck);
      if (preflight?.check && typeof preflight.check === 'object') checks.push(preflight.check);
      return {
        ...preflight,
        state: 'blocked',
        requestedCommand: commandPreflight.requestedCommand,
        commandProfile: commandPreflight.commandProfile,
        check: null,
        ...(checks.length ? { checks } : {})
      };
    }
    if (commandCheck) {
      return {
        ...preflight,
        state: 'degraded',
        reasonCode: 'preflight_command_unavailable',
        blockSourcekit: false,
        requestedCommand: commandPreflight.requestedCommand,
        commandProfile: commandPreflight.commandProfile,
        checks: [commandCheck]
      };
    }
    return {
      ...preflight,
      state: preflight?.state === 'degraded' ? 'degraded' : 'ready',
      requestedCommand: commandPreflight.requestedCommand,
      commandProfile: commandPreflight.commandProfile
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
        provider: { id: 'sourcekit', version: '2.1.0', configHash: this.getConfigHash(ctx) },
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
    const hoverConcurrency = Math.max(
      1,
      asFiniteInteger(sourcekitConfig.hoverConcurrency)
        ?? asFiniteInteger(runtimeConfig.hoverConcurrency)
        ?? SOURCEKIT_DEFAULT_HOVER_CONCURRENCY
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
    if (Array.isArray(preflight?.checks)) {
      for (const check of preflight.checks) {
        if (check && typeof check === 'object') checks.push(check);
      }
    }
    if (preflight?.blockSourcekit) {
      log('[tooling] sourcekit skipped because package preflight did not complete safely.');
      const admissionPolicy = resolveSourcekitAdmissionPolicy({ preflight });
      const fidelity = buildProviderFidelityContract({
        providerId: 'sourcekit',
        state: PROVIDER_FIDELITY_STATE.BLOCKED,
        preflightState: 'blocked',
        reasonCode: preflight?.reasonCode || null,
        preflightDetails: {
          state: 'blocked',
          workspaceKind: preflight?.workspaceKind || null,
          dependencyState: preflight?.dependencyState || null
        },
        captureDiagnostics: false,
        runtimeIssueClasses: resolveSourcekitRuntimeIssueClasses({
          preflight,
          checks,
          admissionPolicy
        })
      });
      return {
        provider: { id: 'sourcekit', version: '2.1.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks({
          preflight: {
            workspaceKind: preflight?.workspaceKind || null,
            dependencyState: preflight?.dependencyState || null,
            preflightState: preflight?.preflightState || null,
            reasonCode: preflight?.reasonCode || null,
            cached: preflight?.cached === true,
            classificationDurationMs: Number(preflight?.classificationDurationMs) || 0,
            resolveDurationMs: Number(preflight?.resolveDurationMs) || 0,
            markerPath: preflight?.markerPath || null
          },
          admission: admissionPolicy,
          fidelity
        }, checks)
      };
    }
    const requestedCommand = preflight?.requestedCommand && typeof preflight.requestedCommand === 'object'
      ? preflight.requestedCommand
      : resolveSourcekitRequestedCommand(ctx);
    const runtimeCommand = resolveRuntimeCommandFromPreflight({
      preflight,
      fallbackRequestedCommand: requestedCommand,
      missingProfileCheck: {
        name: 'sourcekit_preflight_command_profile_missing',
        status: 'warn',
        message: 'sourcekit preflight did not provide a resolved command profile; skipping provider.'
      }
    });
    const commandProfile = runtimeCommand.commandProfile;
    const resolvedCmd = runtimeCommand.cmd;
    const resolvedArgs = runtimeCommand.args;
    if (!resolvedCmd) {
      checks.push(...runtimeCommand.checks);
      return {
        provider: { id: 'sourcekit', version: '2.1.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    if (
      runtimeCommand.probeKnown
      && runtimeCommand.probeOk !== true
      && !checks.some((entry) => entry?.name === 'sourcekit_command_unavailable')
    ) {
      const definitelyMissing = isProbeCommandDefinitelyMissing(commandProfile?.probe);
      checks.push(buildSourcekitCommandUnavailableCheck({ definitelyMissing }));
      if (definitelyMissing) {
        log('[index] sourcekit-lsp not detected; skipping.');
        return {
          provider: { id: 'sourcekit', version: '2.1.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
      log('[index] sourcekit-lsp command probe failed; attempting stdio initialization.');
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
        const admissionPolicy = resolveSourcekitAdmissionPolicy({
          preflight,
          hostLockUnavailable: true
        });
        const fidelity = buildProviderFidelityContract({
          providerId: 'sourcekit',
          state: PROVIDER_FIDELITY_STATE.BLOCKED,
          reasonCode: 'sourcekit_host_lock_unavailable',
          captureDiagnostics: false,
          checks,
          preflightDetails: {
            state: preflight?.state || 'ready',
            workspaceKind: preflight?.workspaceKind || null,
            dependencyState: preflight?.dependencyState || null
          },
          runtimeIssueClasses: resolveSourcekitRuntimeIssueClasses({
            preflight,
            checks,
            admissionPolicy
          })
        });
        return {
          provider: { id: 'sourcekit', version: '2.1.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks({ admission: admissionPolicy, fidelity }, checks)
        };
      }
    }

    const semanticTokenStartupPolicy = shouldSuppressSourcekitSemanticTokensForStartup(
      preflight,
      sourcekitConfig,
      runtimeConfig
    );
    const admissionPolicy = resolveSourcekitAdmissionPolicy({ preflight });
    const semanticTokensEnabled = semanticTokenStartupPolicy.suppress !== true
      && !admissionPolicy.suppressedRequestClasses.includes('semanticTokens');
    const signatureHelpAdmissionEnabled = !admissionPolicy.suppressedRequestClasses.includes('signatureHelp');
    const inlayHintsEnabled = runtimeConfig.inlayHintsEnabled !== false
      && sourcekitConfig.inlayHintsEnabled !== false
      && sourcekitConfig.inlayHints !== false
      && !admissionPolicy.suppressedRequestClasses.includes('inlayHints');
    if (semanticTokenStartupPolicy.suppress && semanticTokenStartupPolicy.reasonCode === 'sourcekit_semantic_tokens_suppressed_weak_startup') {
      checks.push({
        name: 'sourcekit_semantic_tokens_suppressed_weak_startup',
        status: 'warn',
        message: semanticTokenStartupPolicy.message
      });
      log(`[tooling] ${semanticTokenStartupPolicy.message}`);
    }
    for (const check of admissionPolicy.checks) {
      checks.push(check);
    }
    if (admissionPolicy.message) {
      log(`[tooling] ${admissionPolicy.message}`);
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
        adaptiveDegradedHint: preflight?.state === 'degraded',
        adaptiveReasonHint: preflight?.reasonCode || null,
        cmd: resolvedCmd,
        args: resolvedArgs,
        hoverTimeoutMs,
        signatureHelpTimeoutMs,
        hoverEnabled,
        signatureHelpEnabled: signatureHelpEnabled && signatureHelpAdmissionEnabled,
        hoverRequireMissingReturn,
        hoverSymbolKinds,
        hoverMaxPerFile,
        hoverDisableAfterTimeouts,
        hoverConcurrency,
        semanticTokensEnabled,
        inlayHintsEnabled,
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
        command: resolvedCmd,
        args: resolvedArgs,
        toolingConfig: ctx?.toolingConfig || null
      });

      logHoverMetrics(log, result.hoverMetrics);
      const runtimeAdmissionPolicy = resolveSourcekitAdmissionPolicy({
        preflight,
        runtime: result.runtime
      });
      const fidelity = buildProviderFidelityContract({
        providerId: 'sourcekit',
        preflightState: preflight?.state || 'ready',
        reasonCode: preflight?.reasonCode || null,
        preflightDetails: {
          state: preflight?.preflightState || preflight?.state || 'ready',
          workspaceKind: preflight?.workspaceKind || null,
          dependencyState: preflight?.dependencyState || null
        },
        runtime: result.runtime,
        checks: [...checks, ...(Array.isArray(result.checks) ? result.checks : [])],
        captureDiagnostics: false,
        byChunkUid: result.byChunkUid,
        skippedRequestClasses: runtimeAdmissionPolicy.suppressedRequestClasses,
        runtimeIssueClasses: resolveSourcekitRuntimeIssueClasses({
          preflight,
          checks: [...checks, ...(Array.isArray(result.checks) ? result.checks : [])],
          semanticTokenStartupPolicy,
          runtime: result.runtime,
          admissionPolicy: runtimeAdmissionPolicy
        })
      });
      const diagnostics = appendDiagnosticChecks(
        {
          ...(result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : {}),
          preflight: {
            workspaceKind: preflight?.workspaceKind || null,
            dependencyState: preflight?.dependencyState || null,
            preflightState: preflight?.preflightState || null,
            reasonCode: preflight?.reasonCode || null,
            cached: preflight?.cached === true,
            classificationDurationMs: Number(preflight?.classificationDurationMs) || 0,
            resolveDurationMs: Number(preflight?.resolveDurationMs) || 0,
            markerPath: preflight?.markerPath || null
          },
          admission: runtimeAdmissionPolicy,
          fidelity
        },
        [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
      );
      return {
        provider: { id: 'sourcekit', version: '2.1.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: result.byChunkUid,
        diagnostics: result.runtime
          ? { ...(diagnostics || {}), runtime: result.runtime }
          : diagnostics
      };
    } finally {
      if (hostLock?.release) {
        await releaseFileLockOrThrow(hostLock);
      }
    }
  }
});
