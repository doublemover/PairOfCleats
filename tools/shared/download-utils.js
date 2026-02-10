import { createError, ERROR_CODES } from '../../src/shared/error-codes.js';

/**
 * Normalize a sha256 value to lowercase hex, or null if invalid.
 * @param {string|undefined|null} value
 * @returns {string|null}
 */
export function normalizeHash(value) {
  if (!value) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('sha256:') ? trimmed.slice(7) : trimmed;
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return normalized;
}

/**
 * Parse sha256 override entries in name=hash form.
 * @param {string|string[]|undefined|null} input
 * @returns {Record<string,string>}
 */
export function parseHashOverrides(input) {
  if (!input) return {};
  const items = Array.isArray(input) ? input : [input];
  const out = {};
  for (const item of items) {
    const text = String(item || '');
    const eq = text.indexOf('=');
    if (eq <= 0 || eq >= text.length - 1) continue;
    const name = text.slice(0, eq);
    const hash = normalizeHash(text.slice(eq + 1));
    if (name && hash) out[name] = hash;
  }
  return out;
}

/**
 * Resolve download policy settings.
 * @param {object} cfg
 * @param {object} [defaults]
 * @param {number} [defaults.defaultMaxBytes]
 * @returns {{
 *   requireHash:boolean,
 *   warnUnsigned:boolean,
 *   allowlist:Record<string,string>,
 *   maxBytes:number|undefined,
 *   timeoutMs:number|undefined,
 *   maxRedirects:number|undefined
 * }}
 */
export function resolveDownloadPolicy(cfg, defaults = {}) {
  const policy = cfg?.security?.downloads || {};
  const allowlist = policy.allowlist && typeof policy.allowlist === 'object'
    ? policy.allowlist
    : {};
  const maxBytesRaw = Number(policy.maxBytes);
  const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
    ? Math.floor(maxBytesRaw)
    : (Number.isFinite(defaults.defaultMaxBytes) ? defaults.defaultMaxBytes : undefined);
  const timeoutRaw = Number(policy.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.max(1000, Math.floor(timeoutRaw))
    : undefined;
  const maxRedirectsRaw = Number(policy.maxRedirects);
  const maxRedirects = Number.isFinite(maxRedirectsRaw) && maxRedirectsRaw >= 0
    ? Math.floor(maxRedirectsRaw)
    : undefined;
  return {
    requireHash: policy.requireHash === true,
    warnUnsigned: policy.warnUnsigned !== false,
    allowlist,
    maxBytes,
    timeoutMs,
    maxRedirects
  };
}

/**
 * Resolve the expected hash for a download source.
 * @param {{name?:string,url?:string,file?:string,sha256?:string,hash?:string}} source
 * @param {{allowlist?:Record<string,string>}} policy
 * @param {Record<string,string>} overrides
 * @returns {string|null}
 */
export function resolveExpectedHash(source, policy, overrides) {
  const explicit = normalizeHash(source?.sha256 || source?.hash);
  if (explicit) return explicit;
  const allowlist = policy?.allowlist || {};
  const fallback = overrides?.[source?.name]
    || overrides?.[source?.url]
    || overrides?.[source?.file]
    || allowlist[source?.name]
    || allowlist[source?.url]
    || allowlist[source?.file];
  return normalizeHash(fallback);
}

/**
 * Validate the presence of an expected hash and optional computed hash.
 * @param {object} options
 * @param {object} options.source
 * @param {string|null} options.expectedHash
 * @param {string|null|undefined} options.actualHash
 * @param {{requireHash?:boolean,warnUnsigned?:boolean}} options.policy
 * @param {(message:string)=>void} [options.warn]
 * @returns {string|null}
 */
export function verifyDownloadHash({ source, expectedHash, actualHash, policy, warn }) {
  if (!expectedHash) {
    if (policy?.requireHash) {
      throw createError(
        ERROR_CODES.DOWNLOAD_VERIFY_FAILED,
        `Download verification requires a sha256 hash (${source?.name || source?.url || 'unknown source'}).`
      );
    }
    if (policy?.warnUnsigned) {
      warn?.(`[download] Skipping hash verification for ${source?.name || source?.url || 'unknown source'}.`);
    }
    return null;
  }
  if (!actualHash) {
    throw createError(
      ERROR_CODES.DOWNLOAD_VERIFY_FAILED,
      `Download verification failed for ${source?.name || source?.url || 'unknown source'}.`
    );
  }
  if (actualHash !== expectedHash) {
    throw createError(
      ERROR_CODES.DOWNLOAD_VERIFY_FAILED,
      `Download verification failed for ${source?.name || source?.url || 'unknown source'}.`
    );
  }
  return actualHash;
}
