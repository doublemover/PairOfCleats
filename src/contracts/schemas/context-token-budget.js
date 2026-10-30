const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const tokenCount = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const CONTEXT_RENDERING_VERSION = 'context-text-v1';
export const CONTEXT_TOKENIZER_ENGINE = 'huggingface-tokenizers-0.2.0-v1';
export const CONTEXT_RENDERED_TOKEN_BUDGET_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'maxTokens', 'profile'],
  properties: { schemaVersion: { const: 1 }, maxTokens: tokenCount, reservedTokens: tokenCount,
    rendering: { const: CONTEXT_RENDERING_VERSION },
    profile: { type: 'object', additionalProperties: false,
      required: ['id', 'revision', 'directory', 'tokenizerSha256', 'configSha256'], properties: {
        id: { type: 'string', minLength: 1, maxLength: 256 },
        revision: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' },
        directory: { type: 'string', minLength: 1, maxLength: 4096 },
        tokenizerSha256: digest, configSha256: digest, addSpecialTokens: { type: 'boolean' },
        engine: { const: CONTEXT_TOKENIZER_ENGINE }
      } }
  }
};
export const CONTEXT_TOKEN_ACCOUNTING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'status', 'rendering', 'engine', 'profileDigest', 'profileId', 'revision',
    'tokenizerSha256', 'configSha256', 'addSpecialTokens', 'renderedSha256', 'payloadSha256', 'renderedBytes',
    'renderedTokens', 'reservedTokens', 'admittedTokens', 'maxTokens'],
  properties: { schemaVersion: { const: 1 }, status: { const: 'exact' }, rendering: { const: CONTEXT_RENDERING_VERSION },
    engine: { const: CONTEXT_TOKENIZER_ENGINE }, profileDigest: digest, profileId: { type: 'string', minLength: 1, maxLength: 256 },
    revision: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, tokenizerSha256: digest, configSha256: digest,
    addSpecialTokens: { type: 'boolean' }, renderedSha256: digest, payloadSha256: digest,
    renderedBytes: { type: 'integer', minimum: 0, maximum: 131072 }, renderedTokens: tokenCount,
    reservedTokens: tokenCount, admittedTokens: tokenCount, maxTokens: tokenCount }
};
