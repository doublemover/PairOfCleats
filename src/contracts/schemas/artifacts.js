import {
  CORE_POST_DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS,
  CORE_POST_RISK_ARTIFACT_SCHEMA_DEFS,
  CORE_POST_SNAPSHOT_ARTIFACT_SCHEMA_DEFS,
  CORE_POST_SYMBOL_ARTIFACT_SCHEMA_DEFS,
  CORE_POST_VFS_ARTIFACT_SCHEMA_DEFS,
  CORE_PRE_VFS_ARTIFACT_SCHEMA_DEFS
} from './artifacts/core.js';
import { DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS } from './artifacts/dense-vectors.js';
import { REPORT_ARTIFACT_SCHEMA_DEFS } from './artifacts/reports.js';
import { RISK_ARTIFACT_SCHEMA_DEFS } from './artifacts/risk.js';
import { SHARDED_META_ARTIFACT_SCHEMA_DEFS } from './artifacts/sharded-meta.js';
import { SNAPSHOT_DIFF_ARTIFACT_SCHEMA_DEFS } from './artifacts/snapshots-diffs.js';
import { STATE_ARTIFACT_SCHEMA_DEFS } from './artifacts/state.js';
import { SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS } from './artifacts/symbols-call-sites.js';
import { VFS_ARTIFACT_SCHEMA_DEFS } from './artifacts/vfs.js';

export const MANIFEST_ONLY_ARTIFACT_NAMES = [
  'dense_vectors_hnsw',
  'dense_vectors_doc_hnsw',
  'dense_vectors_code_hnsw',
  'dense_vectors_binary',
  'dense_vectors_doc_binary',
  'dense_vectors_code_binary',
  'dense_vectors_lancedb',
  'dense_vectors_doc_lancedb',
  'dense_vectors_code_lancedb',
  'chunk_meta_binary_columnar',
  'chunk_meta_binary_columnar_offsets',
  'chunk_meta_binary_columnar_lengths',
  'chunk_meta_binary_columnar_meta',
  'call_sites_offsets',
  'chunk_meta_offsets',
  'chunk_meta_cold_offsets',
  'graph_relations_offsets',
  'token_postings_binary_columnar',
  'token_postings_binary_columnar_offsets',
  'token_postings_binary_columnar_lengths',
  'token_postings_binary_columnar_meta',
  'token_postings_offsets',
  'symbol_edges_offsets',
  'symbol_occurrences_offsets',
  'symbols_offsets',
  'symbol_occurrences_by_file',
  'symbol_occurrences_by_file_offsets',
  'symbol_occurrences_by_file_meta',
  'symbol_edges_by_file',
  'symbol_edges_by_file_offsets',
  'symbol_edges_by_file_meta',
  'minhash_signatures_packed',
  'minhash_signatures_packed_meta'
];

export const ARTIFACT_SCHEMA_DEFS = {
  ...CORE_PRE_VFS_ARTIFACT_SCHEMA_DEFS,
  ...VFS_ARTIFACT_SCHEMA_DEFS,
  ...CORE_POST_VFS_ARTIFACT_SCHEMA_DEFS,
  ...SYMBOL_CALL_SITE_ARTIFACT_SCHEMA_DEFS,
  ...CORE_POST_SYMBOL_ARTIFACT_SCHEMA_DEFS,
  ...RISK_ARTIFACT_SCHEMA_DEFS,
  ...CORE_POST_RISK_ARTIFACT_SCHEMA_DEFS,
  ...DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS,
  ...CORE_POST_DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS,
  ...REPORT_ARTIFACT_SCHEMA_DEFS,
  ...STATE_ARTIFACT_SCHEMA_DEFS,
  ...SNAPSHOT_DIFF_ARTIFACT_SCHEMA_DEFS,
  ...CORE_POST_SNAPSHOT_ARTIFACT_SCHEMA_DEFS,
  ...SHARDED_META_ARTIFACT_SCHEMA_DEFS
};
