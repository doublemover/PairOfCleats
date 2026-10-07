/** An omitted estimate is unknown; an explicitly supplied zero is authoritative. */
export const resolveBenchQueryByteEstimate = async (value, readFallback) => {
  const supplied = typeof value === 'number'
    || (typeof value === 'string' && value.trim().length > 0);
  const numeric = supplied ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : readFallback();
};
