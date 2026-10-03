import { sha1 } from '../../src/shared/hash.js';

const sanitizeChunkUidToken = (value, fallback = 'fixture') => {
  const text = String(value || '').trim().replace(/[^a-zA-Z0-9._/#:-]+/g, '_');
  return text || fallback;
};

export const createCanonicalTestChunkUid = ({
  namespace = 'test',
  virtualPath,
  salt = null
} = {}) => {
  const safeNamespace = sanitizeChunkUidToken(namespace, 'test');
  const safePath = sanitizeChunkUidToken(virtualPath, 'fixture');
  const digest = sha1(`${safeNamespace}\0${safePath}\0${String(salt || safePath)}`).slice(0, 16);
  return `ck64:v1:${safeNamespace}:${safePath}:${digest}`;
};
