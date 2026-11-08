import { createHash } from 'node:crypto';
import { stableStringify } from '../shared/stable-json.js';
export const isContextTokenFailure = error => ['ERR_CONTEXT_PACK_TOKEN_BUDGET', 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE',
  'ERR_CONTEXT_PACK_RESPONSE_BUDGET'].includes(error?.code);

export const contextDigest = value => createHash('sha256').update(value).digest('hex');
// Transport decoration and the receipt itself are outside the model envelope.
export const contextPayloadDigest = payload => {
  const { renderedContext: _text, tokenAccounting: _receipt, rendered: _transport, ...source } = payload;
  return contextDigest(stableStringify(source));
};
export const contextProfileDigest = profile => contextDigest(stableStringify({
  id: profile.id, revision: profile.revision, tokenizerSha256: profile.tokenizerSha256,
  configSha256: profile.configSha256, addSpecialTokens: profile.addSpecialTokens, engine: profile.engine
}));

export const contextTokenProjectionErrors = payload => {
  const receipt = payload.tokenAccounting, text = payload.renderedContext;
  if (receipt === undefined && text === undefined) return [];
  if (!receipt || typeof text !== 'string') return ['Rendered context and exact token accounting must occur together.'];
  const errors = [];
  if (receipt.renderedSha256 !== contextDigest(text) || receipt.renderedBytes !== Buffer.byteLength(text)) {
    errors.push('Rendered context identity does not match exact token accounting.');
  }
  if (receipt.payloadSha256 !== contextPayloadDigest(payload)) errors.push('Context payload changed after token accounting.');
  if (receipt.profileDigest !== contextProfileDigest({ ...receipt, id: receipt.profileId })) errors.push('Tokenizer profile identity does not match accounting.');
  const admitted = receipt.renderedTokens + receipt.reservedTokens;
  if (!Number.isSafeInteger(admitted) || admitted !== receipt.admittedTokens || admitted > receipt.maxTokens) {
    errors.push('Rendered context exceeds its exact token allowance.');
  }
  return errors;
};
