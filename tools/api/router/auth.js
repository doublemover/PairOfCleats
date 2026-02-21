import crypto from 'node:crypto';

export const createAuthGuard = (auth = {}) => {
  const authToken = typeof auth.token === 'string' && auth.token.trim()
    ? auth.token.trim()
    : null;
  const authRequired = auth.required === true;
  const authTokenBytes = authToken ? Buffer.from(authToken, 'utf8') : null;
  const hashToken = (value) => crypto.createHash('sha256').update(value).digest();
  const timingSafeBearerCompare = (providedToken) => {
    if (!authTokenBytes || typeof providedToken !== 'string') return false;
    const providedBytes = Buffer.from(providedToken, 'utf8');
    if (providedBytes.length === authTokenBytes.length) {
      return crypto.timingSafeEqual(providedBytes, authTokenBytes);
    }
    // Compare digests when lengths differ so mismatch timing stays uniform.
    const providedDigest = hashToken(providedBytes);
    const expectedDigest = hashToken(authTokenBytes);
    return crypto.timingSafeEqual(providedDigest, expectedDigest) && false;
  };
  const parseBearerToken = (header) => {
    const value = String(header || '').trim();
    if (!value) return null;
    if (!value.toLowerCase().startsWith('bearer ')) return null;
    const token = value.slice(7).trim();
    return token || null;
  };
  const isAuthorized = (req) => {
    if (!authRequired) return true;
    if (!authToken) return false;
    const header = req?.headers?.authorization || '';
    const token = parseBearerToken(header);
    if (!token) return false;
    return timingSafeBearerCompare(token);
  };
  return { isAuthorized };
};
