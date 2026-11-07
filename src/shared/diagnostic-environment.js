/** Diagnostic receipts deliberately do not inherit the execution environment.
 * Unknown keys, opaque config blobs, paths and credential values are excluded.
 */
export const DIAGNOSTIC_ENVIRONMENT_VERSION = 1;

const boolean = value => /^(?:true|false|0|1)$/u.test(value) ? value : null;
const positive = value => /^\d{1,10}$/u.test(value) && Number.isSafeInteger(Number(value))
  && Number(value) > 0 ? String(Number(value)) : null;
const fields = Object.freeze({
  ORG_GRADLE_DAEMON: boolean,
  GRADLE_OPTS: value => /^-Dorg\.gradle\.daemon=(?:true|false)$/u.test(value) ? value : null,
  NODE_OPTIONS: value => /^(?:--(?:max-old-space-size|max-semi-space-size|stack-size)=\d{1,10})(?:\s+--(?:max-old-space-size|max-semi-space-size|stack-size)=\d{1,10})*$/u.test(value)
    ? value.replace(/\s+/gu, ' ') : null,
  PAIROFCLEATS_TESTING: boolean,
  PAIROFCLEATS_CRASH_LOG_ANNOUNCE: boolean,
  PAIROFCLEATS_THREADS: positive,
  PAIROFCLEATS_SCHEDULER: boolean,
  PAIROFCLEATS_SCHEDULER_ADAPTIVE: boolean,
  PAIROFCLEATS_SCHEDULER_CPU: positive,
  PAIROFCLEATS_SCHEDULER_IO: positive,
  PAIROFCLEATS_SCHEDULER_MEM: positive,
  PAIROFCLEATS_EMBEDDINGS: value => ['off', 'false', '0', 'disabled', 'none', 'stub'].includes(value) ? value : null
});

export const projectDiagnosticEnvironment = (env = process.env) => {
  const selected = {};
  for (const key of Object.keys(fields).sort()) {
    // Never invoke caller-owned getters merely to produce a report.
    const descriptor = Object.getOwnPropertyDescriptor(env || {}, key);
    if (!descriptor || typeof descriptor.value !== 'string' || descriptor.value.length > 1024) continue;
    const value = fields[key](descriptor.value.trim());
    if (value !== null) selected[key] = value;
  }
  return { projectionVersion: DIAGNOSTIC_ENVIRONMENT_VERSION, selected };
};
