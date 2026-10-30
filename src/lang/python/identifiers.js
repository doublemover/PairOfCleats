// Python 3.15 / UCD 17.0 identifier profile. XID is the NFKC-closed ID set.
// Decline another Node Unicode database rather than silently changing meaning.
export const PYTHON_IDENTIFIER_PROFILE = Object.freeze({ python: '3.15', unicode: '17.0',
  method: 'ucd-id-nfkc-closure', available: process.versions.unicode === '17.0' });
const identifier = /^[_\p{ID_Start}][_\p{ID_Continue}]*$/u;
const keywords = new Set(['False','None','True','and','as','assert','async','await','break','class','continue',
  'def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal',
  'not','or','pass','raise','return','try','while','with','yield']);
export const pythonIdentifier = raw => {
  if (!PYTHON_IDENTIFIER_PROFILE.available || typeof raw !== 'string' || !identifier.test(raw)) return null;
  const semantic = raw.normalize('NFKC');
  // Python reserves keyword source spelling before normalization.
  if (!identifier.test(semantic) || keywords.has(raw)) return null;
  return { raw, semantic };
};
export const pythonModuleName = (raw, { allowRelative = false } = {}) => {
  const prefix = allowRelative ? raw.match(/^\.+/u)?.[0] || '' : '';
  const body = raw.slice(prefix.length);
  if (!body) return prefix ? { raw, semantic: prefix } : null;
  const names = body.split('.').map(pythonIdentifier);
  return names.every(Boolean) ? { raw, semantic: prefix + names.map(name => name.semantic).join('.') } : null;
};
