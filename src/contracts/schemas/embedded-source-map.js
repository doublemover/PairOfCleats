import { SEMANTIC_SOURCE_SCHEMA, semanticObject as object,
  semanticInteger as integer, semanticHashSchema as hash } from './semantic-envelopes.js';

/** Exact version-one framing emitted by the existing embedded-source owner. */
export const EMBEDDED_SOURCE_MAP_SCHEMA = object({
  schemaVersion: { const: 1 }, kind: { const: 'embedded-linear-range' },
  quality: { enum: ['exact', 'coarse', 'synthetic'] },
  parentSourceUnitId: SEMANTIC_SOURCE_SCHEMA.properties.sourceUnitId, parentByteHash: hash,
  parentStart: integer, parentEnd: integer, localStart: { const: 0 }, localEnd: integer,
  coordinateUnit: { const: 'utf16' }, segmentUid: { type: 'string', minLength: 1, maxLength: 4096 },
  language: { type: 'string', minLength: 1, maxLength: 256 }
});
