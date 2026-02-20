/**
 * Normalize sqlite validate mode flag.
 * @param {string|boolean|null|undefined} value
 * @returns {'off'|'smoke'|'full'|'auto'}
 */
export const normalizeValidateMode = (value) => {
  if (value === false || value == null) return 'off';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'true') return 'smoke';
  if (['off', 'false', '0', 'no'].includes(normalized)) return 'off';
  if (['full', 'integrity'].includes(normalized)) return 'full';
  if (['auto', 'adaptive'].includes(normalized)) return 'auto';
  return 'smoke';
};

/**
 * Normalize mode argument from CLI or API options.
 * @param {string|undefined|null} value
 * @returns {'code'|'prose'|'extracted-prose'|'records'|'all'}
 */
export const normalizeModeArg = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['code', 'prose', 'extracted-prose', 'records', 'all'].includes(normalized)) {
    return normalized;
  }
  return 'all';
};
