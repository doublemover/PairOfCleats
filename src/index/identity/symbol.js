import { buildScopedSymbolId, buildSignatureKey, buildSymbolId, buildSymbolKey } from '../../shared/identity.js';
import { toKindGroup } from './kind-group.js';

const normalizeString = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const isDefinitionChunk = ({ name, kind, kindGroup, lang }) => {
  if (!lang) return false;
  if (!name) return false;
  if (name === '(module)' && kindGroup !== 'module') return false;
  return Boolean(kind) || name === '(module)';
};

export const buildSymbolIdentity = ({ metaV2 }) => {
  if (!metaV2 || typeof metaV2 !== 'object') return null;
  const name = normalizeString(metaV2.name);
  const kind = normalizeString(metaV2.kind);
  const lang = normalizeString(metaV2.lang);
  const kindGroup = toKindGroup(kind);
  if (!isDefinitionChunk({ name, kind, kindGroup, lang })) return null;
  const qualifiedName = name;
  const symbolKey = buildSymbolKey({
    virtualPath: metaV2.virtualPath,
    qualifiedName,
    kindGroup
  });
  if (!symbolKey) return null;
  const signatureKey = buildSignatureKey({ qualifiedName, signature: metaV2.signature });
  const scopedId = buildScopedSymbolId({
    kindGroup,
    symbolKey,
    signatureKey,
    chunkUid: metaV2.chunkUid
  });
  const symbolId = buildSymbolId({ scopedId, scheme: 'heur' });
  return {
    v: 1,
    scheme: 'heur',
    kindGroup,
    qualifiedName,
    symbolKey,
    signatureKey: signatureKey || null,
    scopedId,
    symbolId
  };
};
