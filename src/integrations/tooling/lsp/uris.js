import { checksumString } from '../../../shared/hash.js';

const VFS_URI_SCHEME = 'poc-vfs';
const TOKEN_PARAM = 'token';
const TOKEN_CACHE = new Map();
const TOKEN_CACHE_MAX = 20000;

const normalizeTokenMode = (mode) => {
  if (!mode) return 'docHash+virtualPath';
  const normalized = String(mode).trim();
  if (!normalized) return 'docHash+virtualPath';
  return normalized;
};

export const encodeVfsVirtualPath = (virtualPath) => {
  const raw = String(virtualPath || '');
  if (!raw) return '';
  return raw.split('/').map((part) => encodeURIComponent(part)).join('/');
};

export const decodeVfsVirtualPath = (encodedPath) => {
  const raw = String(encodedPath || '');
  if (!raw) return '';
  const decodedParts = [];
  for (const part of raw.split('/')) {
    try {
      decodedParts.push(decodeURIComponent(part));
    } catch {
      return null;
    }
  }
  return decodedParts.join('/');
};

export const buildVfsUri = (virtualPath) => {
  const encoded = encodeVfsVirtualPath(virtualPath);
  return `${VFS_URI_SCHEME}:///${encoded}`;
};

const resolveTokenSeed = ({ virtualPath, docHash, mode }) => {
  const normalizedMode = normalizeTokenMode(mode);
  const safeVirtualPath = String(virtualPath || '');
  const safeDocHash = String(docHash || '');
  if (normalizedMode === 'docHash') {
    return safeDocHash || safeVirtualPath;
  }
  if (normalizedMode === 'docHash+virtualPath') {
    return safeDocHash ? `${safeDocHash}|${safeVirtualPath}` : safeVirtualPath;
  }
  return safeVirtualPath;
};

export const buildVfsToken = async ({ virtualPath, docHash = null, mode = null }) => {
  const seed = resolveTokenSeed({ virtualPath, docHash, mode });
  if (!seed) return '';
  const hash = await checksumString(seed);
  return hash?.value || '';
};

export const registerVfsTokenMapping = (token, virtualPath) => {
  if (!token || !virtualPath) return;
  if (TOKEN_CACHE.has(token)) {
    TOKEN_CACHE.delete(token);
  }
  TOKEN_CACHE.set(token, virtualPath);
  if (TOKEN_CACHE.size <= TOKEN_CACHE_MAX) return;
  const overflow = TOKEN_CACHE.size - TOKEN_CACHE_MAX;
  const iterator = TOKEN_CACHE.keys();
  for (let i = 0; i < overflow; i += 1) {
    const oldest = iterator.next();
    if (oldest.done) break;
    TOKEN_CACHE.delete(oldest.value);
  }
};

export const resolveVfsVirtualPathFromToken = (token) => {
  if (!token) return null;
  const mapped = TOKEN_CACHE.get(token) || null;
  if (!mapped) return null;
  TOKEN_CACHE.delete(token);
  TOKEN_CACHE.set(token, mapped);
  return mapped;
};

export const buildVfsTokenUri = ({ virtualPath, token }) => {
  const baseUri = buildVfsUri(virtualPath);
  if (!token) return baseUri;
  const encodedToken = encodeURIComponent(String(token));
  return `${baseUri}?${TOKEN_PARAM}=${encodedToken}`;
};

export const resolveVfsTokenUri = async ({
  virtualPath,
  docHash = null,
  mode = null,
  register = true
}) => {
  const token = await buildVfsToken({ virtualPath, docHash, mode });
  if (register && token) registerVfsTokenMapping(token, virtualPath);
  return { token, uri: buildVfsTokenUri({ virtualPath, token }) };
};

export const parseVfsTokenUri = (uri) => {
  if (!uri || typeof uri !== 'string') return null;
  const prefix = `${VFS_URI_SCHEME}:///`;
  if (!uri.startsWith(prefix)) return null;
  const remainder = uri.slice(prefix.length);
  const [rawPath, rawQuery] = remainder.split('?', 2);
  const virtualPath = decodeVfsVirtualPath(rawPath || '');
  const params = new URLSearchParams(rawQuery || '');
  const token = params.get(TOKEN_PARAM) || null;
  const mapped = token ? resolveVfsVirtualPathFromToken(token) : null;
  return {
    virtualPath: virtualPath || mapped || null,
    token: token || null
  };
};
