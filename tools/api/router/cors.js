const isLocalOrigin = (origin) => {
  try {
    const parsed = new URL(origin);
    const host = String(parsed.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
};

const createOriginMatcher = (cors = {}) => {
  const allowAnyOrigin = cors.allowAnyOrigin === true;
  const allowLocalOrigins = cors.allowLocalOrigin === true;
  const allowedOrigins = Array.isArray(cors.allowedOrigins)
    ? cors.allowedOrigins.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const isOriginAllowed = (origin) => {
    if (allowAnyOrigin) return true;
    if (allowLocalOrigins) return isLocalOrigin(origin);
    const raw = String(origin || '').trim();
    if (!raw) return false;
    const lowered = raw.toLowerCase();
    return allowedOrigins.some((entry) => {
      const normalized = String(entry || '').trim().toLowerCase();
      if (!normalized) return false;
      if (normalized.includes('://')) return normalized === lowered;
      try {
        const parsed = new URL(raw);
        return parsed.hostname.toLowerCase() === normalized;
      } catch {
        return false;
      }
    });
  };
  return { isOriginAllowed };
};

export const createCorsResolver = (cors = {}) => {
  const { isOriginAllowed } = createOriginMatcher(cors);
  const resolveCorsHeaders = (req) => {
    const origin = req?.headers?.origin ? String(req.headers.origin) : '';
    if (!origin) return null;
    if (!isOriginAllowed(origin)) return null;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin'
    };
  };
  return { resolveCorsHeaders };
};
