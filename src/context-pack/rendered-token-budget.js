import { renderCompositeContextPack, renderCompositeContextPackJson } from '../retrieval/output/composite-context-pack.js';
import { countRenderedContextTokens } from './token-counter.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from './response-budget.js';
import { contextDigest, contextPayloadDigest, contextProfileDigest, contextTokenProjectionErrors } from '../contracts/context-token-budget.js';
import { CONTEXT_RENDERING_VERSION } from '../contracts/schemas/context-token-budget.js';
import { throwIfAborted } from '../shared/abort.js';

/** Count the one supported, versioned text envelope after optional sections
 * have been admitted. Never trim or rewrite selected intact edit units to fit. */
export const applyRenderedTokenBudget = async (payload, policy, { repoRoot, taskPolicy, signal, timeoutMs } = {}) => {
  if (!policy) return { payload, publish: () => {} };
  throwIfAborted(signal);
  const renderedContext = renderCompositeContextPack(payload) + '\n';
  if (Buffer.byteLength(renderedContext) > CONTEXT_PACK_RESPONSE_MAX_BYTES) {
    throw Object.assign(new Error('Rendered context alone exceeds the complete response byte budget.'), {
      code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET', status: 413
    });
  }
  const counted = await countRenderedContextTokens({ text: renderedContext, policy, repoRoot, taskPolicy, signal, timeoutMs });
  throwIfAborted(signal);
  return finalizeRenderedTokenBudget(payload, policy, counted, renderedContext);
};

/** A selector may update JSON-only diagnostics after a bounded exact trial.
 * Reuse requires byte-for-byte identical rendered text, not an estimated sum. */
export const finalizeRenderedTokenBudget = (payload, policy, counted, renderedContext) => {
  if (renderedContext !== renderCompositeContextPack(payload) + '\n') {
    throw Object.assign(new Error('Rendered context changed after exact counting.'), { code: 'ERR_CONTEXT_PACK_SCHEMA', status: 500 });
  }
  const admittedTokens = counted.tokens + policy.reservedTokens;
  if (!Number.isSafeInteger(admittedTokens) || admittedTokens > policy.maxTokens) {
    throw Object.assign(new Error('Selected context and reserved overhead exceed the exact rendered token budget.'), {
      code: 'ERR_CONTEXT_PACK_TOKEN_BUDGET', status: 413
    });
  }
  const profile = policy.profile;
  const result = { ...payload, renderedContext, tokenAccounting: {
    schemaVersion: 1, status: 'exact', rendering: CONTEXT_RENDERING_VERSION, engine: profile.engine,
    profileDigest: contextProfileDigest(profile), profileId: profile.id, revision: profile.revision,
    tokenizerSha256: profile.tokenizerSha256, configSha256: profile.configSha256, addSpecialTokens: profile.addSpecialTokens,
    renderedSha256: contextDigest(renderedContext), payloadSha256: contextPayloadDigest(payload),
    renderedBytes: Buffer.byteLength(renderedContext), renderedTokens: counted.tokens,
    reservedTokens: policy.reservedTokens, admittedTokens, maxTokens: policy.maxTokens
  } };
  if (Buffer.byteLength(JSON.stringify(result, null, 2)) > CONTEXT_PACK_RESPONSE_MAX_BYTES) {
    throw Object.assign(new Error('Counted context and its receipt exceed the complete response byte budget.'), {
      code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET', status: 413
    });
  }
  const errors = contextTokenProjectionErrors(result);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'ERR_CONTEXT_PACK_SCHEMA', status: 500 });
  // Check the decorated CLI representation before admitting a reusable count.
  // Later renderers may not prune the payload covered by this receipt.
  renderCompositeContextPackJson(result);
  return { payload: result, publish: counted.publish };
};
