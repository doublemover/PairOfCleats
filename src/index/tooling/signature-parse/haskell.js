const HASKELL_PARAM = /^[a-z_][A-Za-z0-9_']*$/u;

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * Parse Haskell type signatures from HLS detail strings.
 *
 * Supported examples:
 * 1. `greet :: Text -> Text`
 * 2. `sumTwo :: Int -> Int -> Int`
 * 3. `mkPair :: a -> b -> (a, b)`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseHaskellSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const idx = signature.indexOf('::');
  if (idx === -1) return null;
  const rhs = normalizeType(signature.slice(idx + 2));
  if (!rhs) return null;
  const chain = rhs.split(/\s*->\s*/u).map((entry) => normalizeType(entry)).filter(Boolean);
  if (!chain.length) return null;
  const returnType = chain[chain.length - 1] || null;
  const paramTypes = {};
  const paramNames = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const name = `arg${i + 1}`;
    if (!HASKELL_PARAM.test(name)) continue;
    paramNames.push(name);
    paramTypes[name] = chain[i];
  }
  if (!returnType && !paramNames.length) return null;
  return {
    signature,
    returnType,
    paramTypes,
    paramNames
  };
};
