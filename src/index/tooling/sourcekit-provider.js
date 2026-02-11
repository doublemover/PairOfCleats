import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execaSync } from 'execa';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { isTestingEnv } from '../../shared/env.js';
import { acquireFileLock } from '../../shared/locks/file-lock.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { parseSwiftSignature } from './signature-parse/swift.js';

export const SWIFT_EXTS = ['.swift'];

const SOURCEKIT_HOST_LOCK_STALE_MS = 15 * 60 * 1000;
const SOURCEKIT_HOST_LOCK_WAIT_MS = 2 * 60 * 1000;
const SOURCEKIT_HOST_LOCK_POLL_MS = 250;
const SOURCEKIT_DEFAULT_HOVER_TIMEOUT_MS = 3500;
const SOURCEKIT_DEFAULT_HOVER_MAX_PER_FILE = 10;
const SOURCEKIT_DEFAULT_HOVER_DISABLE_AFTER_TIMEOUTS = 2;
const SOURCEKIT_TOP_OFFENDER_LIMIT = 8;

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
  return execaSync(commandLine, {
    stdio: 'ignore',
    shell: true,
    reject: false
  });
};

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asFiniteInteger = (value) => {
  const parsed = asFiniteNumber(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const canRunSourcekit = (cmd) => {
  try {
    const result = runProbeCommand(cmd, ['--help']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

const acquireHostSourcekitLock = async ({
  lockPath,
  waitMs = SOURCEKIT_HOST_LOCK_WAIT_MS,
  pollMs = SOURCEKIT_HOST_LOCK_POLL_MS,
  staleMs = SOURCEKIT_HOST_LOCK_STALE_MS,
  log = () => {}
}) => {
  const lock = await acquireFileLock({
    lockPath,
    waitMs,
    pollMs,
    staleMs,
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
    const sourcekitConfig = ctx?.toolingConfig?.sourcekit || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => SWIFT_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'sourcekit' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const resolvedCmd = resolveCommand('sourcekit-lsp');
    if (!canRunSourcekit(resolvedCmd)) {
      log('[index] sourcekit-lsp not detected; skipping tooling-based types.');
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const globalTimeoutMs = asFiniteNumber(ctx?.toolingConfig?.timeoutMs);
    const providerTimeoutMs = asFiniteNumber(sourcekitConfig.timeoutMs);
    const timeoutMs = Math.max(30000, providerTimeoutMs ?? globalTimeoutMs ?? 45000);
    const retries = Number.isFinite(Number(sourcekitConfig.maxRetries))
      ? Math.max(0, Math.floor(Number(sourcekitConfig.maxRetries)))
      : (ctx?.toolingConfig?.maxRetries ?? 2);
    const breakerThreshold = Number.isFinite(Number(sourcekitConfig.circuitBreakerThreshold))
      ? Math.max(1, Math.floor(Number(sourcekitConfig.circuitBreakerThreshold)))
      : (ctx?.toolingConfig?.circuitBreakerThreshold ?? 3);
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
        log
      });
      if (!hostLock) {
        log('[tooling] sourcekit host lock wait elapsed; continuing without lock.');
      }
    }

    try {
      const result = await collectLspTypes({
        rootDir: ctx.repoRoot,
        documents: docs,
        targets,
        log,
        cmd: resolvedCmd,
        args: [],
        timeoutMs,
        retries,
        breakerThreshold,
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
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: result.byChunkUid,
        diagnostics: appendDiagnosticChecks(
          result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : null,
          [...duplicateChecks, ...(Array.isArray(result.checks) ? result.checks : [])]
        )
      };
    } finally {
      if (hostLock?.release) {
        await hostLock.release();
      }
    }
  }
});
