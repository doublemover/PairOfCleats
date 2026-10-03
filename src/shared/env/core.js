import { normalizeBooleanString } from '../boolean-normalization.js';

export const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const normalizeBoolean = (value) => normalizeBooleanString(value, { fallback: false });

export const normalizeOptionalBoolean = (value) => normalizeBooleanString(value, {
  fallback: false,
  nullish: null,
  empty: null
});

export const normalizeOptionalDisableFlag = (value) => normalizeBooleanString(value, {
  fallback: true,
  nullish: null,
  empty: null
});

export const normalizeProgressContext = (value) => {
  const text = normalizeString(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const runId = normalizeString(parsed.runId);
    const jobId = normalizeString(parsed.jobId);
    const out = {};
    if (runId) out.runId = runId;
    if (jobId) out.jobId = jobId;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
};

export const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

export const normalizeStringList = (value) => {
  const text = normalizeString(value);
  if (!text) return [];
  return Array.from(new Set(
    text
      .split(',')
      .map((entry) => normalizeString(entry).toLowerCase())
      .filter(Boolean)
  ));
};
