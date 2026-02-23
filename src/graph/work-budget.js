import { normalizeOptionalNonNegativeInt } from '../shared/limits.js';

/**
 * Normalize optional budget limits to non-negative integers or null.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
const normalizeLimit = (value) => (
  value == null ? null : normalizeOptionalNonNegativeInt(value)
);

/**
 * Normalize cadence parameter used for periodic wall-clock checks.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const normalizeCadence = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

/**
 * Create a cooperative work/time budget guard for graph traversal operations.
 *
 * @param {{
 *  maxWorkUnits?:number,
 *  maxWallClockMs?:number,
 *  checkEvery?:number,
 *  now?:()=>number
 * }} [options]
 * @returns {{
 *  consume:(units?:number)=>{stop:boolean,reason:string|null,limit:number|null,elapsedMs:number|null,used:number},
 *  shouldStop:()=>boolean,
 *  buildTruncation:(scope:string,meta?:{observed?:number|null,omitted?:number|null,at?:string|null})=>object|null,
 *  getUsed:()=>number,
 *  getLimits:()=>{maxWorkUnits:number|null,maxWallClockMs:number|null},
 *  getStartedAt:()=>number
 * }}
 */
export const createWorkBudget = ({
  maxWorkUnits,
  maxWallClockMs,
  checkEvery = 256,
  now = () => Date.now()
} = {}) => {
  const maxUnits = normalizeLimit(maxWorkUnits);
  const maxMs = normalizeLimit(maxWallClockMs);
  const cadence = normalizeCadence(checkEvery, 256);
  const startedAt = now();
  let used = 0;
  let lastCheckAt = 0;
  const state = {
    stop: false,
    reason: null,
    limit: null,
    elapsedMs: null
  };

  /**
   * Consume one or more work units and evaluate active stop conditions.
   *
   * @param {number} [units=1]
   * @returns {{stop:boolean,reason:string|null,limit:number|null,elapsedMs:number|null,used:number}}
   */
  const consume = (units = 1) => {
    if (state.stop) return { ...state, used };
    const parsed = Number(units);
    const increment = Number.isFinite(parsed) ? Math.floor(parsed) : 1;
    used += Math.max(1, increment);
    if (maxUnits != null && used >= maxUnits) {
      state.stop = true;
      state.reason = 'maxWorkUnits';
      state.limit = maxUnits;
      state.elapsedMs = now() - startedAt;
      return { ...state, used };
    }
    if (maxMs != null && used - lastCheckAt >= cadence) {
      lastCheckAt = used;
      const elapsedMs = now() - startedAt;
      if (elapsedMs >= maxMs) {
        state.stop = true;
        state.reason = 'maxWallClockMs';
        state.limit = maxMs;
        state.elapsedMs = elapsedMs;
      }
    }
    return { ...state, used };
  };

  /**
   * Report whether traversal should stop based on consumed budget.
   *
   * @returns {boolean}
   */
  const shouldStop = () => state.stop;

  /**
   * Build truncation payload for result metadata when budget is exhausted.
   *
   * @param {string} scope
   * @param {{observed?:number|null,omitted?:number|null,at?:string|null}} [input]
   * @returns {object|null}
   */
  const buildTruncation = (scope, { observed = null, omitted = null, at = null } = {}) => {
    if (!state.stop || !state.reason) return null;
    return {
      scope,
      cap: state.reason,
      limit: state.limit,
      observed,
      omitted,
      at: at || null
    };
  };

  return {
    consume,
    shouldStop,
    buildTruncation,
    getUsed: () => used,
    getLimits: () => ({ maxWorkUnits: maxUnits, maxWallClockMs: maxMs }),
    getStartedAt: () => startedAt
  };
};

