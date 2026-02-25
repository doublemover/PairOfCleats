import { getEnvConfig } from '../../../shared/env.js';

const HANG_PROBE_WARN_DEFAULT_MS = 10000;
const HANG_PROBE_HEARTBEAT_DEFAULT_MS = 30000;
const HANG_PROBE_HEARTBEAT_MIN_MS = 1000;

const normalizePositiveInt = (value, fallback, minValue = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.floor(parsed));
};

/**
 * Resolve hang-probe runtime configuration from env settings.
 *
 * @param {object|null} [envConfig]
 * @returns {{enabled:boolean,warnMs:number,heartbeatMs:number}}
 */
export const resolveHangProbeConfig = (envConfig = null) => {
  const config = envConfig && typeof envConfig === 'object'
    ? envConfig
    : getEnvConfig();
  return {
    enabled: config?.debugHangProbes === true,
    warnMs: normalizePositiveInt(config?.debugHangProbeWarnMs, HANG_PROBE_WARN_DEFAULT_MS),
    heartbeatMs: normalizePositiveInt(
      config?.debugHangProbeHeartbeatMs,
      HANG_PROBE_HEARTBEAT_DEFAULT_MS,
      HANG_PROBE_HEARTBEAT_MIN_MS
    )
  };
};

/**
 * Run an operation with optional begin/heartbeat/end instrumentation logs.
 *
 * @param {{
 *   enabled?:boolean,
 *   warnMs?:number,
 *   heartbeatMs?:number,
 *   label?:string,
 *   mode?:string|null,
 *   stage?:string|null,
 *   step?:string|null,
 *   meta?:object|null,
 *   log?:(line:string,meta?:object)=>void,
 *   run:()=>Promise<unknown>|unknown
 * }} input
 * @returns {Promise<unknown>}
 */
export const runWithHangProbe = async ({
  enabled = false,
  warnMs = HANG_PROBE_WARN_DEFAULT_MS,
  heartbeatMs = HANG_PROBE_HEARTBEAT_DEFAULT_MS,
  label = 'hang-probe',
  mode = null,
  stage = null,
  step = null,
  meta = null,
  log = null,
  run
} = {}) => {
  if (typeof run !== 'function') {
    throw new TypeError('runWithHangProbe requires a run() function.');
  }
  if (!enabled || typeof log !== 'function') {
    return run();
  }
  const normalizedLabel = typeof label === 'string' && label.trim() ? label.trim() : 'hang-probe';
  const resolvedWarnMs = normalizePositiveInt(warnMs, HANG_PROBE_WARN_DEFAULT_MS);
  const resolvedHeartbeatMs = normalizePositiveInt(
    heartbeatMs,
    HANG_PROBE_HEARTBEAT_DEFAULT_MS,
    HANG_PROBE_HEARTBEAT_MIN_MS
  );
  const baseMeta = {};
  if (typeof mode === 'string' && mode.trim()) baseMeta.mode = mode.trim();
  if (typeof stage === 'string' && stage.trim()) baseMeta.stage = stage.trim();
  if (typeof step === 'string' && step.trim()) baseMeta.step = step.trim();
  const extraMeta = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta
    : null;
  const startAtMs = Date.now();

  /**
   * @param {'begin'|'heartbeat'|'end'|'error'} event
   * @param {number} elapsedMs
   * @param {string} line
   * @param {'status'|'warning'} [kind]
   * @param {unknown} [error]
   * @returns {void}
   */
  const emit = (event, elapsedMs, line, kind = 'status', error = null) => {
    const hangProbeMeta = {
      event,
      label: normalizedLabel,
      elapsedMs,
      warnMs: resolvedWarnMs,
      heartbeatMs: resolvedHeartbeatMs
    };
    if (error?.code) {
      hangProbeMeta.errorCode = String(error.code);
    }
    const payload = {
      kind,
      ...baseMeta,
      ...(extraMeta || {}),
      hangProbe: hangProbeMeta
    };
    log(line, payload);
  };

  emit('begin', 0, `[hang-probe] begin ${normalizedLabel}.`);
  let heartbeatTimer = null;
  if (resolvedHeartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      const elapsedMs = Math.max(0, Date.now() - startAtMs);
      emit(
        'heartbeat',
        elapsedMs,
        `[hang-probe] waiting ${normalizedLabel} (${elapsedMs}ms).`,
        elapsedMs >= resolvedWarnMs ? 'warning' : 'status'
      );
    }, resolvedHeartbeatMs);
    if (typeof heartbeatTimer?.unref === 'function') heartbeatTimer.unref();
  }

  try {
    const result = await run();
    const elapsedMs = Math.max(0, Date.now() - startAtMs);
    emit(
      'end',
      elapsedMs,
      `[hang-probe] end ${normalizedLabel} (${elapsedMs}ms).`,
      elapsedMs >= resolvedWarnMs ? 'warning' : 'status'
    );
    return result;
  } catch (err) {
    const elapsedMs = Math.max(0, Date.now() - startAtMs);
    const errMessage = typeof err?.message === 'string' && err.message
      ? ` (${err.message})`
      : '';
    emit(
      'error',
      elapsedMs,
      `[hang-probe] error ${normalizedLabel} after ${elapsedMs}ms${errMessage}.`,
      'warning',
      err
    );
    throw err;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
};
