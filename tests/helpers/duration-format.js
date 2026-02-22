import { formatDurationMs as formatClockDuration } from '../../src/shared/time-format.js';

/**
 * Format duration for parity progress output.
 * @param {number} ms
 * @returns {string}
 */
export const formatParityDuration = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs - (mins * 60);
  return `${mins}m${rem.toFixed(0)}s`;
};

/**
 * Format duration for bench progress output (seconds/minutes/hours).
 * @param {number} ms
 * @returns {string}
 */
export const formatBenchDuration = (ms) => formatClockDuration(ms);

/**
 * Format duration in ms when sub-second, otherwise use bench duration format.
 * @param {number} ms
 * @returns {string}
 */
export const formatBenchDurationMs = (ms) => {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return formatBenchDuration(ms);
};
