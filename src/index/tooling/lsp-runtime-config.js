import { isPlainObject } from '../../shared/config.js';

const toNormalizedInt = (value, min) => {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.floor(parsed));
};

const toNormalizedBoolean = (value) => (typeof value === 'boolean' ? value : null);

const firstDefined = (values) => {
  for (const value of values) {
    if (value != null) return value;
  }
  return undefined;
};

const resolveValueFromConfig = (config, keys) => {
  if (!isPlainObject(config) || !Array.isArray(keys) || !keys.length) return undefined;
  const lifecycle = isPlainObject(config.lifecycle) ? config.lifecycle : null;
  const lifecycleCandidates = lifecycle
    ? keys.map((key) => lifecycle[key])
    : [];
  const configCandidates = keys.map((key) => config[key]);
  return firstDefined([...lifecycleCandidates, ...configCandidates]);
};

const resolveIntegerSetting = ({ providerConfig, globalConfigs, keys, min, fallback = null }) => {
  const providerValue = resolveValueFromConfig(providerConfig, keys);
  const globalValues = Array.isArray(globalConfigs)
    ? globalConfigs.map((config) => resolveValueFromConfig(config, keys))
    : [];
  const candidates = [providerValue, ...globalValues, fallback];
  for (const candidate of candidates) {
    const normalized = toNormalizedInt(candidate, min);
    if (normalized != null) return normalized;
  }
  return null;
};

const resolveBooleanSetting = ({ providerConfig, globalConfigs, keys, fallback = null }) => {
  const providerValue = resolveValueFromConfig(providerConfig, keys);
  const globalValues = Array.isArray(globalConfigs)
    ? globalConfigs.map((config) => resolveValueFromConfig(config, keys))
    : [];
  const candidates = [providerValue, ...globalValues, fallback];
  for (const candidate of candidates) {
    const normalized = toNormalizedBoolean(candidate);
    if (normalized != null) return normalized;
  }
  return null;
};

/**
 * Resolve common timeout/retry/breaker and lifecycle controls for LSP providers.
 *
 * Resolution order:
 * 1. provider config (including provider `lifecycle` object)
 * 2. each global config in order (including each global `lifecycle` object)
 * 3. explicit defaults
 *
 * @param {{
 *   providerConfig?:object|null,
 *   globalConfigs?:Array<object|null>,
 *   defaults?:{
 *     timeoutMs?:number|null,
 *     retries?:number|null,
 *     breakerThreshold?:number|null
 *   }
 * }} [input]
 * @returns {{
 *   timeoutMs:number|null,
 *   retries:number|null,
 *   breakerThreshold:number|null,
 *   documentSymbolTimeoutMs:number|null,
 *   hoverTimeoutMs:number|null,
 *   signatureHelpTimeoutMs:number|null,
 *   definitionTimeoutMs:number|null,
 *   typeDefinitionTimeoutMs:number|null,
 *   referencesTimeoutMs:number|null,
 *   hoverMaxPerFile:number|null,
 *   hoverDisableAfterTimeouts:number|null,
 *   signatureHelpConcurrency:number|null,
 *   definitionConcurrency:number|null,
 *   typeDefinitionConcurrency:number|null,
 *   referencesConcurrency:number|null,
 *   hoverEnabled:boolean|null,
 *   signatureHelpEnabled:boolean|null,
 *   definitionEnabled:boolean|null,
 *   typeDefinitionEnabled:boolean|null,
 *   referencesEnabled:boolean|null,
 *   hoverRequireMissingReturn:boolean|null,
 *   lifecycleRestartWindowMs:number|null,
 *   lifecycleMaxRestartsPerWindow:number|null,
 *   lifecycleFdPressureBackoffMs:number|null,
 *   sessionIdleTimeoutMs:number|null,
 *   sessionMaxLifetimeMs:number|null
 * }}
 */
export const resolveLspRuntimeConfig = (input = {}) => {
  const providerConfig = isPlainObject(input?.providerConfig) ? input.providerConfig : null;
  const globalConfigs = Array.isArray(input?.globalConfigs)
    ? input.globalConfigs.filter((entry) => isPlainObject(entry))
    : [];
  const defaults = isPlainObject(input?.defaults) ? input.defaults : {};

  return {
    timeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['timeoutMs'],
      min: 1000,
      fallback: defaults.timeoutMs ?? null
    }),
    retries: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['maxRetries', 'retries'],
      min: 0,
      fallback: defaults.retries ?? null
    }),
    breakerThreshold: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['circuitBreakerThreshold', 'breakerThreshold'],
      min: 1,
      fallback: defaults.breakerThreshold ?? null
    }),
    documentSymbolTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['documentSymbolTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    hoverTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['hoverTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    signatureHelpTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['signatureHelpTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    definitionTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['definitionTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    typeDefinitionTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['typeDefinitionTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    referencesTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['referencesTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    hoverMaxPerFile: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['hoverMaxPerFile'],
      min: 0,
      fallback: null
    }),
    hoverDisableAfterTimeouts: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['hoverDisableAfterTimeouts'],
      min: 1,
      fallback: null
    }),
    signatureHelpConcurrency: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['signatureHelpConcurrency'],
      min: 1,
      fallback: null
    }),
    definitionConcurrency: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['definitionConcurrency'],
      min: 1,
      fallback: null
    }),
    typeDefinitionConcurrency: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['typeDefinitionConcurrency'],
      min: 1,
      fallback: null
    }),
    referencesConcurrency: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['referencesConcurrency'],
      min: 1,
      fallback: null
    }),
    hoverEnabled: resolveBooleanSetting({
      providerConfig,
      globalConfigs,
      keys: ['hoverEnabled', 'hover'],
      fallback: null
    }),
    signatureHelpEnabled: resolveBooleanSetting({
      providerConfig,
      globalConfigs,
      keys: ['signatureHelpEnabled', 'signatureHelp'],
      fallback: null
    }),
    definitionEnabled: resolveBooleanSetting({
      providerConfig,
      globalConfigs,
      keys: ['definitionEnabled', 'definition'],
      fallback: null
    }),
    typeDefinitionEnabled: resolveBooleanSetting({
      providerConfig,
      globalConfigs,
      keys: ['typeDefinitionEnabled', 'typeDefinition'],
      fallback: null
    }),
    referencesEnabled: resolveBooleanSetting({
      providerConfig,
      globalConfigs,
      keys: ['referencesEnabled', 'references'],
      fallback: null
    }),
    hoverRequireMissingReturn: resolveBooleanSetting({
      providerConfig,
      globalConfigs,
      keys: ['hoverRequireMissingReturn'],
      fallback: null
    }),
    lifecycleRestartWindowMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['lifecycleRestartWindowMs', 'restartWindowMs'],
      min: 1000,
      fallback: null
    }),
    lifecycleMaxRestartsPerWindow: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['lifecycleMaxRestartsPerWindow', 'maxRestartsPerWindow'],
      min: 2,
      fallback: null
    }),
    lifecycleFdPressureBackoffMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['lifecycleFdPressureBackoffMs', 'fdPressureBackoffMs'],
      min: 50,
      fallback: null
    }),
    sessionIdleTimeoutMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['sessionIdleTimeoutMs', 'lifecycleSessionIdleTimeoutMs', 'idleTimeoutMs'],
      min: 1000,
      fallback: null
    }),
    sessionMaxLifetimeMs: resolveIntegerSetting({
      providerConfig,
      globalConfigs,
      keys: ['sessionMaxLifetimeMs', 'lifecycleSessionMaxLifetimeMs', 'maxLifetimeMs'],
      min: 1000,
      fallback: null
    })
  };
};
