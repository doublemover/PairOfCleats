import { createInstallError, withTimeoutSignal } from './install-shared.js';

const ORIGINS = new Set(['https://api.github.com', 'https://github.com',
  'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);
const validate = (value) => {
  const url = new URL(value);
  if (!ORIGINS.has(url.origin) || url.username || url.password) {
    throw createInstallError('official_release_origin_rejected', 'Release download left its approved vendor origins.');
  }
  return url.href;
};

/** Public vendor requests only; redirects are checked before fetching each hop. */
export const downloadOfficialGitHubRelease = async ({ url, maxBytes, timeoutMs = 120_000,
  fetchImpl = fetch } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Release download needs a positive byte limit.');
  const timeout = withTimeoutSignal(timeoutMs);
  let current = validate(url);
  try {
    for (let hop = 0; hop <= 3; hop += 1) {
      const response = await fetchImpl(current, { redirect: 'manual', signal: timeout.signal,
        headers: { accept: current.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/octet-stream' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel?.();
        if (!location || hop === 3) throw createInstallError('official_release_redirect_limit', 'Invalid/excessive release redirect.');
        current = validate(new URL(location, current).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.();
        throw createInstallError('official_release_http_error', `Official release request returned HTTP ${response.status}.`);
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel?.();
        throw createInstallError('official_release_too_large', 'Official release exceeds its download limit.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > maxBytes) {
          await response.body?.cancel?.().catch(() => {});
          throw createInstallError('official_release_too_large', 'Official release exceeds its download limit.');
        }
        chunks.push(Buffer.from(chunk));
      }
      if (!size) throw createInstallError('official_release_empty', 'Official release response was empty.');
      return { body: Buffer.concat(chunks, size), sourceUrl: url };
    }
    throw createInstallError('official_release_redirect_limit', 'Release redirect limit reached.');
  } finally {
    timeout.clear();
  }
};
