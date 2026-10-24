import { createHash } from 'node:crypto';
/** Keep canonical short tokens stable; changed spellings carry full raw identity. */
export const encodeFilenameKey = value => {
  const raw = value == null ? '' : String(value);
  if (/^[a-zA-Z0-9._-]{1,80}$/.test(raw) && !['.','..'].includes(raw)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(raw)) return raw;
  const label = raw.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,64) || 'unknown';
  return `${label}~${createHash('sha256').update(Buffer.from(raw,'utf16le')).digest('hex')}`;
};
