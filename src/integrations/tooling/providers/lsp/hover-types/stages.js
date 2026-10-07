const normalizeHoverContents = (contents) => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((entry) => normalizeHoverContents(entry)).filter(Boolean).join('\n');
  }
  if (typeof contents === 'object') {
    return String(contents.value || contents.language || '').trim();
  }
  return String(contents || '');
};

const extractSignatureHelpText = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const signatures = Array.isArray(payload.signatures) ? payload.signatures : [];
  if (!signatures.length) return '';
  const activeIndexRaw = Number(payload.activeSignature);
  const activeIndex = Number.isFinite(activeIndexRaw)
    ? Math.max(0, Math.min(signatures.length - 1, Math.floor(activeIndexRaw)))
    : 0;
  const activeSignature = signatures[activeIndex] || signatures[0] || null;
  return String(activeSignature?.label || '').trim();
};

const extractDefinitionLocations = (payload) => {
  const source = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const uri = typeof entry.uri === 'string'
      ? entry.uri
      : (typeof entry.targetUri === 'string' ? entry.targetUri : null);
    const range = entry.range && typeof entry.range === 'object'
      ? entry.range
      : (entry.targetSelectionRange && typeof entry.targetSelectionRange === 'object'
        ? entry.targetSelectionRange
        : entry.targetRange);
    if (!uri || !range) continue;
    out.push({ uri, range });
  }
  return out;
};

const recordCircuitOpenCheck = ({ cmd, guard, checks, checkFlags }) => {
  if (checkFlags.circuitOpened) return;
  checkFlags.circuitOpened = true;
  const state = guard.getState?.() || null;
  checks.push({
    name: 'tooling_circuit_open',
    status: 'warn',
    message: `${cmd} tooling circuit is open${state?.reason ? ` (${state.reason})` : ''}; running in degraded mode.`
  });
};

const recordCrashLoopCheck = ({ cmd, checks, checkFlags, detail }) => {
  if (checkFlags.crashLoop) return;
  checkFlags.crashLoop = true;
  const remainingMs = Number.isFinite(Number(detail?.crashLoopBackoffRemainingMs))
    ? Math.max(0, Math.floor(Number(detail.crashLoopBackoffRemainingMs)))
    : null;
  checks.push({
    name: 'tooling_crash_loop',
    status: 'warn',
    message: `${cmd} tooling session entered crash-loop backoff${remainingMs != null ? ` (${remainingMs}ms remaining)` : ''}; running in degraded mode.`
  });
};

const recordDocumentSymbolFailureCheck = ({ cmd, checks, checkFlags, err }) => {
  if (checkFlags.documentSymbolFailed) return;
  checkFlags.documentSymbolFailed = true;
  const message = String(err?.message || err || '');
  const lower = message.toLowerCase();
  const category = lower.includes('timeout')
    ? 'timeout'
    : (
      err?.code === 'ERR_LSP_TRANSPORT_CLOSED'
        || lower.includes('transport closed')
        || lower.includes('writer unavailable')
    )
      ? 'transport'
      : 'request';
  checks.push({
    name: 'tooling_document_symbol_failed',
    status: 'warn',
    message: `${cmd} documentSymbol requests failed; running in degraded mode (${category}).`
  });
};

const recordSoftDeadlineCheck = ({
  cmd,
  checks,
  checkFlags,
  softDeadlineAt
}) => {
  if (checkFlags.softDeadlineReached) return;
  checkFlags.softDeadlineReached = true;
  const deadlineIso = Number.isFinite(Number(softDeadlineAt))
    ? new Date(Number(softDeadlineAt)).toISOString()
    : null;
  checks.push({
    name: 'tooling_soft_deadline_reached',
    status: 'warn',
    message: `${cmd} tooling soft deadline reached${deadlineIso ? ` (${deadlineIso})` : ''}; suppressing additional LSP stage requests.`
  });
};

const isTimeoutError = (err) => (
  String(err?.message || err || '').toLowerCase().includes('timeout')
);

const TIMEOUT_METRIC_KEY_BY_STAGE = Object.freeze({
  hover: 'hoverTimedOut',
  semantic_tokens: 'semanticTokensTimedOut',
  signature_help: 'signatureHelpTimedOut',
  inlay_hints: 'inlayHintsTimedOut',
  definition: 'definitionTimedOut',
  type_definition: 'typeDefinitionTimedOut',
  references: 'referencesTimedOut'
});

const REQUEST_METHOD_BY_STAGE = Object.freeze({
  documentsymbol: 'textDocument/documentSymbol',
  hover: 'textDocument/hover',
  semantic_tokens: 'textDocument/semanticTokens/full',
  signature_help: 'textDocument/signatureHelp',
  inlay_hints: 'textDocument/inlayHint',
  definition: 'textDocument/definition',
  type_definition: 'textDocument/typeDefinition',
  references: 'textDocument/references'
});

const emitToolingRequestSignal = ({
  log,
  providerId,
  requestMethod,
  stageKey,
  workspaceKey = null,
  failureClass,
  kind,
  err
}) => {
  if (typeof log !== 'function') return;
  const providerToken = String(providerId || '').trim() || 'lsp';
  const methodToken = String(
    requestMethod || REQUEST_METHOD_BY_STAGE[String(stageKey || '').trim().toLowerCase()] || ''
  ).trim();
  const kindToken = String(kind || '').trim().toLowerCase() === 'timeout' ? 'timeout' : 'failed';
  const classToken = String(failureClass || kindToken).trim() || kindToken;
  const workspaceToken = String(workspaceKey || '.').trim() || '.';
  const message = String(err?.message || err || '').trim();
  log(
    `[tooling] request:${kindToken} provider=${providerToken} method=${methodToken || 'unknown'} `
    + `stage=${String(stageKey || '').trim() || 'unknown'} `
    + `workspacePartition=${workspaceToken} `
    + `class=${classToken}`
    + `${message ? ` error="${message.replace(/"/g, '\'')}"` : ''}`
  );
};

const recordAdaptiveTimeout = ({
  log,
  providerId,
  cmd,
  stageKey,
  workspaceKey = null,
  checks,
  checkFlags,
  fileHoverStats,
  hoverMetrics,
  hoverControl,
  resolvedHoverDisableAfterTimeouts
}) => {
  fileHoverStats.timedOut += 1;
  hoverMetrics.timedOut += 1;
  const timeoutMetricKey = TIMEOUT_METRIC_KEY_BY_STAGE[stageKey] || null;
  if (timeoutMetricKey) {
    fileHoverStats[timeoutMetricKey] = Number(fileHoverStats[timeoutMetricKey] || 0) + 1;
    hoverMetrics[timeoutMetricKey] = Number(hoverMetrics[timeoutMetricKey] || 0) + 1;
  }
  const timeoutFlag = `${stageKey}TimedOut`;
  if (!checkFlags[timeoutFlag]) {
    checkFlags[timeoutFlag] = true;
    checks.push({
      name: `tooling_${stageKey}_timeout`,
      status: 'warn',
      message: `${cmd} ${stageKey} requests timed out; adaptive suppression may be enabled.`
    });
  }
  emitToolingRequestSignal({
    log,
    providerId,
    requestMethod: REQUEST_METHOD_BY_STAGE[String(stageKey || '').trim().toLowerCase()] || null,
    stageKey,
    workspaceKey,
    failureClass: 'timeout',
    kind: 'timeout'
  });
  if (
    Number.isFinite(resolvedHoverDisableAfterTimeouts)
    && fileHoverStats.timedOut >= resolvedHoverDisableAfterTimeouts
    && !fileHoverStats.disabledAdaptive
  ) {
    fileHoverStats.disabledAdaptive = true;
  }
  if (
    Number.isFinite(resolvedHoverDisableAfterTimeouts)
    && hoverMetrics.timedOut >= resolvedHoverDisableAfterTimeouts
  ) {
    hoverControl.disabledGlobal = true;
  }
};

const handleStageRequestError = ({
  err,
  log,
  providerId,
  cmd,
  stageKey,
  workspaceKey = null,
  guard,
  checks,
  checkFlags,
  fileHoverStats,
  hoverMetrics,
  hoverControl,
  resolvedHoverDisableAfterTimeouts
}) => {
  if (err?.code === 'ABORT_ERR') throw err;
  if (err?.code === 'TOOLING_CIRCUIT_OPEN') {
    recordCircuitOpenCheck({ cmd, guard, checks, checkFlags });
  } else if (err?.code === 'TOOLING_CRASH_LOOP') {
    recordCrashLoopCheck({ cmd, checks, checkFlags, detail: err?.detail || null });
  }
  if (isTimeoutError(err)) {
    recordAdaptiveTimeout({
      log,
      providerId,
      cmd,
      stageKey,
      workspaceKey,
      checks,
      checkFlags,
      fileHoverStats,
      hoverMetrics,
      hoverControl,
      resolvedHoverDisableAfterTimeouts
    });
  } else {
    emitToolingRequestSignal({
      log,
      providerId,
      requestMethod: REQUEST_METHOD_BY_STAGE[String(stageKey || '').trim().toLowerCase()] || null,
      stageKey,
      workspaceKey,
      failureClass: err?.code || 'request_failed',
      kind: 'failed',
      err
    });
  }
  return null;
};

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
};
