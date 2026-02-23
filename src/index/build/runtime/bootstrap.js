import { resolveRuntimeEnvelope } from '../../../shared/runtime-envelope.js';

/**
 * Create timed runtime-init logging helpers.
 *
 * @param {{log:(line:string)=>void}} input
 * @returns {{
 *   logInit:(label:string,startedAt:number)=>void,
 *   timeInit:<T>(label:string, fn:() => Promise<T>) => Promise<T>
 * }}
 */
export const createRuntimeInitTracer = ({ log }) => {
  /**
   * Emit a timed initialization step log entry.
   *
   * @param {string} label
   * @param {number} startedAt
   * @returns {void}
   */
  const logInit = (label, startedAt) => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    log(`[init] ${label} (${elapsed}ms)`);
  };
  /**
   * Run one initialization phase and log elapsed time.
   *
   * @template T
   * @param {string} label
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  const timeInit = async (label, fn) => {
    const startedAt = Date.now();
    const result = await fn();
    logInit(label, startedAt);
    return result;
  };
  return { logInit, timeInit };
};

/**
 * Start runtime-envelope resolution before calibration/daemon wiring to overlap
 * independent startup work.
 *
 * Sequencing contract:
 * - Invoke after `userConfig` + `autoPolicy` are finalized.
 * - Await `promise` before any code reads `envelope.concurrency` or
 *   `envelope.queues`.
 * - Use `startedAt` with `logInit('runtime envelope', startedAt)` so elapsed
 *   timing includes overlap with other bootstrap phases.
 *
 * @param {{
 *   argv:object,
 *   rawArgv:string[]|undefined,
 *   userConfig:object,
 *   autoPolicy:object|null,
 *   env:NodeJS.ProcessEnv,
 *   execArgv:string[],
 *   cpuCount:number,
 *   processInfo:object,
 *   toolVersion:string
 * }} input
 * @returns {{startedAt:number,promise:Promise<object>}}
 */
export const startRuntimeEnvelopeInitialization = ({
  argv,
  rawArgv,
  userConfig,
  autoPolicy,
  env,
  execArgv,
  cpuCount,
  processInfo,
  toolVersion
}) => {
  const startedAt = Date.now();
  return {
    startedAt,
    promise: resolveRuntimeEnvelope({
      argv,
      rawArgv,
      userConfig,
      autoPolicy,
      env,
      execArgv,
      cpuCount,
      processInfo,
      toolVersion
    })
  };
};
