export const CREATE_SEMANTIC_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS semantic_lookup (
  partition_id TEXT NOT NULL, local_id INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(partition_id, local_id)
);
CREATE TABLE IF NOT EXISTS semantic_frontier (
  partition_id TEXT NOT NULL, task_id TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(partition_id, task_id)
);

CREATE TABLE IF NOT EXISTS semantic_sources (
  source_id TEXT PRIMARY KEY, byte_hash TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS semantic_sources_path ON semantic_sources(json_extract(payload,'$.path'),source_id);
CREATE TABLE IF NOT EXISTS semantic_analysis (
  partition_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, canonical_hash TEXT NOT NULL,
  descriptor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS semantic_analysis_source ON semantic_analysis(source_id);
CREATE TABLE IF NOT EXISTS semantic_records (
  partition_id TEXT NOT NULL, local_id INTEGER NOT NULL, record_kind TEXT NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY(partition_id, local_id)
);
CREATE INDEX IF NOT EXISTS semantic_records_kind ON semantic_records(record_kind, partition_id, local_id);
CREATE INDEX IF NOT EXISTS semantic_occurrence_expression ON semantic_records(
  partition_id, json_extract(payload,'$.data.expression.partitionId'),
  json_extract(payload,'$.data.expression.localId')
) WHERE record_kind='occurrence';
CREATE TABLE IF NOT EXISTS semantic_operands (
  partition_id TEXT NOT NULL, parent_partition TEXT NOT NULL, parent_id INTEGER NOT NULL,
  slot TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(partition_id, parent_partition, parent_id, slot, ordinal)
);
CREATE TABLE IF NOT EXISTS semantic_edges (
  partition_id TEXT NOT NULL, local_id INTEGER NOT NULL, edge_kind TEXT NOT NULL,
  from_partition TEXT NOT NULL, from_id INTEGER NOT NULL,
  to_partition TEXT NOT NULL, to_id INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(partition_id, local_id)
);
CREATE INDEX IF NOT EXISTS semantic_edges_forward
  ON semantic_edges(from_partition, from_id, edge_kind, to_partition, to_id);
CREATE INDEX IF NOT EXISTS semantic_edges_reverse
  ON semantic_edges(to_partition, to_id, edge_kind, from_partition, from_id);
CREATE TABLE IF NOT EXISTS semantic_ownership (
  partition_id TEXT NOT NULL, record_partition TEXT NOT NULL, local_id INTEGER NOT NULL,
  chunk_uid TEXT NOT NULL, role TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(partition_id, record_partition, local_id, chunk_uid, role)
);
CREATE INDEX IF NOT EXISTS semantic_ownership_chunk ON semantic_ownership(chunk_uid);
CREATE INDEX IF NOT EXISTS semantic_operation_ast ON semantic_records(json_extract(payload,'$.data.astKind'),partition_id,local_id) WHERE record_kind='expression';
CREATE INDEX IF NOT EXISTS semantic_operation_operator ON semantic_records(json_extract(payload,'$.data.operation'),partition_id,local_id) WHERE record_kind='expression';
CREATE INDEX IF NOT EXISTS semantic_operation_invocation ON semantic_records(json_extract(payload,'$.data.invocationKind'),partition_id,local_id) WHERE record_kind='expression';
CREATE TABLE IF NOT EXISTS semantic_coverage (
  partition_id TEXT NOT NULL, ordinal INTEGER NOT NULL, phase TEXT NOT NULL,
  state TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(partition_id, ordinal)
);
`;
