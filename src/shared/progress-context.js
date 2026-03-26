export const buildProgressContext = ({ runId = '', jobId = '' } = {}) => {
  const payload = {};
  if (typeof runId === 'string' && runId.trim()) payload.runId = runId.trim();
  if (typeof jobId === 'string' && jobId.trim()) payload.jobId = jobId.trim();
  return Object.keys(payload).length ? payload : null;
};

export const applyProgressContextEnv = (env, context) => {
  const base = env && typeof env === 'object' ? env : process.env;
  const next = { ...base };
  const normalized = buildProgressContext(context || {});
  if (!normalized) {
    delete next.PAIROFCLEATS_PROGRESS_CONTEXT;
    return next;
  }
  next.PAIROFCLEATS_PROGRESS_CONTEXT = JSON.stringify(normalized);
  return next;
};
