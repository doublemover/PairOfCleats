export const createAuthGuard = (auth = {}) => {
  const authToken = typeof auth.token === 'string' && auth.token.trim()
    ? auth.token.trim()
    : null;
  const authRequired = auth.required === true;
  const isAuthorized = (req) => {
    if (!authRequired) return true;
    if (!authToken) return false;
    const header = req?.headers?.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header));
    if (!match) return false;
    return match[1] === authToken;
  };
  return { isAuthorized };
};
