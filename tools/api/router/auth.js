export const createAuthGuard = (auth = {}) => {
  const authToken = typeof auth.token === 'string' && auth.token.trim()
    ? auth.token.trim()
    : null;
  const authRequired = auth.required === true;
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
    return token === authToken;
  };
  return { isAuthorized };
};
