import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILD_STATE_SCHEMA_VERSION } from '../../contracts/schemas/build-state.js';
import { RUNTIME_RECEIPT_VERSION } from './receipt.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { assertRuntimeAttempt } from '../../contracts/validators/runtime-receipt.js';
import { sanitizeRuntimeReceipt } from './receipt.js';

const TERMINAL = new Set(['succeeded', 'failed', 'aborted']);
const explainField = (attempt, field) => {
  const known = {
    'runtime.maxOldSpaceMb': attempt.runtime?.plan?.settings?.maxOldSpaceMb,
    'runtime.uvThreadpoolSize': attempt.runtime?.plan?.settings?.uvThreadpoolSize,
    'embeddings.model': { requested: attempt.embeddings?.requested, resolved: attempt.embeddings?.resolvedIdentity, observed: attempt.embeddings?.observation },
    'paths.cache': attempt.paths?.cache,
    'paths.build': attempt.paths?.build,
    'runtime.workers': attempt.runtime?.workers,
    'runtime.scheduler': attempt.runtime?.scheduler
  };
  return Object.hasOwn(known, field)
    ? { field, evidence: known[field] || null, source: 'persisted-runtime-receipt' }
    : { field, evidence: null, source: 'unknown-field', supportedFields: Object.keys(known) };
};

export const redactRuntimePaths = (value) => {
  const aliases = new Map();
  const visit = (entry, key = '') => {
    if (Array.isArray(entry)) return entry.map((child) => visit(child));
    if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([name, child]) => [name, visit(child, name)]));
    if (typeof entry === 'string' && (/path|root|selected|absolute|canonical|execPath/i.test(key)
      || path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry))) {
      if (!aliases.has(entry)) aliases.set(entry, `<path-${aliases.size + 1}>`);
      return aliases.get(entry);
    }
    return entry;
  };
  return visit(value);
};

/** Read persisted producer evidence without config reload, lock recovery or writes. */
export const readRuntimeReceipt = async ({ buildRoot, attemptId = null, mode = null, explain = null, redactPaths = false, now = Date.now(), selection = 'explicit-build-root', requireProducerIdentity = false } = {}) => {
  const receiptPath = buildRoot ? path.join(path.resolve(buildRoot), 'build_state.json') : null;
  const result = { schemaVersion: 1, evidence: 'unknown', selection, buildRoot: buildRoot || null, receiptPath, attempts: [], errorCode: null };
  if (!receiptPath) return result;
  let state;
  try {
    const handle = await fs.open(receiptPath, 'r');
    try {
      const maxBytes = 8 * 1024 * 1024;
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw Object.assign(new Error('oversized or non-file build state'), { code: 'ERR_RUNTIME_RECEIPT_SIZE' });
      const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      const afterRead = await handle.stat();
      if (total > stat.size || afterRead.size !== stat.size || afterRead.mtimeMs !== stat.mtimeMs) throw Object.assign(new Error('build state changed during read'), { code: 'ERR_RUNTIME_RECEIPT_CHANGED' });
      state = JSON.parse(buffer.subarray(0, total).toString('utf8'));
    } finally { await handle.close(); }
  } catch (error) {
    result.errorCode = String(error.code || 'ERR_RUNTIME_RECEIPT_JSON');
    return redactPaths ? redactRuntimePaths(result) : result;
  }
  if (!state || typeof state !== 'object') {
    const invalid = { ...result, errorCode: 'ERR_RUNTIME_RECEIPT_JSON' };
    return redactPaths ? redactRuntimePaths(invalid) : invalid;
  }
  // Narrow write-admission validation. Existing producer metadata is preserved,
  // not certified against the entire evolving build-state schema.
  let stateContractInvalid = false;
  if (requireProducerIdentity) {
    stateContractInvalid = state.schemaVersion !== BUILD_STATE_SCHEMA_VERSION || state.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
      || typeof state.buildId !== 'string' || !state.buildId || typeof state.buildRoot !== 'string'
      || !state.phases || typeof state.phases !== 'object' || Array.isArray(state.phases)
      || !state.progress || typeof state.progress !== 'object' || Array.isArray(state.progress);
    if (state.runtime) {
      if (state.runtime.schemaVersion !== RUNTIME_RECEIPT_VERSION || !Array.isArray(state.runtime.attempts)) stateContractInvalid = true;
      else {
        try { for (const attempt of state.runtime.attempts) assertRuntimeAttempt(attempt); }
        catch { stateContractInvalid = true; }
      }
    }
  }
  if (stateContractInvalid) {
    const corrupt = { ...result, evidence: 'corrupt-build-state', errorCode: 'ERR_RUNTIME_RECEIPT_CONTRACT' };
    return redactPaths ? redactRuntimePaths(corrupt) : corrupt;
  }
  result.buildId = typeof state.buildId === 'string' ? state.buildId : null;
  if (!state.runtime || state.runtime.schemaVersion !== RUNTIME_RECEIPT_VERSION || !Array.isArray(state.runtime.attempts)) {
    result.evidence = state.runtime ? 'unsupported-runtime-receipt' : 'legacy-artifact-inference';
    result.legacy = { buildId: state.buildId || null, tool: state.tool || null, stage: state.stage || null };
  } else {
    const invalid = state.runtime.attempts.some((attempt) => !attempt || typeof attempt !== 'object' || typeof attempt.attemptId !== 'string' || typeof attempt.lifecycle !== 'string');
    if (invalid) {
      const corrupt = { ...result, evidence: 'corrupt-runtime-receipt', errorCode: 'ERR_RUNTIME_RECEIPT_CONTRACT' };
      return redactPaths ? redactRuntimePaths(corrupt) : corrupt;
    }
    result.evidence = 'persisted-runtime-receipt';
    result.prunedAttemptCount = state.runtime.prunedAttemptCount || 0;
    result.attempts = state.runtime.attempts.slice(-16)
      .filter((attempt) => (!attemptId || attempt.attemptId === attemptId) && (!mode || attempt.mode === mode || attempt.mode == null))
      .map((attempt) => {
        const elapsedMs = now - Date.parse(attempt.updatedAt || '');
        const freshness = TERMINAL.has(attempt.lifecycle) ? 'terminal'
          : Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= 90000 ? 'recent-unverified' : 'stale-or-unknown';
        return { ...attempt, freshness, ...(explain ? { explanation: explainField(attempt, explain) } : {}) };
      });
  }
  const safe = sanitizeRuntimeReceipt(result);
  return redactPaths ? redactRuntimePaths(safe) : safe;
};

export const formatRuntimeReceiptSummary = (report) => {
  if (report.evidence !== 'persisted-runtime-receipt') return [`Runtime: ${report.evidence}${report.errorCode ? ` (${report.errorCode})` : ''}. Receipt: ${report.receiptPath || 'unknown'}`];
  const lines = [`Runtime receipt: ${report.receiptPath} (${report.selection})`];
  for (const attempt of report.attempts) {
    lines.push(`- attempt ${attempt.attemptId}: ${attempt.stage || 'unknown'}/${attempt.mode || 'all'}, ${attempt.lifecycle}, ${attempt.freshness}`);
    const heap = attempt.runtime?.observed?.heapSizeLimitBytes;
    if (heap != null) lines.push(`  V8 total heap limit: ${heap} bytes observed; launch old-space request: ${attempt.runtime?.plan?.settings?.maxOldSpaceMb?.requested?.value ?? 'unknown'} MB`);
    const workers = attempt.runtime?.workers;
    if (workers) {
      lines.push(`  Tokenization: ${workers.tokenizationExecution || 'unknown'}; quantization: ${workers.quantizationExecution || 'unknown'}; embedding inference: separate provider owner`);
      for (const decision of Object.values(workers.launchDecisions || {})) {
        if (decision.heapLaunchContract?.fallback) lines.push(`  Worker fallback: ${decision.heapLaunchContract.reason}; requested=${decision.heapLaunchContract.requestedOldGenerationSizeMb} MB, parent startup=${decision.heapLaunchContract.parentStartupOldSpaceMb ?? 'unknown'} MB`);
      }
    }
    const model = attempt.embeddings?.resolvedIdentity?.modelId || attempt.embeddings?.requested?.modelId;
    lines.push(`  Embeddings: selected=${model || 'unknown'}, observed=${attempt.embeddings?.observation?.state || 'unknown'}`);
    if (attempt.explanation) lines.push(`  ${attempt.explanation.field}: ${JSON.stringify(attempt.explanation.evidence)}`);
  }
  return lines;
};

export const listRuntimeReceipts = async ({ repoCacheRoot, publishedRoots = [], mode = null, attemptId = null, explain = null, redactPaths = false } = {}) => {
  const selected = new Map(publishedRoots.filter(Boolean).map((root) => [path.resolve(root), 'published-mode-root']));
  let truncated = false;
  try {
    const entries = await fs.opendir(path.join(repoCacheRoot, 'builds'));
    let seen = 0;
    for await (const entry of entries) {
      if (++seen > 128 || selected.size >= 32) { truncated = true; break; }
      if (entry.isDirectory()) {
        const root = path.resolve(repoCacheRoot, 'builds', entry.name);
        if (!selected.has(root)) selected.set(root, 'unpublished-candidate');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') return { schemaVersion: 1, receipts: [], truncated: false, errorCode: String(error.code || 'UNKNOWN') };
  }
  if (!selected.size) selected.set(path.resolve(repoCacheRoot), 'legacy-repo-cache-root');
  const receipts = [];
  for (const [buildRoot, selection] of selected) receipts.push(await readRuntimeReceipt({ buildRoot, selection, mode, attemptId, explain, redactPaths }));
  return { schemaVersion: 1, receipts, truncated };
};
