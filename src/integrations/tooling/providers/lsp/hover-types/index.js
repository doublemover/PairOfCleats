import { throwIfAborted } from '../../../../../shared/abort.js';
import { rangeToOffsets } from '../../../lsp/positions.js';
import { flattenSymbols } from '../../../lsp/symbols.js';
import { findTargetForOffsets } from '../target-index.js';
import {
  decodeSemanticTokens,
  findSemanticTokenAtPosition,
  parseInlayHintSignalInfo
} from '../semantic-signals.js';
import {
  buildFallbackReasonCodes,
  buildLspProvenanceEntry,
  buildLspSymbolRef,
  countParamTypeConflicts,
  createEmptyHoverMetricsResult,
  isIncompleteTypePayload,
  mergeSignatureInfo,
  normalizeParamNames,
  normalizeParamTypes,
  normalizeTypeText,
  scoreChunkPayloadCandidate,
  scoreLspConfidence,
  scoreSignatureInfo
} from './payload-policy.js';
import {
  DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES,
  LSP_REQUEST_CACHE_POLICY_VERSION,
  buildLspRequestCacheKey,
  buildSignatureParseCacheKey,
  buildSymbolPositionCacheKey,
  loadLspRequestCache,
  normalizeSignatureCacheText,
  persistLspRequestCache,
  readRequestCacheEntry,
  writeRequestCacheEntry
} from './cache.js';
import {
  DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
  DEFAULT_HOVER_CONCURRENCY,
  clampIntRange,
  createConcurrencyLimiter,
  createRequestBudgetController,
  runWithConcurrency,
  toFiniteInt
} from './concurrency.js';
import { createHoverFileStats, summarizeHoverMetrics } from './metrics.js';
import {
  buildLineSignatureCandidate,
  buildSourceSignatureCandidate,
  defaultParamConfidenceForTier,
  resolveEvidenceConfidenceTier,
  resolveEvidenceTier,
  resolveProviderStabilityTier,
  resolveRecordCandidate,
  scoreEvidenceTier
} from './merge.js';
import {
  emitToolingRequestSignal,
  extractDefinitionLocations,
  extractSignatureHelpText,
  handleStageRequestError,
  normalizeHoverContents,
  recordCircuitOpenCheck,
  recordCrashLoopCheck,
  recordDocumentSymbolFailureCheck,
  recordSoftDeadlineCheck
} from './stages.js';

export {
  buildFallbackReasonCodes,
  buildLspProvenanceEntry,
  buildLspSymbolRef,
  countParamTypeConflicts,
  createEmptyHoverMetricsResult,
  isIncompleteTypePayload,
  mergeSignatureInfo,
  normalizeParamNames,
  normalizeParamTypes,
  normalizeTypeText,
  scoreChunkPayloadCandidate,
  scoreLspConfidence,
  scoreSignatureInfo
} from './payload-policy.js';
export {
  DEFAULT_LSP_REQUEST_CACHE_MAX_ENTRIES,
  LSP_REQUEST_CACHE_POLICY_VERSION,
  buildLspRequestCacheKey,
  buildSignatureParseCacheKey,
  buildSymbolPositionCacheKey,
  loadLspRequestCache,
  normalizeSignatureCacheText,
  persistLspRequestCache,
  readRequestCacheEntry,
  writeRequestCacheEntry
} from './cache.js';
export {
  DEFAULT_DOCUMENT_SYMBOL_CONCURRENCY,
  DEFAULT_HOVER_CONCURRENCY,
  clampIntRange,
  createConcurrencyLimiter,
  createRequestBudgetController,
  runWithConcurrency,
  toFiniteInt
} from './concurrency.js';
export { createHoverFileStats, summarizeHoverMetrics } from './metrics.js';
export {
  buildLineSignatureCandidate,
  buildSourceSignatureCandidate,
  defaultParamConfidenceForTier,
  resolveEvidenceConfidenceTier,
  resolveEvidenceTier,
  resolveProviderStabilityTier,
  resolveRecordCandidate,
  scoreEvidenceTier
} from './merge.js';
export {
  emitToolingRequestSignal,
  extractDefinitionLocations,
  extractSignatureHelpText,
  handleStageRequestError,
  normalizeHoverContents,
  recordCircuitOpenCheck,
  recordCrashLoopCheck,
  recordDocumentSymbolFailureCheck,
  recordSoftDeadlineCheck
} from './stages.js';

const FUNCTION_LIKE_SYMBOL_KINDS = new Set([6, 9, 12]);

export const normalizeHoverKinds = (kinds) => {
  if (kinds == null) return null;
  const source = Array.isArray(kinds) ? kinds : [kinds];
  const normalized = source
    .map((entry) => toFiniteInt(entry, 0))
    .filter((entry) => Number.isFinite(entry));
  if (!normalized.length) return null;
  return new Set(normalized);
};

/**
 * Enrich chunk payloads for one document using symbol + hover information.
 *
 * Fallback semantics:
 * 1. documentSymbol errors are soft-failed per document.
 * 2. hover/signatureHelp/definition/typeDefinition/references requests are deduped by
 *    position and can be suppressed by:
 *    return-type sufficiency, kind filters, per-file budget, adaptive timeout,
 *    or global timeout circuit.
 * 3. source-signature fallback runs only after hover/signatureHelp/definition/
 *    typeDefinition/references attempts still leave the payload incomplete.
 * 4. strict mode throws only when resolved symbol data cannot be mapped to a
 *    chunk uid.
 * 5. provider-level documentSymbol failure disables further documentSymbol work
 *    for the remaining documents in the same collection pass.
 *
 * @param {object} input
 * @returns {Promise<{enrichedDelta:number}>}
 */
export const processDocumentTypes = async ({
  doc,
  cmd,
  client,
  guard,
  guardRun,
  log,
  strict,
  parseSignature,
  lineIndexFactory,
  uri,
  legacyUri,
  languageId,
  openDocs,
  targetIndexesByPath,
  byChunkUid,
  signatureParseCache,
  hoverEnabled,
  semanticTokensEnabled,
  signatureHelpEnabled,
  inlayHintsEnabled,
  definitionEnabled,
  typeDefinitionEnabled,
  referencesEnabled,
  docPathPolicy = null,
  hoverRequireMissingReturn,
  resolvedHoverKinds,
  resolvedHoverMaxPerFile,
  resolvedHoverDisableAfterTimeouts,
  resolvedHoverTimeout,
  resolvedSignatureHelpTimeout,
  resolvedDefinitionTimeout,
  resolvedTypeDefinitionTimeout,
  resolvedReferencesTimeout,
  resolvedDocumentSymbolTimeout,
  hoverLimiter,
  signatureHelpLimiter,
  definitionLimiter,
  typeDefinitionLimiter,
  referencesLimiter,
  requestCacheEntries,
  requestCachePersistedKeys,
  requestCacheMetrics,
  markRequestCacheDirty,
  requestBudgetControllers = null,
  requestCacheContext = null,
  providerConfidenceBias = 0,
  semanticTokensLegend = null,
  hoverControl,
  documentSymbolControl = null,
  hoverFileStats,
  hoverLatencyMs,
  hoverMetrics,
  symbolProcessingConcurrency = 8,
  softDeadlineAt = null,
  positionEncoding = 'utf-16',
  checks,
  checkFlags,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  if (guard.isOpen()) return { enrichedDelta: 0 };
  let openedHere = false;
  const runGuarded = typeof guardRun === 'function'
    ? guardRun
    : ((fn, options) => guard.run(fn, options));

  const docTargetIndex = targetIndexesByPath.get(doc.virtualPath) || null;
  const interactiveAllowed = docPathPolicy?.suppressInteractive !== true;
  const fileHoverStats = hoverFileStats.get(doc.virtualPath) || createHoverFileStats();
  hoverFileStats.set(doc.virtualPath, fileHoverStats);
  const parseCache = signatureParseCache instanceof Map ? signatureParseCache : null;
  const signatureParserKey = String(parseSignature?.cacheKey || parseSignature?.name || 'default').trim() || 'default';
  const signatureParserSymbolSensitive = parseSignature?.isSymbolSensitive !== false;

  const parseSignatureCached = (detailText, symbolName) => {
    if (typeof parseSignature !== 'function') return null;
    const cacheKey = buildSignatureParseCacheKey({
      languageId,
      detailText,
      symbolName,
      parserKey: signatureParserKey,
      symbolSensitive: signatureParserSymbolSensitive
    });
    if (!cacheKey) return null;
    if (parseCache?.has(cacheKey)) {
      return parseCache.get(cacheKey);
    }
    const normalizedDetail = normalizeSignatureCacheText(detailText);
    const parsed = parseSignature(normalizedDetail, languageId, symbolName) || null;
    if (parseCache) parseCache.set(cacheKey, parsed);
    return parsed;
  };

  try {
    throwIfAborted(abortSignal);
    if (documentSymbolControl?.disabled === true) {
      return { enrichedDelta: 0 };
    }
    if (docPathPolicy?.skipDocumentSymbol === true) {
      return { enrichedDelta: 0 };
    }
    if (!openDocs.has(doc.virtualPath)) {
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: doc.text || ''
        }
      });
      openDocs.set(doc.virtualPath, {
        uri,
        legacyUri,
        lineIndex: null,
        text: doc.text || ''
      });
      openedHere = true;
    }
    const documentSymbolBudget = requestBudgetControllers?.documentSymbol || null;
    if (
      documentSymbolBudget
      && typeof documentSymbolBudget.tryReserve === 'function'
      && !documentSymbolBudget.tryReserve()
    ) {
      return { enrichedDelta: 0 };
    }
    let symbols = null;
    try {
      symbols = await runGuarded(
        ({ timeoutMs: guardTimeout }) => client.request(
          'textDocument/documentSymbol',
          { textDocument: { uri } },
          { timeoutMs: guardTimeout }
        ),
        {
          label: 'documentSymbol',
          ...(resolvedDocumentSymbolTimeout ? { timeoutOverride: resolvedDocumentSymbolTimeout } : {})
        }
      );
    } catch (err) {
      log(`[index] ${cmd} documentSymbol failed (${doc.virtualPath}): ${err?.message || err}`);
      emitToolingRequestSignal({
        log,
        providerId: requestCacheProviderId,
        requestMethod: 'textDocument/documentSymbol',
        stageKey: 'documentSymbol',
        workspaceKey: requestCacheWorkspaceKey,
        failureClass: isTimeoutError(err) ? 'timeout' : (err?.code || 'request_failed'),
        kind: isTimeoutError(err) ? 'timeout' : 'failed',
        err
      });
      if (documentSymbolControl && typeof documentSymbolControl === 'object') {
        documentSymbolControl.disabled = true;
      }
      if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
        recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
      } else if (err?.code === 'TOOLING_CRASH_LOOP') {
        recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
      } else {
        recordDocumentSymbolFailureCheck({ cmd, checks, checkFlags, err });
      }
      return { enrichedDelta: 0 };
    }

    const flattened = flattenSymbols(symbols || []);
    if (!flattened.length) {
      return { enrichedDelta: 0 };
    }

    const openEntry = openDocs.get(doc.virtualPath) || null;
    const lineIndex = openEntry?.lineIndex || lineIndexFactory(openEntry?.text || doc.text || '');
    if (openEntry && !openEntry.lineIndex) openEntry.lineIndex = lineIndex;
    const docText = openEntry?.text || doc.text || '';
    const hoverRequestByPosition = new Map();
    let semanticTokensRequest = null;
    const signatureHelpRequestByPosition = new Map();
    let inlayHintsRequest = null;
    const definitionRequestByPosition = new Map();
    const typeDefinitionRequestByPosition = new Map();
    const referencesRequestByPosition = new Map();
    const symbolRecords = [];
    const budgetControllers = requestBudgetControllers && typeof requestBudgetControllers === 'object'
      ? requestBudgetControllers
      : Object.create(null);
    const hoverBudget = budgetControllers.hover || createRequestBudgetController(resolvedHoverMaxPerFile);
    const semanticTokensBudget = budgetControllers.semanticTokens || createRequestBudgetController(null);
    const signatureHelpBudget = budgetControllers.signatureHelp || createRequestBudgetController(null);
    const inlayHintsBudget = budgetControllers.inlayHints || createRequestBudgetController(null);
    const definitionBudget = budgetControllers.definition || createRequestBudgetController(null);
    const typeDefinitionBudget = budgetControllers.typeDefinition || createRequestBudgetController(null);
    const referencesBudget = budgetControllers.references || createRequestBudgetController(null);
    const requestCacheProviderId = requestCacheContext?.providerId || cmd;
    const requestCacheProviderVersion = requestCacheContext?.providerVersion || null;
    const requestCacheWorkspaceKey = requestCacheContext?.workspaceKey || null;
    const isSoftDeadlineExpired = () => (
      softDeadlineAt != null
      && Number.isFinite(Number(softDeadlineAt))
      && Date.now() >= Number(softDeadlineAt)
    );
    const recordSoftDeadlineSkip = () => {
      fileHoverStats.skippedBySoftDeadline += 1;
      hoverMetrics.skippedBySoftDeadline += 1;
    };
    const markSoftDeadlineReached = () => {
      hoverControl.disabledGlobal = true;
      recordSoftDeadlineCheck({
        cmd,
        checks,
        checkFlags,
        softDeadlineAt
      });
    };
    const reserveRequestBudget = (controller) => {
      if (!controller || typeof controller.tryReserve !== 'function' || controller.tryReserve()) return true;
      fileHoverStats.skippedByBudget += 1;
      hoverMetrics.skippedByBudget += 1;
      return false;
    };
    const buildRequestCacheKeyForStage = (requestKind, position) => buildLspRequestCacheKey({
      providerId: requestCacheProviderId,
      providerVersion: requestCacheProviderVersion,
      workspaceKey: requestCacheWorkspaceKey,
      docHash: doc.docHash || null,
      requestKind,
      position
    });
    const tryReadRequestCache = (requestKind, position) => readRequestCacheEntry({
      requestCacheEntries,
      requestCachePersistedKeys,
      requestCacheMetrics,
      cacheKey: buildRequestCacheKeyForStage(requestKind, position),
      requestKind
    });
    const writePositiveRequestCache = (requestKind, position, info) => {
      writeRequestCacheEntry({
        requestCacheEntries,
        requestCacheMetrics,
        markRequestCacheDirty,
        cacheKey: buildRequestCacheKeyForStage(requestKind, position),
        requestKind,
        info
      });
    };
    const writeNegativeRequestCache = (requestKind, position, ttlMs = null) => {
      writeRequestCacheEntry({
        requestCacheEntries,
        requestCacheMetrics,
        markRequestCacheDirty,
        cacheKey: buildRequestCacheKeyForStage(requestKind, position),
        requestKind,
        negative: true,
        ttlMs
      });
    };
    const resolveDocumentEndPosition = () => {
      const lines = String(openEntry?.text || doc.text || '').split(/\r?\n/u);
      const lastLineIndex = Math.max(0, lines.length - 1);
      return {
        line: lastLineIndex,
        character: String(lines[lastLineIndex] || '').length
      };
    };

    const requestHover = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (hoverRequestByPosition.has(key)) return hoverRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(hoverBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedHoverInfo = tryReadRequestCache('hover', position);
      const promise = (async () => {
        if (cachedHoverInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedHoverInfo?.info) {
          return { attempted: true, info: cachedHoverInfo.info };
        }

        const hoverTimeoutOverride = Number.isFinite(resolvedHoverTimeout)
          ? resolvedHoverTimeout
          : null;
        fileHoverStats.requested += 1;
        hoverMetrics.requested += 1;
        const hoverStartMs = Date.now();

        try {
          throwIfAborted(abortSignal);
          const hover = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/hover', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'hover', ...(hoverTimeoutOverride ? { timeoutOverride: hoverTimeoutOverride } : {}) }
          ));
          const hoverDurationMs = Date.now() - hoverStartMs;
          hoverLatencyMs.push(hoverDurationMs);
          fileHoverStats.latencyMs.push(hoverDurationMs);
          fileHoverStats.succeeded += 1;
          hoverMetrics.succeeded += 1;
          const hoverText = normalizeHoverContents(hover?.contents);
          const hoverInfo = parseSignatureCached(hoverText, symbol?.name);
          if (hoverInfo) writePositiveRequestCache('hover', position, hoverInfo);
          else writeNegativeRequestCache('hover', position);
          return { attempted: true, info: hoverInfo };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'hover',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('hover', position);
          return { attempted: true, info };
        }
      })();
      hoverRequestByPosition.set(key, promise);
      return promise;
    };

    const requestSemanticTokens = () => {
      throwIfAborted(abortSignal);
      if (semanticTokensRequest) return semanticTokensRequest;
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve(null);
      }
      if (!reserveRequestBudget(semanticTokensBudget)) return Promise.resolve(null);
      fileHoverStats.semanticTokensRequested += 1;
      hoverMetrics.semanticTokensRequested += 1;
      semanticTokensRequest = (async () => {
        try {
          throwIfAborted(abortSignal);
          const payload = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/semanticTokens/full', {
              textDocument: { uri }
            }, { timeoutMs: guardTimeout }),
            { label: 'semanticTokens', ...(resolvedHoverTimeout ? { timeoutOverride: resolvedHoverTimeout } : {}) }
          ));
          const decoded = decodeSemanticTokens({
            data: payload?.data,
            legend: semanticTokensLegend,
            providerId: requestCacheProviderId
          });
          fileHoverStats.semanticTokensSucceeded += 1;
          hoverMetrics.semanticTokensSucceeded += 1;
          return decoded;
        } catch (err) {
          handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'semantic_tokens',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          return null;
        }
      })();
      return semanticTokensRequest;
    };

    const requestSignatureHelp = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (signatureHelpRequestByPosition.has(key)) return signatureHelpRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(signatureHelpBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedSignatureHelpInfo = tryReadRequestCache('signature_help', position);
      const runSignatureHelp = typeof signatureHelpLimiter === 'function'
        ? signatureHelpLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedSignatureHelpInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedSignatureHelpInfo?.info) {
          return { attempted: true, info: cachedSignatureHelpInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedSignatureHelpTimeout)
          ? resolvedSignatureHelpTimeout
          : null;
        fileHoverStats.signatureHelpRequested += 1;
        hoverMetrics.signatureHelpRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const signatureHelp = await runSignatureHelp(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/signatureHelp', {
              textDocument: { uri },
              position,
              context: {
                triggerKind: 1,
                isRetrigger: false,
                activeSignatureHelp: null
              }
            }, { timeoutMs: guardTimeout }),
            { label: 'signatureHelp', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          fileHoverStats.signatureHelpSucceeded += 1;
          hoverMetrics.signatureHelpSucceeded += 1;
          const signatureText = extractSignatureHelpText(signatureHelp);
          const info = parseSignatureCached(signatureText, symbol?.name);
          if (info) writePositiveRequestCache('signature_help', position, info);
          else writeNegativeRequestCache('signature_help', position);
          return { attempted: true, info };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'signature_help',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('signature_help', position);
          return { attempted: true, info };
        }
      })();
      signatureHelpRequestByPosition.set(key, promise);
      return promise;
    };

    const requestInlayHints = () => {
      throwIfAborted(abortSignal);
      if (inlayHintsRequest) return inlayHintsRequest;
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve(null);
      }
      if (!reserveRequestBudget(inlayHintsBudget)) return Promise.resolve(null);
      fileHoverStats.inlayHintsRequested += 1;
      hoverMetrics.inlayHintsRequested += 1;
      inlayHintsRequest = (async () => {
        try {
          throwIfAborted(abortSignal);
          const payload = await hoverLimiter(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/inlayHint', {
              textDocument: { uri },
              range: {
                start: { line: 0, character: 0 },
                end: resolveDocumentEndPosition()
              }
            }, { timeoutMs: guardTimeout }),
            { label: 'inlayHints', ...(resolvedHoverTimeout ? { timeoutOverride: resolvedHoverTimeout } : {}) }
          ));
          const hints = Array.isArray(payload) ? payload : [];
          fileHoverStats.inlayHintsSucceeded += 1;
          hoverMetrics.inlayHintsSucceeded += 1;
          return hints;
        } catch (err) {
          handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'inlay_hints',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          return null;
        }
      })();
      return inlayHintsRequest;
    };

    const requestDefinition = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (definitionRequestByPosition.has(key)) return definitionRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(definitionBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedDefinitionInfo = tryReadRequestCache('definition', position);
      const runDefinition = typeof definitionLimiter === 'function'
        ? definitionLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedDefinitionInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedDefinitionInfo?.info) {
          return { attempted: true, info: cachedDefinitionInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedDefinitionTimeout)
          ? resolvedDefinitionTimeout
          : null;
        fileHoverStats.definitionRequested += 1;
        hoverMetrics.definitionRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runDefinition(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/definition', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'definition', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const definitionUris = new Set([String(uri || '')]);
          if (legacyUri) definitionUris.add(String(legacyUri));
          for (const location of locations) {
            if (!definitionUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null, {
              text: docText,
              positionEncoding
            });
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              writePositiveRequestCache('definition', position, info);
              fileHoverStats.definitionSucceeded += 1;
              hoverMetrics.definitionSucceeded += 1;
              return { attempted: true, info };
            }
          }
          writeNegativeRequestCache('definition', position);
          return { attempted: true, info: null };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'definition',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('definition', position);
          return { attempted: true, info };
        }
      })();
      definitionRequestByPosition.set(key, promise);
      return promise;
    };

    const requestTypeDefinition = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (typeDefinitionRequestByPosition.has(key)) return typeDefinitionRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(typeDefinitionBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedTypeDefinitionInfo = tryReadRequestCache('type_definition', position);
      const runTypeDefinition = typeof typeDefinitionLimiter === 'function'
        ? typeDefinitionLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedTypeDefinitionInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedTypeDefinitionInfo?.info) {
          return { attempted: true, info: cachedTypeDefinitionInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedTypeDefinitionTimeout)
          ? resolvedTypeDefinitionTimeout
          : null;
        fileHoverStats.typeDefinitionRequested += 1;
        hoverMetrics.typeDefinitionRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runTypeDefinition(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/typeDefinition', {
              textDocument: { uri },
              position
            }, { timeoutMs: guardTimeout }),
            { label: 'typeDefinition', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const definitionUris = new Set([String(uri || '')]);
          if (legacyUri) definitionUris.add(String(legacyUri));
          for (const location of locations) {
            if (!definitionUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null, {
              text: docText,
              positionEncoding
            });
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              writePositiveRequestCache('type_definition', position, info);
              fileHoverStats.typeDefinitionSucceeded += 1;
              hoverMetrics.typeDefinitionSucceeded += 1;
              return { attempted: true, info };
            }
          }
          writeNegativeRequestCache('type_definition', position);
          return { attempted: true, info: null };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'type_definition',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('type_definition', position);
          return { attempted: true, info };
        }
      })();
      typeDefinitionRequestByPosition.set(key, promise);
      return promise;
    };

    const requestReferences = (symbol, position) => {
      throwIfAborted(abortSignal);
      const key = buildSymbolPositionCacheKey({
        position
      });
      if (!key) return Promise.resolve({ attempted: false, info: null });
      if (referencesRequestByPosition.has(key)) return referencesRequestByPosition.get(key);
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return Promise.resolve({ attempted: false, info: null });
      }
      if (!reserveRequestBudget(referencesBudget)) return Promise.resolve({ attempted: false, info: null });
      const cachedReferencesInfo = tryReadRequestCache('references', position);
      const runReferences = typeof referencesLimiter === 'function'
        ? referencesLimiter
        : hoverLimiter;
      const promise = (async () => {
        if (cachedReferencesInfo?.negative === true) {
          return { attempted: false, info: null };
        }
        if (cachedReferencesInfo?.info) {
          return { attempted: true, info: cachedReferencesInfo.info };
        }
        const timeoutOverride = Number.isFinite(resolvedReferencesTimeout)
          ? resolvedReferencesTimeout
          : null;
        fileHoverStats.referencesRequested += 1;
        hoverMetrics.referencesRequested += 1;
        try {
          throwIfAborted(abortSignal);
          const payload = await runReferences(() => runGuarded(
            ({ timeoutMs: guardTimeout }) => client.request('textDocument/references', {
              textDocument: { uri },
              position,
              context: { includeDeclaration: true }
            }, { timeoutMs: guardTimeout }),
            { label: 'references', ...(timeoutOverride ? { timeoutOverride } : {}) }
          ));
          const locations = extractDefinitionLocations(payload);
          if (!locations.length) return null;
          const referenceUris = new Set([String(uri || '')]);
          if (legacyUri) referenceUris.add(String(legacyUri));
          for (const location of locations) {
            if (!referenceUris.has(String(location?.uri || ''))) continue;
            const locationOffsets = rangeToOffsets(lineIndex, location?.range || null, {
              text: docText,
              positionEncoding
            });
            let candidate = buildSourceSignatureCandidate(
              openEntry?.text || doc.text || '',
              locationOffsets
            );
            if (!candidate) {
              const fallbackLine = Number(location?.range?.start?.line);
              candidate = buildLineSignatureCandidate(openEntry?.text || doc.text || '', fallbackLine);
            }
            const info = parseSignatureCached(candidate, symbol?.name);
            if (info) {
              writePositiveRequestCache('references', position, info);
              fileHoverStats.referencesSucceeded += 1;
              hoverMetrics.referencesSucceeded += 1;
              return { attempted: true, info };
            }
          }
          writeNegativeRequestCache('references', position);
          return { attempted: true, info: null };
        } catch (err) {
          const info = handleStageRequestError({
            err,
            log,
            providerId: requestCacheProviderId,
            cmd,
            stageKey: 'references',
            workspaceKey: requestCacheWorkspaceKey,
            guard,
            checks,
            checkFlags,
            fileHoverStats,
            hoverMetrics,
            hoverControl,
            resolvedHoverDisableAfterTimeouts
          });
          writeNegativeRequestCache('references', position);
          return { attempted: true, info };
        }
      })();
      referencesRequestByPosition.set(key, promise);
      return promise;
    };

    for (const symbol of flattened) {
      throwIfAborted(abortSignal);
      const offsets = rangeToOffsets(lineIndex, symbol.selectionRange || symbol.range, {
        text: docText,
        positionEncoding
      });
      const target = findTargetForOffsets(docTargetIndex, offsets, symbol.name);
      if (!target) continue;

      const detailText = symbol.detail || symbol.name;
      let info = parseSignatureCached(detailText, symbol.name);
      const initialIncompleteState = isIncompleteTypePayload(info, { symbolKind: symbol?.kind });
      let sourceSignature = null;
      let sourceBootstrapUsed = false;
      if (initialIncompleteState.incomplete) {
        sourceSignature = buildSourceSignatureCandidate(
          openEntry?.text || doc.text || '',
          target?.virtualRange
        );
      }
      if (sourceSignature) {
        const sourceInfo = parseSignatureCached(sourceSignature, symbol?.name);
        if (sourceInfo) {
          const baseScore = scoreSignatureInfo(info, { symbolKind: symbol?.kind });
          const sourceScore = scoreSignatureInfo(sourceInfo, { symbolKind: symbol?.kind });
          const mergedSourceInfo = mergeSignatureInfo(info, sourceInfo, { symbolKind: symbol?.kind });
          const mergedState = isIncompleteTypePayload(mergedSourceInfo, { symbolKind: symbol?.kind });
          const shouldBootstrapSource = (
            sourceScore.total > baseScore.total
            || (!mergedState.incomplete && baseScore.incomplete)
          );
          if (shouldBootstrapSource) {
            info = mergedSourceInfo;
            sourceBootstrapUsed = true;
            fileHoverStats.sourceBootstrapUsed += 1;
            hoverMetrics.sourceBootstrapUsed += 1;
          }
        }
      }
      const incompleteState = isIncompleteTypePayload(info, { symbolKind: symbol?.kind });
      if (incompleteState.incomplete) {
        hoverMetrics.incompleteSymbols += 1;
      }
      const needsHover = hoverRequireMissingReturn === false
        ? incompleteState.incomplete === true
        : (incompleteState.missingReturn || incompleteState.missingParamTypes);
      if (needsHover) {
        hoverMetrics.hoverTriggeredByIncomplete += 1;
      }
      if (!needsHover) {
        fileHoverStats.skippedByReturnSufficient += 1;
        hoverMetrics.skippedByReturnSufficient += 1;
      }

      const symbolKindAllowed = !resolvedHoverKinds
        || (Number.isInteger(symbol?.kind) && resolvedHoverKinds.has(symbol.kind));
      if (!symbolKindAllowed) {
        fileHoverStats.skippedByKind += 1;
        hoverMetrics.skippedByKind += 1;
      }
      const position = symbol.selectionRange?.start || symbol.range?.start || null;
      symbolRecords.push({
        symbol,
        position,
        target,
        info,
        sourceSignature,
        semanticTokensEligible: (
          semanticTokensEnabled
          && interactiveAllowed
          && position != null
        ),
        hoverEligible: (
          hoverEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
        ),
        signatureHelpEligible: (
          signatureHelpEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
        ),
        inlayHintsEligible: (
          inlayHintsEnabled
          && interactiveAllowed
          && needsHover
          && position != null
        ),
        definitionEligible: (
          definitionEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
          && !sourceSignature
        ),
        typeDefinitionEligible: (
          typeDefinitionEnabled
          && interactiveAllowed
          && needsHover
          && symbolKindAllowed
          && position != null
          && !sourceSignature
        ),
        referencesEligible: (
          referencesEnabled
          && interactiveAllowed
          && FUNCTION_LIKE_SYMBOL_KINDS.has(Number(symbol?.kind))
          && needsHover
          && symbolKindAllowed
          && position != null
          && !sourceSignature
        ),
        semanticTokensRequested: false,
        semanticTokensSucceeded: false,
        hoverRequested: false,
        hoverSucceeded: false,
        signatureHelpRequested: false,
        signatureHelpSucceeded: false,
        inlayHintsRequested: false,
        inlayHintsSucceeded: false,
        definitionRequested: false,
        definitionSucceeded: false,
        typeDefinitionRequested: false,
        typeDefinitionSucceeded: false,
        referencesRequested: false,
        referencesSucceeded: false,
        semanticClass: String(info?.semanticClass || '').trim() || null,
        sourceBootstrapUsed: sourceBootstrapUsed === true,
        sourceFallbackUsed: false
      });
    }

    let enrichedDelta = 0;
    const adaptiveSymbolProcessingConcurrency = clampIntRange(
      Math.max(1, Math.min(
        symbolProcessingConcurrency,
        Math.ceil(Math.max(1, symbolRecords.length) / 8)
      )),
      symbolProcessingConcurrency,
      { min: 1, max: 256 }
    );
    const resolvedSymbolProcessingConcurrency = clampIntRange(
      adaptiveSymbolProcessingConcurrency,
      8,
      { min: 1, max: 256 }
    );
    let unresolvedRecords = symbolRecords.filter((record) => isIncompleteTypePayload(record?.info, {
      symbolKind: record?.symbol?.kind
    }).incomplete);
    const isAdaptiveSuppressed = () => hoverControl.disabledGlobal || fileHoverStats.disabledAdaptive;
    const recordAdaptiveSkip = () => {
      if (hoverControl.disabledGlobal) {
        fileHoverStats.skippedByGlobalDisable += 1;
        hoverMetrics.skippedByGlobalDisable += 1;
      } else if (fileHoverStats.disabledAdaptive) {
        fileHoverStats.skippedByAdaptiveDisable += 1;
        hoverMetrics.skippedByAdaptiveDisable += 1;
      }
    };
    const shouldSuppressAdditionalRequests = () => {
      if (isSoftDeadlineExpired()) {
        markSoftDeadlineReached();
        recordSoftDeadlineSkip();
        return true;
      }
      if (isAdaptiveSuppressed()) {
        recordAdaptiveSkip();
        return true;
      }
      return false;
    };
    const runStagePass = async ({
      enabled = true,
      eligibleFlag,
      requestFn,
      requestedFlag,
      succeededFlag
    }) => {
      if (!enabled || !unresolvedRecords.length) return;
      const stageRecords = unresolvedRecords.filter((record) => record?.[eligibleFlag]);
      if (!stageRecords.length) return;
      await runWithConcurrency(stageRecords, resolvedSymbolProcessingConcurrency, async (record) => {
        throwIfAborted(abortSignal);
        if (shouldSuppressAdditionalRequests()) return;
        const stageResult = await requestFn(record.symbol, record.position);
        if (!stageResult?.attempted) return;
        record[requestedFlag] = true;
        const stageInfo = stageResult.info;
        if (!stageInfo) return;
        record[succeededFlag] = true;
        record.info = mergeSignatureInfo(record.info, stageInfo, { symbolKind: record?.symbol?.kind });
      }, { signal: abortSignal });
      unresolvedRecords = unresolvedRecords.filter((record) => isIncompleteTypePayload(record?.info, {
        symbolKind: record?.symbol?.kind
      }).incomplete);
    };

    if (semanticTokensEnabled !== false) {
      const semanticEligibleRecords = symbolRecords.filter((record) => record?.semanticTokensEligible === true);
      if (semanticEligibleRecords.length && !shouldSuppressAdditionalRequests()) {
        const semanticTokens = await requestSemanticTokens();
        if (Array.isArray(semanticTokens) && semanticTokens.length) {
          for (const record of semanticEligibleRecords) {
            record.semanticTokensRequested = true;
            const token = findSemanticTokenAtPosition(semanticTokens, record.position);
            if (!token?.semanticClass) continue;
            record.semanticTokensSucceeded = true;
            record.semanticClass = token.semanticClass;
            record.info = mergeSignatureInfo(record.info, {
              semanticClass: token.semanticClass,
              semanticTokenType: token.tokenType || null,
              semanticTokenModifiers: Array.isArray(token.tokenModifiers)
                ? token.tokenModifiers.slice()
                : []
            }, { symbolKind: record?.symbol?.kind });
          }
        }
      }
    }

    await runStagePass({
      enabled: hoverEnabled !== false,
      eligibleFlag: 'hoverEligible',
      requestFn: requestHover,
      requestedFlag: 'hoverRequested',
      succeededFlag: 'hoverSucceeded'
    });
    await runStagePass({
      enabled: signatureHelpEnabled !== false,
      eligibleFlag: 'signatureHelpEligible',
      requestFn: requestSignatureHelp,
      requestedFlag: 'signatureHelpRequested',
      succeededFlag: 'signatureHelpSucceeded'
    });
    if (inlayHintsEnabled !== false && unresolvedRecords.length) {
      const inlayEligibleRecords = unresolvedRecords.filter((record) => record?.inlayHintsEligible === true);
      if (inlayEligibleRecords.length && !shouldSuppressAdditionalRequests()) {
        const inlayHints = await requestInlayHints();
        if (Array.isArray(inlayHints)) {
          for (const record of inlayEligibleRecords) {
            record.inlayHintsRequested = true;
            const hintInfo = parseInlayHintSignalInfo({
              hints: inlayHints,
              lineIndex,
              text: docText,
              targetRange: record?.target?.virtualRange || record?.target?.chunkRef?.range || null,
              positionEncoding,
              paramNames: normalizeParamNames(record?.info?.paramNames),
              languageId
            });
            if (!hintInfo) continue;
            record.inlayHintsSucceeded = hintInfo.hintCount > 0;
            if (record.inlayHintsSucceeded) {
              record.info = mergeSignatureInfo(record.info, hintInfo, { symbolKind: record?.symbol?.kind });
            }
          }
          unresolvedRecords = unresolvedRecords.filter((record) => isIncompleteTypePayload(record?.info, {
            symbolKind: record?.symbol?.kind
          }).incomplete);
        }
      }
    }
    await runStagePass({
      enabled: definitionEnabled !== false,
      eligibleFlag: 'definitionEligible',
      requestFn: requestDefinition,
      requestedFlag: 'definitionRequested',
      succeededFlag: 'definitionSucceeded'
    });
    await runStagePass({
      enabled: typeDefinitionEnabled !== false,
      eligibleFlag: 'typeDefinitionEligible',
      requestFn: requestTypeDefinition,
      requestedFlag: 'typeDefinitionRequested',
      succeededFlag: 'typeDefinitionSucceeded'
    });
    await runStagePass({
      enabled: referencesEnabled !== false,
      eligibleFlag: 'referencesEligible',
      requestFn: requestReferences,
      requestedFlag: 'referencesRequested',
      succeededFlag: 'referencesSucceeded'
    });

    const candidateRows = [];
    const unresolvedRate = symbolRecords.length > 0
      ? (unresolvedRecords.length / symbolRecords.length)
      : 0;
    const stabilityTier = resolveProviderStabilityTier({ fileHoverStats, hoverControl });
    const symbolWorkItems = symbolRecords.map((record, recordIndex) => ({ record, recordIndex }));
    await runWithConcurrency(symbolWorkItems, resolvedSymbolProcessingConcurrency, async (item) => {
      const candidate = await resolveRecordCandidate({
        abortSignal,
        cmd,
        hoverMetrics,
        languageId,
        parseSignatureCached,
        providerConfidenceBias,
        record: item.record,
        recordIndex: item.recordIndex,
        stabilityTier,
        strict,
        unresolvedRate
      });
      if (candidate) candidateRows.push(candidate);
    }, { signal: abortSignal });

    candidateRows.sort((a, b) => {
      const chunkCmp = String(a.chunkUid).localeCompare(String(b.chunkUid));
      if (chunkCmp) return chunkCmp;
      const scoreCmp = Number(b.candidateScore || 0) - Number(a.candidateScore || 0);
      if (scoreCmp) return scoreCmp;
      const signatureCmp = Number(b.signatureLength || 0) - Number(a.signatureLength || 0);
      if (signatureCmp) return signatureCmp;
      return Number(a.recordIndex || 0) - Number(b.recordIndex || 0);
    });
    const selectedChunkUids = new Set();
    for (const row of candidateRows) {
      if (selectedChunkUids.has(row.chunkUid)) continue;
      selectedChunkUids.add(row.chunkUid);
      byChunkUid[row.chunkUid] = {
        chunk: row.chunkRef,
        payload: row.payload,
        ...(row.symbolRef ? { symbolRef: row.symbolRef } : {}),
        provenance: row.provenance
      };
      enrichedDelta += 1;
    }

    return { enrichedDelta };
  } finally {
    if (openedHere) {
      // Retain the URI/line-index mapping until diagnostics shaping completes.
      // For tokenized poc-vfs URIs, fallback URI reconstruction can differ from
      // the didOpen URI, so deleting this too early drops diagnostics.
      client.notify('textDocument/didClose', { textDocument: { uri } }, { startIfNeeded: false });
    }
  }
};
