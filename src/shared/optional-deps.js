import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const isVerbose = (options = {}) => {
  if (options.verbose === true) return true;
  const raw = String(process.env.PAIROFCLEATS_VERBOSE || '').trim().toLowerCase();
  return TRUE_VALUES.has(raw);
};

const normalizeErrorReason = (err) => {
  const code = err?.code;
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'missing';
  }
  if (code === 'ERR_REQUIRE_ESM') return 'unsupported';
  return 'error';
};

const maybeLog = (message, err, options = {}) => {
  if (!isVerbose(options)) return;
  const logger = typeof options.logger === 'function' ? options.logger : console.warn;
  const detail = err?.message ? ` (${err.message})` : '';
  logger(`[deps] ${message}${detail}`);
};

export function tryRequire(name, options = {}) {
  try {
    const mod = require(name);
    return { ok: true, mod };
  } catch (err) {
    const reason = normalizeErrorReason(err);
    maybeLog(`Optional dependency unavailable: ${name}`, err, options);
    return { ok: false, error: err, reason };
  }
}

export async function tryImport(name, options = {}) {
  try {
    const mod = await import(name);
    return { ok: true, mod };
  } catch (err) {
    const reason = normalizeErrorReason(err);
    maybeLog(`Optional dependency unavailable: ${name}`, err, options);
    return { ok: false, error: err, reason };
  }
}
