import { normalizeLanceDbConfig } from '../../shared/lancedb.js';

export const buildArtifactLists = (userConfig, postingsConfig) => {
  const requiredArtifacts = ['chunk_meta', 'token_postings'];
  const strictOnlyRequiredArtifacts = ['index_state', 'filelists'];
  if (postingsConfig.enablePhraseNgrams) requiredArtifacts.push('phrase_ngrams');
  if (postingsConfig.enableChargrams) requiredArtifacts.push('chargram_postings');
  const optionalArtifacts = [
    'minhash_signatures',
    'file_relations',
    'call_sites',
    'symbols',
    'symbol_occurrences',
    'symbol_edges',
    'graph_relations',
    'file_meta',
    'chunk_uid_map',
    'vfs_manifest',
    'repo_map',
    'filter_index',
    'field_postings',
    'field_tokens'
  ];
  if (userConfig.search?.annDefault !== false) {
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
