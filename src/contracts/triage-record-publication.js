export const TRIAGE_PUBLICATION_FIELD = '_pairofcleatsRecordPublication';
export const TRIAGE_GENERATION_DIRECTORY = '.record-artifacts';
export const TRIAGE_RENDERER_VERSION = 3;
export const TRIAGE_SUPPORTED_RENDERER_VERSIONS = Object.freeze([1, 2, 3]);
export const TRIAGE_PUBLICATION_LIMITS = Object.freeze({ jsonBytes: 16 * 1024 * 1024, markdownBytes: 32 * 1024 * 1024 });
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };

/** One canonical selector binds exact immutable record/Markdown wire bytes.
 * Paths are derived from the selected root/ID and generation, never this DTO.
 */
export const TRIAGE_RECORD_PUBLICATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'generation', 'recordId', 'recordHash', 'markdownHash', 'markdownBytes', 'rendererVersion'],
  properties: {
    schemaVersion: { const: 1 }, generation: { type: 'string', pattern: '^[a-f0-9]{32}$' },
    recordId: { type: 'string', minLength: 1, maxLength: 4096 }, recordHash: digest, markdownHash: digest,
    markdownBytes: { type: 'integer', minimum: 1, maximum: TRIAGE_PUBLICATION_LIMITS.markdownBytes },
    rendererVersion: { enum: [...TRIAGE_SUPPORTED_RENDERER_VERSIONS] }
  }
};
