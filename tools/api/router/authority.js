import { isIP } from 'node:net';

const normalizeHost = value => {
  let host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host.startsWith('::ffff:') && isIP(host.slice(7)) === 4) host = host.slice(7);
  return host;
};
const loopback = host => ['localhost', '127.0.0.1', '::1'].includes(host);
const wildcard = host => host === '0.0.0.0' || host === '::';

/** HTTP authority only: URLs, credentials, separators and ambiguous ports fail. */
export const parseRequestAuthority = value => {
  if (typeof value !== 'string' || !value || value.length > 1024
    || /[\s,/@#?%\\]/.test(value) || value.endsWith(':')) return null;
  try {
    const url = new URL('http://' + value);
    const hostname = normalizeHost(url.hostname);
    const port = Number(url.port || 80);
    if (!hostname || url.username || url.password || url.pathname !== '/'
      || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { hostname, port, key: hostname + ':' + port };
  } catch { return null; }
};

/** Same-origin browser modules need no cross-origin grant after Host validation. */
export const isSameOriginRequest = (req, origin) => {
  if (typeof origin !== 'string' || !origin || origin.length > 1024) return false;
  try {
    const parsed = new URL(origin);
    const protocol = req?.socket?.encrypted ? 'https:' : 'http:';
    if (parsed.protocol !== protocol || parsed.origin !== origin) return false;
    const request = parseRequestAuthority(req?.headers?.host);
    const originPort = Number(parsed.port || (protocol === 'https:' ? 443 : 80));
    return !!request && request.hostname === normalizeHost(parsed.hostname) && request.port === originPort;
  } catch { return false; }
};

/** Explicit proxy authorities never confer authentication or repository access. */
export const createAuthorityGuard = ({ host = '127.0.0.1', allowedHosts = [] } = {}) => {
  const configured = normalizeHost(host);
  const allowed = new Set();
  for (const value of allowedHosts) {
    const authority = parseRequestAuthority(value);
    if (!authority) throw new TypeError('Invalid allowed HTTP authority: ' + value);
    allowed.add(authority.key);
  }
  return req => {
    const authority = parseRequestAuthority(req?.headers?.host);
    let hostHeaders = 0;
    for (let i = 0; i < (req?.rawHeaders?.length || 0); i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() === 'host') hostHeaders += 1;
    }
    if (!authority || hostHeaders > 1) return { ok: false, status: 400, message: 'Missing or invalid Host authority.' };
    // Absolute-form requests must not supply a different routing authority.
    if (/^https?:\/\//i.test(req.url || '')) {
      let target;
      try { target = new URL(req.url); } catch { return { ok: false, status: 400, message: 'Invalid request URL.' }; }
      const targetKey = normalizeHost(target.hostname) + ':' + Number(target.port || (target.protocol === 'https:' ? 443 : 80));
      if (target.username || target.password || targetKey !== authority.key) {
        return { ok: false, status: 403, message: 'Request URL authority differs from Host.' };
      }
    }
    if (allowed.has(authority.key)) return { ok: true };
    const local = normalizeHost(req?.socket?.localAddress);
    const port = req?.socket?.localPort;
    const portMatches = Number.isInteger(port) ? authority.port === port : authority.port === 80;
    const localListener = loopback(configured) || (wildcard(configured) && loopback(local));
    const hostMatches = localListener ? loopback(authority.hostname)
      : authority.hostname === (wildcard(configured) ? local : configured) || authority.hostname === local;
    return hostMatches && portMatches ? { ok: true }
      : { ok: false, status: 403, message: 'Host authority is not allowed for this listener.' };
  };
};
