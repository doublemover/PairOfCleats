import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERAGE_SOURCE_IDENTITY_VERSION = 1;

/** Convert actual native separators only; a POSIX backslash is filename data. */
export const normalizeCoverageSourcePath = (input, root, { platform = process.platform } = {}) => {
  if (!input) return null;
  const raw = String(input), implementation = platform === 'win32' ? path.win32 : path.posix;
  if (raw.startsWith('node:') || raw.startsWith('internal/') || raw.includes('\0')) return null;
  let target = raw;
  if (raw.startsWith('file:')) {
    try { target = fileURLToPath(raw, { windows: platform === 'win32' }); }
    catch { return null; }
  }
  const relative = implementation.relative(implementation.resolve(root), implementation.resolve(root, target));
  if (!relative || relative === '..' || relative.startsWith(`..${implementation.sep}`) || implementation.isAbsolute(relative)) return null;
  return platform === 'win32' ? relative.replaceAll('\\', '/') : relative;
};

export const assertCoverageSourceIdentity = (artifact, { platform = process.platform } = {}) => {
  if (artifact?.sourceIdentityVersion !== COVERAGE_SOURCE_IDENTITY_VERSION || artifact?.sourcePlatform !== platform) {
    throw Object.assign(new Error('Coverage requires physical source identity from the same platform; legacy summaries cannot recover lost filename identity.'), {
      code: 'ERR_COVERAGE_SOURCE_IDENTITY'
    });
  }
};
