import { normalizeLanceDbConfig } from '../../shared/lancedb.js';
import {
  INDEX_PROFILE_VECTOR_ONLY,
  normalizeIndexProfileId
} from '../../contracts/index-profile.js';

export const buildArtifactLists = (userConfig, postingsConfig, { profileId = null } = {}) => {
  const resolvedProfileId = normalizeIndexProfileId(profileId || userConfig?.indexing?.profile);
  const sparseEnabled = resolvedProfileId !== INDEX_PROFILE_VECTOR_ONLY;
  const requiredArtifacts = sparseEnabled
    ? ['chunk_meta', 'token_postings']
    : ['chunk_meta', 'dense_vectors'];
  const strictOnlyRequiredArtifacts = ['index_state', 'filelists'];
  const determinismReportEnabled = userConfig?.indexing?.artifacts?.determinismReport === true;
  if (determinismReportEnabled) {
    strictOnlyRequiredArtifacts.push('determinism_report');
  }
  if (sparseEnabled && postingsConfig.enablePhraseNgrams) requiredArtifacts.push('phrase_ngrams');
  if (sparseEnabled && postingsConfig.enableChargrams) requiredArtifacts.push('chargram_postings');
  const optionalArtifacts = [
    'minhash_signatures',
    'file_relations',
    'call_sites',
    'symbols',
    'symbol_occurrences',
    'symbol_edges',
    'graph_relations',
    'risk_summaries',
    'risk_flows',
    'risk_interprocedural_stats',
    'file_meta',
    'chunk_uid_map',
    'vfs_manifest',
    'repo_map',
    'filter_index',
    'field_postings',
    'field_tokens',
    'vocab_order'
  ];
  if (userConfig.search?.annDefault !== false || !sparseEnabled) {
    optionalArtifacts.push('dense_vectors');
    optionalArtifacts.push('dense_vectors_doc');
    optionalArtifacts.push('dense_vectors_code');
  }
  const lanceConfig = normalizeLanceDbConfig(userConfig.indexing?.embeddings?.lancedb || {});
  if (lanceConfig.enabled) {
    optionalArtifacts.push('dense_vectors_lancedb_meta');
    optionalArtifacts.push('dense_vectors_doc_lancedb_meta');
    optionalArtifacts.push('dense_vectors_code_lancedb_meta');
  }
  return {
    requiredArtifacts,
    strictOnlyRequiredArtifacts,
    optionalArtifacts,
    lanceConfig
  };
};
