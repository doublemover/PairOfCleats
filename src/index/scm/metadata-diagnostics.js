import { redactDiagnosticText } from '../../shared/diagnostic-text.js';

const count = (value) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const text = (value, limit) => typeof value === 'string' ? redactDiagnosticText(value, limit).replace(/\s+/gu, ' ') : null;

export const buildScmMetadataFailure = (error, operation) => ({
  operation: text(operation || error?.operation, 64),
  code: text(error?.code || error?.name, 96),
  message: text(error?.message, 384),
  truncated: error?.truncated === true || (typeof error?.message === 'string' && error.message.length > 384)
});

/** Keep fixed, bounded fields; never serialize command environments or whole error objects. */
export const normalizeScmMetadataDiagnostics = (value) => ({
  timeoutCount: count(value?.timeoutCount),
  timeoutRetries: count(value?.timeoutRetries),
  cooldownSkips: count(value?.cooldownSkips),
  unavailableChunks: count(value?.unavailableChunks),
  timeoutHeatmap: (Array.isArray(value?.timeoutHeatmap) ? value.timeoutHeatmap : []).slice(0, 32)
    .map((entry) => ({ file: text(entry?.file, 256), timeouts: count(entry?.timeouts),
      retries: count(entry?.retries), cooldownSkips: count(entry?.cooldownSkips),
      lastTimeoutMs: Number.isFinite(entry?.lastTimeoutMs) ? entry.lastTimeoutMs : null })),
  failureCount: count(value?.failureCount),
  failures: (Array.isArray(value?.failures) ? value.failures : []).slice(0, 8)
    .map((failure) => buildScmMetadataFailure(failure, failure?.operation)),
  truncated: value?.truncated === true || (value?.timeoutHeatmap?.length || 0) > 32 || (value?.failures?.length || 0) > 8
});

export const preserveScmMetadataFailure = (result, error = null, operation = null) => ({
  ...(error ? { failure: buildScmMetadataFailure(error, operation) }
    : result?.failure ? { failure: buildScmMetadataFailure(result.failure, operation || result.failure.operation) } : {}),
  ...(result?.diagnostics ? { diagnostics: normalizeScmMetadataDiagnostics(result.diagnostics) } : {})
});

/** The stage timing surface retains this fixed projection after per-run caches are cleaned. */
export const buildScmMetadataObservation = (stats) => ({
  source: text(stats?.source, 32),
  requested: count(stats?.requested), reused: count(stats?.reused), fetched: count(stats?.fetched),
  unresolvedFiles: count(stats?.unresolvedFiles),
  batchReason: text(stats?.batchReason, 64),
  batchFailure: stats?.batchFailure ? buildScmMetadataFailure(stats.batchFailure) : null,
  batch: normalizeScmMetadataDiagnostics(stats),
  perFile: {
    attempted: count(stats?.perFileDiagnostics?.attempted),
    complete: count(stats?.perFileDiagnostics?.complete),
    unavailable: count(stats?.perFileDiagnostics?.unavailable),
    failures: (Array.isArray(stats?.perFileDiagnostics?.failures) ? stats.perFileDiagnostics.failures : []).slice(0, 8)
      .map((failure) => buildScmMetadataFailure(failure)),
    truncated: stats?.perFileDiagnostics?.truncated === true || (stats?.perFileDiagnostics?.failures?.length || 0) > 8
  }
});
