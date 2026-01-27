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
    optionalArtifacts.push('dense_vectors.lancedb.meta.json');
    optionalArtifacts.push('dense_vectors_doc.lancedb.meta.json');
    optionalArtifacts.push('dense_vectors_code.lancedb.meta.json');
  }
  return {
    requiredArtifacts,
    strictOnlyRequiredArtifacts,
    optionalArtifacts,
    lanceConfig
  };
};
