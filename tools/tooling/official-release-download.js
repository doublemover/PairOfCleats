import { createInstallError, withTimeoutSignal, downloadToBuffer } from './install-shared.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const ORIGINS = new Set(['https://api.github.com', 'https://github.com',
  'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const validate = (value) => {
  const url = new URL(value);
  if (!ORIGINS.has(url.origin) || url.username || url.password) {
    throw createInstallError('official_release_origin_rejected', 'Release download left its approved vendor origins.');
  }
  return url.href;
};

/** Public vendor requests only; redirects are checked before fetching each hop. */
export const downloadOfficialGitHubRelease = async ({ url, maxBytes, timeoutMs = 120_000,
  signal = null, settlementTimeoutMs = 4000, fetchImpl = fetch } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Release download needs a positive byte limit.');
  signal?.throwIfAborted();
  let current = validate(url);
  const timeout = withTimeoutSignal(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    for (let hop = 0; hop <= 3; hop += 1) {
      requestSignal.throwIfAborted();
      let response = null;
      try {
        const downloaded = await downloadToBuffer({ url: current, maxBytes, timeoutMs, settlementTimeoutMs,
          signal: requestSignal, redirect: 'manual', label: 'official release',
          headers: { accept: current.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/octet-stream' },
          fetchImpl: async (...args) => { response = await fetchImpl(...args); return response; } });
        return { ...downloaded, sourceUrl: url };
      } catch (value) {
        const error = asError(value);
        // The shared owner has either settled this exact response or retained
        // its actual body capability. Never issue a redirect's next request
        // while that body's cancellation/native close remains unconfirmed.
        let pending = false;
        try { pending = error.cacheOwnershipPending === true && error.cacheOwnershipReleased?.() !== true; }
        catch { pending = true; }
        let reason, statusCode;
        try { reason = error.reason; statusCode = error.statusCode; }
        catch (inspectionError) { throw addStorageFailureContext(error, { officialReleaseInspectionError: asError(inspectionError) }, inspectionError,
          { secondaryPresent: true }); }
        if (response && reason === 'download_http_error' && [301, 302, 303, 307, 308].includes(statusCode) && !pending) {
          let location;
          try { location = response.headers.get('location'); }
          catch (inspectionError) { throw addStorageFailureContext(error, { officialReleaseInspectionError: asError(inspectionError) }, inspectionError,
            { secondaryPresent: true }); }
          if (!location || hop === 3) throw createInstallError('official_release_redirect_limit', 'Invalid/excessive release redirect.', { cause: error });
          current = validate(new URL(location, current).href);
          continue;
        }
        const reasons = { download_http_error: 'official_release_http_error', download_too_large: 'official_release_too_large',
          download_empty_payload: 'official_release_empty' };
        const mapped = typeof reason === 'string' && Object.hasOwn(reasons, reason) ? reasons[reason] : null;
        if (mapped) throw addStorageFailureContext(error, { reason: mapped });
        throw error;
      }
    }
    throw createInstallError('official_release_redirect_limit', 'Release redirect limit reached.');
  } finally {
    timeout.clear();
  }
};
