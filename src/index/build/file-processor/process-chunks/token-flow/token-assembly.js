export const createDisabledTokenPayload = () => ({
  tokens: [],
  tokenIds: [],
  seq: [],
  minhashSig: [],
  stats: {},
  identifierTokens: [],
  keywordTokens: [],
  operatorTokens: [],
  literalTokens: []
});

/**
 * Merge classification buckets without cloning the token payload object.
 *
 * @param {object} tokenPayload
 * @param {object} classification
 * @returns {object}
 */
export const applyTokenClassification = (tokenPayload, classification) => {
  tokenPayload.identifierTokens = Array.isArray(classification?.identifierTokens)
    ? classification.identifierTokens
    : [];
  tokenPayload.keywordTokens = Array.isArray(classification?.keywordTokens)
    ? classification.keywordTokens
    : [];
  tokenPayload.operatorTokens = Array.isArray(classification?.operatorTokens)
    ? classification.operatorTokens
    : [];
  tokenPayload.literalTokens = Array.isArray(classification?.literalTokens)
    ? classification.literalTokens
    : [];
  return tokenPayload;
};
