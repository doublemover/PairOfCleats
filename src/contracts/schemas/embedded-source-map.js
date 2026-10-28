import { SEMANTIC_SOURCE_SCHEMA, semanticObject as object,
  semanticInteger as integer, semanticHashSchema as hash } from './semantic-envelopes.js';
import { EMBEDDED_CONTENT_VIEW_SCHEMA } from './embedded-content.js';

/** Exact version-one framing emitted by the existing embedded-source owner. */
const linear = object({
  schemaVersion: { const: 1 }, kind: { const: 'embedded-linear-range' },
  quality: { enum: ['exact', 'coarse', 'synthetic'] },
  parentSourceUnitId: SEMANTIC_SOURCE_SCHEMA.properties.sourceUnitId, parentByteHash: hash,
  parentStart: integer, parentEnd: integer, localStart: { const: 0 }, localEnd: integer,
  coordinateUnit: { const: 'utf16' }, segmentUid: { type: 'string', minLength: 1, maxLength: 4096 },
  language: { type: 'string', minLength: 1, maxLength: 256 }
});

const piecewise = object({ ...linear.properties,
  schemaVersion: { const: 2 }, kind: { const: 'embedded-piecewise-range' }, quality: { const: 'exact' },
  contentView: EMBEDDED_CONTENT_VIEW_SCHEMA
});
export const EMBEDDED_SOURCE_MAP_SCHEMA = { anyOf: [linear, piecewise] };
