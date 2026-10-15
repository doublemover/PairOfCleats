import { collectDeclaredReturnTypes, collectMetaV2ReturnTypes } from '../../../index/metadata/docmeta.js';

// Whitespace between tokens is insignificant. Literal contents and identifier
// case remain significant. This is expression identity, NOT assignability or
// alias expansion; presentation-only symbolic displays are never type facts.
const TYPE_TOKEN = /"(?:[\x5c][\s\S]|[^"\x5c])*"|'(?:[\x5c][\s\S]|[^'\x5c])*'|`(?:[\x5c][\s\S]|[^`\x5c])*`|[\p{L}\p{N}_$]+|[^\s]/gu;
export const normalizeTypeExpression = (value) => (
  typeof value === 'string' ? JSON.stringify(value.trim().match(TYPE_TOKEN) || []) : null
);

export function resolveReturnTypeFacts(chunk) {
  const compiler = [chunk?.docmeta?.inferredTypes?.returns, chunk?.metaV2?.types?.tooling?.returns, chunk?.metaV2?.types?.inferred?.returns]
    .flatMap((entries) => Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.source === 'tooling' && typeof entry.type === 'string' && entry.type.trim())
    .map((entry) => ({ type: entry.type.trim(), source: 'tooling', confidence: entry.confidence ?? null,
      ...(entry.evidence ? { evidence: entry.evidence } : {}), ...(entry.shape ? { shape: entry.shape } : {}) }));
  if (compiler.length) return deduplicateFacts(compiler);
  return deduplicateFacts([
    ...collectDeclaredReturnTypes(chunk?.docmeta),
    ...collectMetaV2ReturnTypes(chunk?.metaV2)
  ].map((type) => ({ type, source: 'declared', confidence: null })));
}

function deduplicateFacts(facts) {
  const seen = new Set();
  return facts.filter((fact) => {
    const key = normalizeTypeExpression(fact.type);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function matchReturnTypeExpression(chunk, requested) {
  const normalized = normalizeTypeExpression(requested);
  return Boolean(normalized && normalized !== '[]' && resolveReturnTypeFacts(chunk)
    .some((fact) => normalizeTypeExpression(fact.type) === normalized));
}
