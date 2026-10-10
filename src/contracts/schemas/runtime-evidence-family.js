import { semanticObject as object, semanticInteger as integer, semanticText as text,
  semanticHashSchema as hash } from './semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../versioning.js';
const path = { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[^:]+$' };
const member = object({ path, hash, byteLength: integer });
const coverage = object({ artifactId: text, status: { enum: ['complete', 'partial', 'unsupported', 'malformed'] },
  observedRecords: integer, droppedRecords: integer, reasons: { type: 'array', uniqueItems: true, items: text } });
export const RUNTIME_FAMILY_MANIFEST_SCHEMA = object({
  schemaVersion: { const: 1 }, artifactSurfaceVersion: { const: ARTIFACT_SURFACE_VERSION }, generationId: hash,
  capture: member, evidence: object({ path, hash, byteLength: integer, count: integer, offsetsPath: path, offsetsHash: hash }),
  raw: { type: 'array', items: object({ artifactId: text, captureId: text, path, hash, byteLength: integer,
    format: text, formatVersion: text, pinned: { type: 'boolean' } }) },
  queryIndex: object({ path, hash, byteLength: integer, formatVersion: { const: '1' } }),
  coverage: { type: 'array', items: coverage }
});
export const RUNTIME_FAMILY_POINTER_SCHEMA = object({ schemaVersion: { const: 1 },
  artifactSurfaceVersion: { const: ARTIFACT_SURFACE_VERSION }, generationId: hash, manifest: member });
