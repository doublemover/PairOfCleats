import { SEMANTIC_TASK_SCHEMA } from '../semantic-task.js';
import { SEMANTIC_QUERY_INDEX_SCHEMA } from '../semantic-query-index.js';
import { semanticObject as object, SEMANTIC_MEMBER_NAMES, SEMANTIC_PARTITION_SCHEMA,
  SEMANTIC_GENERATION_SCHEMA, SEMANTIC_SOURCE_SCHEMA, SEMANTIC_PIECE_SCHEMA, SEMANTIC_PROVIDER_SCHEMA, semanticHashSchema, semanticInteger } from '../semantic-envelopes.js';
import { SEMANTIC_NODE_SCHEMA, SEMANTIC_OPERAND_SCHEMA, SEMANTIC_EDGE_SCHEMA,
  SEMANTIC_COVERAGE_SCHEMA, SEMANTIC_OWNERSHIP_SCHEMA, SEMANTIC_LOOKUP_SCHEMA } from '../semantic.js';
const array = (items) => ({ type: 'array', items });
const index = object({ schemaVersion: { const: 1 }, generation: SEMANTIC_GENERATION_SCHEMA,
  partitions: array(object({ partitionId: { type: 'string' }, pieces: array(SEMANTIC_PIECE_SCHEMA) })) });
const rows = { semantic_sources: SEMANTIC_SOURCE_SCHEMA, semantic_records: SEMANTIC_NODE_SCHEMA,
  semantic_operands: SEMANTIC_OPERAND_SCHEMA, semantic_edges: SEMANTIC_EDGE_SCHEMA,
  semantic_coverage: SEMANTIC_COVERAGE_SCHEMA, semantic_ownership: SEMANTIC_OWNERSHIP_SCHEMA,
  semantic_frontier: SEMANTIC_TASK_SCHEMA, semantic_lookup: SEMANTIC_LOOKUP_SCHEMA };
export const SEMANTIC_FAMILY_SCHEMA = object({ schemaVersion: { const: 1 }, semanticSchemaVersion: { const: 1 },
  artifactSurfaceVersion: { const: '0.1.0' }, generation: SEMANTIC_GENERATION_SCHEMA,
  status: { enum: ['partial', 'disabled'] }, partitions: array(SEMANTIC_PARTITION_SCHEMA), warnings: array({ type: 'string' }) }, { contexts: SEMANTIC_PROVIDER_SCHEMA.properties.contexts,
  evidenceArtifacts: array(object({ path: { type: 'string', pattern: '^semantic-evidence/[a-f0-9]{64}\\.json$' }, hash: semanticHashSchema, bytes: semanticInteger })),
  frontierTargets: array(object({ path: { type: 'string', pattern: '^semantic-frontier-targets/[a-f0-9]{64}\\.json$' },
    hash: semanticHashSchema, bytes: semanticInteger })),
  completedTasks: array(object({ taskId: SEMANTIC_TASK_SCHEMA.properties.taskId,
    baseBuildId: SEMANTIC_TASK_SCHEMA.properties.baseBuildId, inputHash: semanticHashSchema, policyHash: semanticHashSchema })) });
export const SEMANTIC_ARTIFACT_SCHEMA_DEFS = { semantic_manifest: SEMANTIC_FAMILY_SCHEMA, semantic_query_index: SEMANTIC_QUERY_INDEX_SCHEMA,
  ...Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, rows[name]
    ? { anyOf: [index, array(rows[name])] } : index])) };
