/**
 * Build a stable failure reason string for spawnSync subprocess results.
 *
 * @param {{status?:number|null,signal?:string|null,error?:{message?:string}|null}|null|undefined} result
 * @returns {string}
 */
export const formatSpawnFailureReason = (result) => {
  const signal = typeof result?.signal === 'string' && result.signal.trim().length > 0
    ? result.signal.trim()
    : null;
  if (signal) return `signal ${signal}`;
  if (Number.isInteger(result?.status)) return `exit ${Number(result.status)}`;
  if (typeof result?.error?.message === 'string' && result.error.message.trim().length > 0) {
    return result.error.message.trim();
  }
  return 'exit unknown';
};

/** Keep compiler failures distinct from work never admitted after that failure. */
export const summarizeNativeBuildResults = (rows) => {
  const counts = { required: { failed: 0, cancelled: 0, blocked: 0 },
    optional: { failed: 0, cancelled: 0, blocked: 0 } };
  for (const row of rows) {
    if (row.status === 'succeeded') continue;
    const group = row.required === false ? counts.optional : counts.required;
    const state = ['cancelled', 'blocked'].includes(row.status) ? row.status : 'failed';
    group[state]++;
  }
  return counts;
};
