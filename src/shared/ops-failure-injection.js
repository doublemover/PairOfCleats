import { getTestEnvConfig } from './env.js';

export const OP_FAILURE_CLASSES = Object.freeze({
  RETRIABLE: 'retriable',
  NON_RETRIABLE: 'non_retriable'
});

export const OP_FAILURE_CODES = Object.freeze({
  INJECTED_RETRIABLE: 'op_failure_injected_retriable',
  INJECTED_NON_RETRIABLE: 'op_failure_injected_non_retriable'
});

const RETRIABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
  'EAGAIN',
  'ENFILE',
  'EMFILE'
]);

let cachedConfigKey = null;
let cachedPolicy = null;
const injectionCounters = new Map();

const toText = (value) => String(value || '').trim();

const normalizeClass = (value) => {
  const text = toText(value).toLowerCase();
  if (text === OP_FAILURE_CLASSES.RETRIABLE) return OP_FAILURE_CLASSES.RETRIABLE;
  if (text === OP_FAILURE_CLASSES.NON_RETRIABLE || text === 'non-retriable') {
    return OP_FAILURE_CLASSES.NON_RETRIABLE;
  }
  return null;
};

const normalizeRetries = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const normalizeFailCount = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Parse and cache failure-injection policy from test config. Cache key uses
 * raw env inputs to avoid repeated JSON parse overhead on hot paths.
 */
const loadFailureInjectionPolicy = (env = process.env) => {
  const testingRaw = toText(env?.PAIROFCLEATS_TESTING);
  const configRaw = toText(env?.PAIROFCLEATS_TEST_CONFIG);
  const configKey = `${testingRaw}|${configRaw}`;
  if (cachedConfigKey === configKey && cachedPolicy) return cachedPolicy;
  if (cachedConfigKey !== configKey) injectionCounters.clear();
  cachedConfigKey = configKey;

  const testEnv = getTestEnvConfig(env);
  const raw = testEnv?.testing
    ? testEnv?.config?.ops?.failureInjection
    : null;
  const enabled = raw?.enabled === true;
  const retriableRetries = normalizeRetries(raw?.retriableRetries, 1);
  const rules = [];
  if (enabled && Array.isArray(raw?.rules)) {
    for (let i = 0; i < raw.rules.length; i += 1) {
      const entry = raw.rules[i];
      const target = toText(entry?.target);
      const failureClass = normalizeClass(entry?.failureClass);
      if (!target || !failureClass) continue;
      rules.push({
        id: `${target}#${i}`,
        target,
        failureClass,
        failCount: normalizeFailCount(entry?.failCount, 1),
        message: toText(entry?.message),
        code: toText(entry?.code)
      });
    }
  }
  cachedPolicy = Object.freeze({
    enabled,
    retriableRetries,
    rules: Object.freeze(rules)
  });
  return cachedPolicy;
};

/**
 * Reset cached injection state so tests can assert deterministic behavior.
 */
export const resetOperationalFailureInjectionState = () => {
  cachedConfigKey = null;
  cachedPolicy = null;
  injectionCounters.clear();
};

/**
 * Classify operational failures into retriable/non-retriable classes.
 * @param {any} error
 * @returns {{classification:'retriable'|'non_retriable', retriable:boolean, code:string}}
 */
export const classifyOperationalFailure = (error) => {
  const explicitClass = normalizeClass(error?.opFailureClass);
  if (explicitClass) {
    return {
      classification: explicitClass,
      retriable: explicitClass === OP_FAILURE_CLASSES.RETRIABLE,
      code: toText(error?.code)
    };
  }
  const code = toText(error?.code);
  const retriable = RETRIABLE_ERROR_CODES.has(code);
  return {
    classification: retriable ? OP_FAILURE_CLASSES.RETRIABLE : OP_FAILURE_CLASSES.NON_RETRIABLE,
    retriable,
    code
  };
};

const maybeInjectOperationalFailure = ({ target, env = process.env } = {}) => {
  const policy = loadFailureInjectionPolicy(env);
  if (!policy.enabled) return;
  const normalizedTarget = toText(target);
  if (!normalizedTarget) return;
  for (const rule of policy.rules) {
    if (rule.target !== normalizedTarget) continue;
    const seen = injectionCounters.get(rule.id) || 0;
    if (seen >= rule.failCount) continue;
    injectionCounters.set(rule.id, seen + 1);
    const injectedCode = rule.code
      || (rule.failureClass === OP_FAILURE_CLASSES.RETRIABLE
        ? OP_FAILURE_CODES.INJECTED_RETRIABLE
        : OP_FAILURE_CODES.INJECTED_NON_RETRIABLE);
    const message = rule.message
      || `[ops-fi] target=${normalizedTarget} class=${rule.failureClass} injected`;
    const error = new Error(message);
    error.code = injectedCode;
    error.opFailureClass = rule.failureClass;
    error.opFailureInjected = true;
    error.opFailureTarget = normalizedTarget;
    throw error;
  }
};

/**
 * Execute an operation with deterministic failure injection and retriable
 * recovery policy.
 * @param {{target:string,operation?:string,execute?:Function,log?:(msg:string)=>void,env?:object}} input
 * @returns {Promise<{value:any,attempts:number,recovered:boolean}>}
 */
export const runWithOperationalFailurePolicy = async ({
  target,
  operation = 'operation',
  execute = null,
  log = null,
  env = process.env
} = {}) => {
  const policy = loadFailureInjectionPolicy(env);
  const maxRetries = normalizeRetries(policy?.retriableRetries, 1);
  const run = typeof execute === 'function'
    ? execute
    : async () => null;
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      maybeInjectOperationalFailure({ target, env });
      const value = await run();
      return {
        value,
        attempts,
        recovered: attempts > 1
      };
    } catch (error) {
      const classification = classifyOperationalFailure(error);
      error.opFailureClassification = classification.classification;
      error.opFailureRetriable = classification.retriable;
      if (classification.retriable && attempts <= maxRetries) {
        if (typeof log === 'function') {
          log(
            `[ops] retriable failure target=${toText(target)} operation=${toText(operation)} `
            + `attempt=${attempts}/${maxRetries + 1} code=${classification.code || 'unknown'} `
            + `classification=${classification.classification}; retrying.`
          );
        }
        continue;
      }
      throw error;
    }
  }
};
