/**
 * Collect unique warnings while preserving insertion order.
 *
 * @returns {{warnings:string[], add:(warning:string)=>void}}
 */
export const createWarningCollector = () => {
  const warnings = [];
  const seen = new Set();
  const add = (warning) => {
    const text = typeof warning === 'string' ? warning.trim() : '';
    if (!text || seen.has(text)) return;
    seen.add(text);
    warnings.push(text);
  };
  return { warnings, add };
};

/**
 * Determine whether sparse preflight produced any missing-table entries.
 *
 * @param {Record<string, string[]>|null|undefined} sparseMissingByMode
 * @returns {boolean}
 */
export const hasSparseMissingEntries = (sparseMissingByMode) => {
  if (!sparseMissingByMode || typeof sparseMissingByMode !== 'object') return false;
  for (const mode in sparseMissingByMode) {
    if (!Object.prototype.hasOwnProperty.call(sparseMissingByMode, mode)) continue;
    const missing = sparseMissingByMode[mode];
    if (Array.isArray(missing) && missing.length) return true;
  }
  return false;
};

/**
 * Render sparse preflight table-miss details in warning or multi-line error format.
 *
 * @param {Record<string, string[]>|null|undefined} sparseMissingByMode
 * @param {{multiline?: boolean}} [options]
 * @returns {string}
 */
export const formatSparseMissingDetails = (sparseMissingByMode, { multiline = false } = {}) => {
  if (!sparseMissingByMode || typeof sparseMissingByMode !== 'object') return '';
  const lines = [];
  for (const mode in sparseMissingByMode) {
    if (!Object.prototype.hasOwnProperty.call(sparseMissingByMode, mode)) continue;
    const missing = sparseMissingByMode[mode];
    if (!Array.isArray(missing) || !missing.length) continue;
    const entry = `${mode}: ${missing.join(', ')}`;
    lines.push(multiline ? `- ${entry}` : entry);
  }
  return multiline ? lines.join('\n') : lines.join('; ');
};
