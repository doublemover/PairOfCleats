import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonFileSafe } from '../../shared/files.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';

const DEFAULT_HARD_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_SOFT_COOLDOWN_MS = 2 * 60 * 1000;
const testHooks = {
  hardCooldownMs: null,
  softCooldownMs: null
};

export const PYRIGHT_RUNTIME_HEALTH_STATE = Object.freeze({
  HEALTHY: 'healthy',
  WARMING: 'warming',
  DEGRADED_SOFT: 'degraded_soft',
  DEGRADED_HARD: 'degraded_hard',
  QUARANTINED_FOR_RUN: 'quarantined_for_run'
});

const normalizeWorkspaceRootRel = (value) => {
  const normalized = String(value || '.')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || '.';
};

const normalizeVirtualPath = (value) => (
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.poc-vfs\/+/iu, '')
    .replace(/^poc-vfs\/+/iu, '')
    .replace(/#.*$/u, '')
);

const buildHealthFingerprint = ({ repoRoot, workspaceRootRel }) => crypto.createHash('sha1')
  .update(path.resolve(String(repoRoot || process.cwd())).toLowerCase())
  .update('|')
  .update(normalizeWorkspaceRootRel(workspaceRootRel))
  .digest('hex');

const resolveRuntimeHealthPath = ({ repoRoot, cacheRoot = null, workspaceRootRel }) => {
  const rootHash = buildHealthFingerprint({ repoRoot, workspaceRootRel });
  if (typeof cacheRoot === 'string' && cacheRoot.trim()) {
    return path.join(path.resolve(cacheRoot), 'tooling', 'pyright-runtime', `${rootHash}.json`);
  }
  return path.join(
    path.resolve(String(repoRoot || process.cwd())),
    '.build',
    'pairofcleats',
    'tooling',
    'pyright-runtime',
    `${rootHash}.json`
  );
};

const normalizeStoredState = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.values(PYRIGHT_RUNTIME_HEALTH_STATE).includes(normalized)
    ? normalized
    : PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY;
};

const resolveHardCooldownMs = () => {
  const parsed = Number(testHooks.hardCooldownMs);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_HARD_COOLDOWN_MS;
};

const resolveSoftCooldownMs = () => {
  const parsed = Number(testHooks.softCooldownMs);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_SOFT_COOLDOWN_MS;
};

export const buildPyrightRuntimeFingerprint = ({
  workspaceRootRel,
  selectedDocumentSummaries
} = {}) => {
  const docs = Array.isArray(selectedDocumentSummaries)
    ? selectedDocumentSummaries
      .map((entry) => normalizeVirtualPath(entry?.virtualPath))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
    : [];
  return crypto.createHash('sha1')
    .update(normalizeWorkspaceRootRel(workspaceRootRel))
    .update('\0')
    .update(JSON.stringify(docs))
    .digest('hex');
};

const readRuntimeHealth = async ({ repoRoot, cacheRoot = null, workspaceRootRel }) => {
  const healthPath = resolveRuntimeHealthPath({ repoRoot, cacheRoot, workspaceRootRel });
  const payload = await readJsonFileSafe(healthPath, {
    fallback: null,
    maxBytes: 32 * 1024
  });
  if (!payload || typeof payload !== 'object') {
    return { healthPath, state: null };
  }
  return {
    healthPath,
    state: {
      workspaceRootRel: normalizeWorkspaceRootRel(payload.workspaceRootRel),
      state: normalizeStoredState(payload.state),
      reasonCode: String(payload.reasonCode || '').trim() || null,
      fingerprint: String(payload.fingerprint || '').trim() || null,
      cooldownUntil: Number(payload.cooldownUntil) || 0,
      updatedAt: String(payload.updatedAt || '').trim() || null,
      timeoutStormCount: Number(payload.timeoutStormCount) || 0,
      degradationCount: Number(payload.degradationCount) || 0,
      recoveryCount: Number(payload.recoveryCount) || 0
    }
  };
};

export const resolvePyrightRuntimeHealth = async ({
  repoRoot,
  cacheRoot = null,
  workspaceRootRel,
  selectedDocumentSummaries,
  now = Date.now()
} = {}) => {
  const normalizedWorkspaceRootRel = normalizeWorkspaceRootRel(workspaceRootRel);
  const fingerprint = buildPyrightRuntimeFingerprint({
    workspaceRootRel: normalizedWorkspaceRootRel,
    selectedDocumentSummaries
  });
  const { healthPath, state: persistedState } = await readRuntimeHealth({
    repoRoot,
    cacheRoot,
    workspaceRootRel: normalizedWorkspaceRootRel
  });
  const fingerprintChanged = Boolean(
    persistedState?.fingerprint
    && persistedState.fingerprint !== fingerprint
  );
  let effectiveState = persistedState?.state || PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY;
  let reasonCode = persistedState?.reasonCode || null;
  let cooldownRemainingMs = 0;
  if (!persistedState) {
    effectiveState = PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY;
  } else if (fingerprintChanged) {
    effectiveState = PYRIGHT_RUNTIME_HEALTH_STATE.WARMING;
    reasonCode = 'fingerprint_changed';
  } else if (
    (
      persistedState.state === PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_HARD
      || persistedState.state === PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN
    )
    && persistedState.cooldownUntil > now
  ) {
    effectiveState = PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN;
    cooldownRemainingMs = Math.max(0, persistedState.cooldownUntil - now);
  } else if (
    (
      persistedState.state === PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_SOFT
      || persistedState.state === PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_HARD
      || persistedState.state === PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN
    )
    && persistedState.cooldownUntil <= now
  ) {
    effectiveState = PYRIGHT_RUNTIME_HEALTH_STATE.WARMING;
    reasonCode = 'cooldown_elapsed';
  }
  return {
    healthPath,
    fingerprint,
    workspaceRootRel: normalizedWorkspaceRootRel,
    persistedState,
    effectiveState,
    reasonCode,
    cooldownRemainingMs,
    shouldShortCircuit: effectiveState === PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN
  };
};

export const resolvePyrightRuntimeOverrides = ({
  documentSymbolConcurrency
} = {}) => ({
  documentSymbolConcurrency: 1,
  plannedDocumentSymbolConcurrency: Number(documentSymbolConcurrency) || 0
});

export const buildPyrightFallbackContract = ({
  state,
  reasonCode,
  workspaceRootRel,
  fingerprint,
  captureDiagnostics = false
} = {}) => {
  const normalizedState = normalizeStoredState(state);
  const degraded = normalizedState !== PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY
    && normalizedState !== PYRIGHT_RUNTIME_HEALTH_STATE.WARMING;
  return {
    contractVersion: 1,
    providerId: 'pyright',
    state: normalizedState,
    reasonCode: String(reasonCode || '').trim() || null,
    workspaceRootRel: normalizeWorkspaceRootRel(workspaceRootRel),
    fingerprint: String(fingerprint || '').trim() || null,
    contributes: {
      typeEnrichment: degraded !== true,
      diagnostics: captureDiagnostics === true
        && normalizedState !== PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN
    },
    skipped: degraded
      ? [
        'documentSymbol',
        'hover',
        'signatureHelp',
        'definition',
        'typeDefinition',
        'references',
        'semanticTokens',
        'inlayHints'
      ]
      : [],
    downstreamMergeInterpretation: degraded
      ? 'Treat missing Pyright output as explicit provider degradation, not as negative symbol evidence.'
      : 'Pyright output is healthy and may participate in normal merge scoring.'
  };
};

const hasNamedCheck = (checks, name) => (
  Array.isArray(checks) && checks.some((check) => check?.name === name)
);

export const derivePyrightRuntimeOutcome = ({
  healthContext,
  runtime,
  checks,
  captureDiagnostics = false,
  now = Date.now()
} = {}) => {
  const documentSymbol = runtime?.requests?.byMethod?.['textDocument/documentSymbol'] || {};
  const timedOut = Number(documentSymbol?.timedOut || 0);
  const failed = Number(documentSymbol?.failed || 0);
  const circuitOpened = hasNamedCheck(checks, 'tooling_circuit_open');
  const documentSymbolFailed = hasNamedCheck(checks, 'tooling_document_symbol_failed');
  const providerQuarantined = hasNamedCheck(checks, 'tooling_provider_quarantined');
  const timeoutStormDetected = timedOut >= 1;
  const hardFailureDetected = providerQuarantined || timeoutStormDetected || circuitOpened;
  let state = healthContext?.effectiveState || PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY;
  let nextState = state;
  let reasonCode = healthContext?.reasonCode || null;
  let cooldownUntil = 0;
  if (providerQuarantined) {
    state = PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN;
    nextState = PYRIGHT_RUNTIME_HEALTH_STATE.QUARANTINED_FOR_RUN;
    reasonCode = reasonCode || 'provider_quarantined';
    cooldownUntil = now + resolveHardCooldownMs();
  } else if (hardFailureDetected) {
    state = PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_SOFT;
    nextState = PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_HARD;
    reasonCode = timeoutStormDetected
      ? 'document_symbol_timeout'
      : (circuitOpened ? 'document_symbol_circuit_open' : 'document_symbol_failed');
    cooldownUntil = now + resolveHardCooldownMs();
  } else if (documentSymbolFailed || failed > 0) {
    state = PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_SOFT;
    nextState = PYRIGHT_RUNTIME_HEALTH_STATE.DEGRADED_SOFT;
    reasonCode = 'document_symbol_failed';
    cooldownUntil = now + resolveSoftCooldownMs();
  } else {
    state = state === PYRIGHT_RUNTIME_HEALTH_STATE.WARMING
      ? PYRIGHT_RUNTIME_HEALTH_STATE.WARMING
      : PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY;
    nextState = PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY;
    reasonCode = state === PYRIGHT_RUNTIME_HEALTH_STATE.WARMING ? 'warming_success' : null;
    cooldownUntil = 0;
  }
  const persistedState = healthContext?.persistedState || null;
  return {
    state,
    nextState,
    reasonCode,
    cooldownUntil,
    summary: {
      state,
      nextState,
      reasonCode,
      workspaceRootRel: healthContext?.workspaceRootRel || '.',
      fingerprint: healthContext?.fingerprint || null,
      priorState: persistedState?.state || null,
      cooldownRemainingMs: Math.max(0, cooldownUntil - now),
      documentSymbolTimedOut: timedOut,
      documentSymbolFailed: failed
    },
    fallback: buildPyrightFallbackContract({
      state,
      reasonCode,
      workspaceRootRel: healthContext?.workspaceRootRel || '.',
      fingerprint: healthContext?.fingerprint || null,
      captureDiagnostics
    }),
    record: {
      schemaVersion: 1,
      updatedAt: new Date(now).toISOString(),
      workspaceRootRel: healthContext?.workspaceRootRel || '.',
      fingerprint: healthContext?.fingerprint || null,
      state: nextState,
      reasonCode,
      cooldownUntil,
      timeoutStormCount: Number(persistedState?.timeoutStormCount || 0) + (timeoutStormDetected ? 1 : 0),
      degradationCount: Number(persistedState?.degradationCount || 0) + (nextState !== PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY ? 1 : 0),
      recoveryCount: Number(persistedState?.recoveryCount || 0) + (nextState === PYRIGHT_RUNTIME_HEALTH_STATE.HEALTHY ? 1 : 0)
    }
  };
};

export const persistPyrightRuntimeHealth = async ({
  repoRoot,
  cacheRoot = null,
  workspaceRootRel,
  record
} = {}) => {
  const healthPath = resolveRuntimeHealthPath({ repoRoot, cacheRoot, workspaceRootRel });
  await fs.promises.mkdir(path.dirname(healthPath), { recursive: true });
  await atomicWriteJson(healthPath, record, {
    spaces: 0,
    newline: false
  });
  return healthPath;
};

export const __testPyrightRuntimeHealth = {
  setCooldowns({ hardMs = null, softMs = null } = {}) {
    testHooks.hardCooldownMs = hardMs;
    testHooks.softCooldownMs = softMs;
  },
  reset() {
    testHooks.hardCooldownMs = null;
    testHooks.softCooldownMs = null;
  }
};
