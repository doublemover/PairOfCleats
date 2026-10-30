import { displayWidth, sanitizeDisplayText, truncateLine } from './text.js';

/** Keep canonical events unchanged; human rows have a readable, bounded projection. */
export const formatHumanLog = (message, { width = 120, verbose = false } = {}) => {
  const text = sanitizeDisplayText(message);
  const budget = Math.max(12, Math.min(120, Number.isFinite(width) && width > 0 ? width - 1 : 120));
  let summary = text;
  if (!verbose && /^\[watchdog\]/.test(text)) {
    const progress = /\bprogress\s+\S+(?:\s+\([^)]*\))?/.exec(text)?.[0] || 'activity';
    const elapsed = /\belapsed=\S+/.exec(text)?.[0];
    const rate = /\brate=\S+(?:\s+files\/s)?/.exec(text)?.[0];
    const wait = /\b(?:wait|activity|reason)=([^;|]+?)(?=\s+\w+=|$)/.exec(text)?.[0];
    summary = ['[watchdog]', progress, elapsed, rate, wait].filter(Boolean).join(' ');
  }
  if (displayWidth(summary) <= budget && summary === text) return summary;
  const detail = ' [full: --progress jsonl]';
  if (budget <= displayWidth(detail) + 8) return truncateLine(summary, budget);
  return truncateLine(summary, budget - displayWidth(detail)) + detail;
};
