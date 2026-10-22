import { ARTIFACT_SURFACE_VERSION } from '../versioning.js';
import { SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS } from './artifacts/symbols-call-sites.js';
import { GRAPH_RELATION_EDGES_SCHEMA } from './graph-relation-edges.js';

export const GRAPH_EVIDENCE_VERSION = 1;
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const cursor = { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+$' }] };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const filter = (properties, directionKey) => ({ ...object({ ...properties, direction: { enum: ['out', 'in', 'both'] } }, []),
  allOf: [{ if: { required: ['direction'], properties: { direction: { enum: ['out', 'in'] } } },
    then: { required: [directionKey] } }] });
const limits = object({ rows: { type: 'integer', minimum: 1, maximum: 512 },
  scanRows: { type: 'integer', minimum: 1, maximum: 4096 },
  bytes: { type: 'integer', minimum: 8192, maximum: 4194304 } }, []);
const requests = (family, filters) => object({ schemaVersion: { const: GRAPH_EVIDENCE_VERSION },
  repoRoot: text, buildId: { ...text, maxLength: 256, pattern: '^(?!\\.\\.?$)[^/\\\\:\\u0000]+$' },
  family: { const: family }, filter: filters, cursor, limits }, ['schemaVersion', 'repoRoot', 'buildId', 'family']);
export const GRAPH_EVIDENCE_REQUEST_SCHEMA = { oneOf: [
  requests('call_sites', filter({ file: text, callerChunkUid: text, targetChunkUid: text, chunkUid: text,
    resolution: { enum: ['resolved', 'ambiguous', 'unresolved'] } }, 'chunkUid')),
  requests('graph_relation_edges', filter({ graph: { enum: ['callGraph', 'usageGraph', 'importGraph'] },
    from: text, to: text, node: text }, 'node'))
] };
const result = (family, rowSchema, ordering) => object({ schemaVersion: { const: GRAPH_EVIDENCE_VERSION }, family: { const: family },
  generation: object({ buildId: text, artifactSurfaceVersion: { const: ARTIFACT_SURFACE_VERSION } }),
  rows: { type: 'array', maxItems: 512, items: rowSchema }, scanned: { ...integer, maximum: 4096 },
  bytes: { ...integer, maximum: 4194304 }, done: { type: 'boolean' }, cursor,
  scope: { type: 'string', pattern: '^[a-f0-9]{64}$' }, ordering: { const: ordering },
  coverage: object({ scope: { const: 'retained-family' }, complete: { type: 'boolean' }, upstream: { const: 'not-asserted' } }) });
export const GRAPH_EVIDENCE_RESULT_SCHEMA = { oneOf: [
  result('call_sites', SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS.call_sites.items, 'canonical-call-sites-physical-v1'),
  result('graph_relation_edges', GRAPH_RELATION_EDGES_SCHEMA.items, 'graph-from-to-v1')
] };
