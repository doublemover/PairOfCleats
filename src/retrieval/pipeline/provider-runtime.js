import {
  ANN_ADAPTIVE_FAILURE_PENALTY_MS,
  ANN_ADAPTIVE_LATENCY_ALPHA,
  ANN_ADAPTIVE_PREFLIGHT_PENALTY_MS,
  PREFLIGHT_CACHE_TTL_MS,
  PROVIDER_RETRY_BASE_MS,
  PROVIDER_RETRY_MAX_MS
} from './constants.js';

/**
 * Create per-provider runtime tracking for adaptive ANN backend selection.
 * @returns {{
 *   getProviderModeState:(provider:object|null,mode:string)=>object|null,
 *   isProviderCoolingDown:(provider:object|null,mode:string)=>boolean,
 *   recordProviderFailure:(provider:object|null,mode:string,reason?:string,options?:{fromPreflight?:boolean})=>void,
 *   recordProviderSuccess:(provider:object|null,mode:string,options?:{latencyMs?:number|null})=>void,
 *   resolveAnnBackends:(providers:Map<string,object>,mode:string,baseOrder:string[],adaptiveEnabled:boolean)=>string[],
 *   ensureProviderPreflight:(provider:object|null,input:{idx:object,mode:string,embedding:number[]|null,signal:AbortSignal|undefined})=>Promise<boolean>
 * }}
 */
export const createProviderRuntime = () => {
  const providerRuntimeState = new Map();
  const unnamedProviderIdentity = new WeakMap();
  let unnamedProviderCounter = 0;

  const resolveProviderStateKey = (provider, mode) => {
    const modeKey = typeof mode === 'string' && mode ? mode : 'unknown-mode';
    let providerKey = typeof provider?.id === 'string' && provider.id
      ? provider.id
      : '';
    if (!providerKey) {
      const providerType = typeof provider;
      if (provider && (providerType === 'object' || providerType === 'function')) {
        providerKey = unnamedProviderIdentity.get(provider) || '';
        if (!providerKey) {
          unnamedProviderCounter += 1;
          providerKey = `unnamed-provider-${unnamedProviderCounter}`;
          unnamedProviderIdentity.set(provider, providerKey);
        }
      } else {
        providerKey = 'unknown-provider';
      }
    }
    return `${modeKey}:${providerKey}`;
  };

  const getProviderModeState = (provider, mode) => {
    if (!provider || !mode) return null;
    const stateKey = resolveProviderStateKey(provider, mode);
    if (!providerRuntimeState.has(stateKey)) {
      providerRuntimeState.set(stateKey, {
        failures: 0,
        disabledUntil: 0,
        preflight: null,
        preflightFailureUntil: 0,
        preflightCheckedAt: 0,
        lastError: null,
        latencyEwmaMs: null,
        latencySamples: 0
      });
    }
    return providerRuntimeState.get(stateKey);
  };

  const resolveProviderBackoffMs = (failures) => {
    const count = Number.isFinite(Number(failures)) ? Math.max(0, Math.floor(Number(failures))) : 0;
    if (!count) return 0;
    return Math.min(PROVIDER_RETRY_MAX_MS, PROVIDER_RETRY_BASE_MS * (2 ** (count - 1)));
  };

  const isProviderCoolingDown = (provider, mode) => {
    const state = getProviderModeState(provider, mode);
    if (!state) return false;
    return state.disabledUntil > Date.now();
  };

  const recordProviderFailure = (provider, mode, reason, { fromPreflight = false } = {}) => {
    const state = getProviderModeState(provider, mode);
    if (!state) return;
    state.failures += 1;
    const now = Date.now();
    const backoffMs = resolveProviderBackoffMs(state.failures);
    state.disabledUntil = now + backoffMs;
    state.lastError = reason || state.lastError || null;
    if (fromPreflight) {
      state.preflight = false;
      state.preflightCheckedAt = now;
      state.preflightFailureUntil = now + backoffMs;
    } else {
      state.preflight = null;
      state.preflightFailureUntil = 0;
      state.preflightCheckedAt = 0;
    }
  };

  const recordProviderSuccess = (provider, mode, { latencyMs = null } = {}) => {
    const state = getProviderModeState(provider, mode);
    if (!state) return;
    state.failures = 0;
    state.disabledUntil = 0;
    state.lastError = null;
    state.preflight = true;
    state.preflightFailureUntil = 0;
    state.preflightCheckedAt = Date.now();
    if (Number.isFinite(Number(latencyMs)) && Number(latencyMs) >= 0) {
      const resolvedLatencyMs = Number(latencyMs);
      const prev = Number.isFinite(Number(state.latencyEwmaMs))
        ? Number(state.latencyEwmaMs)
        : null;
      state.latencyEwmaMs = prev == null
        ? resolvedLatencyMs
        : ((prev * (1 - ANN_ADAPTIVE_LATENCY_ALPHA)) + (resolvedLatencyMs * ANN_ADAPTIVE_LATENCY_ALPHA));
      state.latencySamples = (Number.isFinite(Number(state.latencySamples)) ? Number(state.latencySamples) : 0) + 1;
    }
  };

  const resolveAnnBackends = (providers, mode, baseOrder, adaptiveEnabled) => {
    const base = (Array.isArray(baseOrder) ? baseOrder : []).filter((backend) => providers.has(backend));
    if (!adaptiveEnabled || base.length <= 1) return base;
    const scored = base.map((backend, baseIndex) => {
      const provider = providers.get(backend);
      const state = getProviderModeState(provider, mode);
      const hasLatency = Number.isFinite(Number(state?.latencyEwmaMs));
      const latencyMs = hasLatency ? Number(state.latencyEwmaMs) : Number.POSITIVE_INFINITY;
      const failures = Number.isFinite(Number(state?.failures))
        ? Math.max(0, Math.floor(Number(state.failures)))
        : 0;
      const preflightPenalty = state?.preflight === false ? 1 : 0;
      return {
        backend,
        provider,
        baseIndex,
        coolingDown: isProviderCoolingDown(provider, mode),
        failures,
        preflightPenalty,
        latencyMs,
        hasSignal: hasLatency || failures > 0 || preflightPenalty > 0
      };
    });
    if (!scored.some((entry) => entry.hasSignal)) return base;
    scored.sort((a, b) => {
      if (a.coolingDown !== b.coolingDown) return Number(a.coolingDown) - Number(b.coolingDown);
      const aPenalty = (a.failures * ANN_ADAPTIVE_FAILURE_PENALTY_MS)
        + (a.preflightPenalty * ANN_ADAPTIVE_PREFLIGHT_PENALTY_MS);
      const bPenalty = (b.failures * ANN_ADAPTIVE_FAILURE_PENALTY_MS)
        + (b.preflightPenalty * ANN_ADAPTIVE_PREFLIGHT_PENALTY_MS);
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
      return a.baseIndex - b.baseIndex;
    });
    return scored.map((entry) => entry.backend);
  };

  const ensureProviderPreflight = async (provider, { idx, mode, embedding, signal } = {}) => {
    if (!provider || typeof provider.preflight !== 'function') return true;
    const state = getProviderModeState(provider, mode);
    const now = Date.now();
    if (state) {
      if (state.preflight === false) {
        const failureUntil = Number.isFinite(Number(state.preflightFailureUntil))
          ? Number(state.preflightFailureUntil)
          : 0;
        const disabledUntil = Number.isFinite(Number(state.disabledUntil))
          ? Number(state.disabledUntil)
          : 0;
        const blockedUntil = Math.max(failureUntil, disabledUntil);
        if (blockedUntil > now) {
          return false;
        }
        state.disabledUntil = 0;
        state.preflight = null;
        state.preflightFailureUntil = 0;
        state.preflightCheckedAt = 0;
      }
      if (state.disabledUntil > now) {
        return false;
      }
      if (state.preflight === true) {
        if (
          state.preflightCheckedAt
          && (now - state.preflightCheckedAt) <= PREFLIGHT_CACHE_TTL_MS
        ) {
          return true;
        }
        state.preflight = null;
        state.preflightFailureUntil = 0;
        state.preflightCheckedAt = 0;
      }
    }
    try {
      const result = await provider.preflight({
        idx,
        mode,
        embedding,
        signal
      });
      const ok = result !== false;
      const checkedAt = Date.now();
      if (state) {
        state.preflight = ok;
        state.preflightCheckedAt = checkedAt;
      }
      if (!ok) {
        recordProviderFailure(provider, mode, 'preflight failed', { fromPreflight: true });
        return false;
      }
      recordProviderSuccess(provider, mode);
      return ok;
    } catch (err) {
      recordProviderFailure(provider, mode, err?.message || 'preflight failed', { fromPreflight: true });
      return false;
    }
  };

  return {
    getProviderModeState,
    isProviderCoolingDown,
    recordProviderFailure,
    recordProviderSuccess,
    resolveAnnBackends,
    ensureProviderPreflight
  };
};

/**
 * Normalize source type emitted for ANN hits.
 * @param {string|null|undefined} annSource
 * @returns {'vector'|'minhash'|null}
 */
export const resolveAnnType = (annSource) => {
  if (!annSource) return null;
  return annSource === 'minhash' ? 'minhash' : 'vector';
};
