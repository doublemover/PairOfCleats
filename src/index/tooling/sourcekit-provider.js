import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execaSync } from 'execa';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { isTestingEnv } from '../../shared/env.js';
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const result = execaSync(cmd, ['--help'], {
      stdio: 'ignore',
      shell: shouldUseShell(cmd),
      reject: false
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err?.code === 'EPERM') return true;
    return false;
  }
  if (process.platform !== 'win32') return true;
  try {
    const result = spawnSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (result.error) return true;
    const output = String(result.stdout || '').trim();
    if (!output || /INFO:\s+No tasks are running/i.test(output)) return false;
    const line = output.split(/\r?\n/)[0] || '';
    const parts = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
    const parsedPid = Number(parts[1] || '');
    return Number.isFinite(parsedPid) ? parsedPid === pid : true;
  } catch {
    return true;
  }
};

const readLockInfo = async (lockPath) => {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const isLockStale = async (lockPath, staleMs) => {
  try {
    const info = await readLockInfo(lockPath);
    const startedAt = info?.startedAt ? Date.parse(info.startedAt) : null;
    if (Number.isFinite(startedAt) && Date.now() - startedAt > staleMs) return true;
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
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
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      const payload = {
        pid: process.pid,
        startedAt: new Date().toISOString()
      };
      await handle.writeFile(JSON.stringify(payload));
      await handle.close();
      return {
        release: async () => {
          try {
            const info = await readLockInfo(lockPath);
            if (Number(info?.pid) === process.pid) {
              await fs.rm(lockPath, { force: true });
            }
          } catch {}
        }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const stale = await isLockStale(lockPath, staleMs);
      const info = await readLockInfo(lockPath);
      const ownerPid = Number(info?.pid);
      const ownerAlive = isProcessAlive(ownerPid);
      if (stale || (Number.isFinite(ownerPid) && ownerPid > 0 && !ownerAlive)) {
        try {
          await fs.rm(lockPath, { force: true });
          log('[tooling] sourcekit host lock stale; removed.');
          continue;
        } catch {}
      }
      if (Date.now() >= deadline) return null;
      await sleep(Math.max(50, pollMs));
    }
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
          duplicateChecks
        )
      };
    } finally {
      if (hostLock?.release) {
        await hostLock.release();
      }
    }
  }
});
