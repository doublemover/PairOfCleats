import { compileSchema, createAjv } from '../shared/validation/ajv-factory.js';
import { types } from 'node:util';
import { CONTEXT_RENDERED_TOKEN_BUDGET_SCHEMA, CONTEXT_RENDERING_VERSION, CONTEXT_TOKENIZER_ENGINE } from '../contracts/schemas/context-token-budget.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), CONTEXT_RENDERED_TOKEN_BUDGET_SCHEMA);
const invalid = () => Object.assign(new Error('Invalid rendered context token budget or pinned tokenizer profile.'), {
  code: 'ERR_CONTEXT_PACK_INVALID_REQUEST', status: 400
});
// Direct code callers receive the same JSON-only contract as transport callers.
const capture = (value, depth = 0) => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || depth > 2) throw invalid();
  const result = Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (keys.length > (depth === 0 ? 5 : 8)) throw invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result[key] = capture(descriptor.value, depth + 1);
  }
  return result;
};
export const resolveRenderedTokenBudget = input => {
  if (input === undefined) return undefined;
  const policy = capture(input);
  if (!validate(policy) || policy.reservedTokens > policy.maxTokens) throw invalid();
  return Object.freeze({ ...policy, rendering: CONTEXT_RENDERING_VERSION, reservedTokens: policy.reservedTokens ?? 0,
    profile: Object.freeze({ ...policy.profile, engine: CONTEXT_TOKENIZER_ENGINE, addSpecialTokens: policy.profile.addSpecialTokens !== false }) });
};
