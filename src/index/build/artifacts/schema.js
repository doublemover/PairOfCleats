export const ARTIFACT_SCHEMAS = {
  chunkMeta: {
    fields: ['id', 'fileId', 'start', 'end', 'startLine', 'endLine', 'kind', 'name'],
    optionalFields: [
      'weight', 'headline', 'preContext', 'postContext', 'segment', 'codeRelations', 'docmeta',
      'metaV2', 'stats', 'complexity', 'lint', 'chunk_authors', 'chunkAuthors', 'tokens', 'ngrams'
    ]
  },
  chunkMetaMeta: {
    fields: ['format', 'shardSize', 'totalChunks', 'parts']
  },
  tokenPostings: {
    fields: ['avgDocLen', 'totalDocs'],
    arrays: ['vocab', 'postings', 'docLengths']
  },
  tokenPostingsMeta: {
    fields: ['avgDocLen', 'totalDocs', 'format', 'shardSize', 'vocabCount', 'parts'],
    arrays: ['docLengths']
  },
  fileMeta: {
    fields: ['id', 'file', 'ext', 'size', 'hash', 'hashAlgo']
  },
  piecesManifest: {
    fields: ['version', 'generatedAt', 'mode', 'stage', 'pieces']
  }
};
