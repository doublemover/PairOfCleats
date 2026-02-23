/**
 * Format ETA seconds as a compact duration string.
 *
 * Default output prefers hour-format once total minutes exceed 59:
 * - `12m34s`
 * - `2h05m`
 *
 * @param {unknown} value
 * @param {{preferHours?:boolean,fallback?:string|null}} [options]
 * @returns {string|null}
 */
export const formatEtaSeconds = (
  value,
  { preferHours = true, fallback = null } = {}
) => {
  if (value == null) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return fallback;
  const whole = Math.max(0, Math.floor(seconds));
  const totalMinutes = Math.floor(whole / 60);
  const remSeconds = whole % 60;
  if (preferHours && totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const remMinutes = totalMinutes % 60;
    return `${hours}h${String(remMinutes).padStart(2, '0')}m`;
  }
  return `${totalMinutes}m${String(remSeconds).padStart(2, '0')}s`;
};
