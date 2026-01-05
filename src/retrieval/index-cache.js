import fsSync from 'node:fs';
import path from 'node:path';

const INDEX_FILES = [
  'phrase_ngrams.json',
  'chargram_postings.json',
  'dense_vectors_uint8.json',
  'dense_vectors_doc_uint8.json',
  'dense_vectors_code_uint8.json',
  'field_postings.json',
  'field_tokens.json',
  'minhash_signatures.json',
  'file_relations.json',
  'file_meta.json',
  'filter_index.json'
];

const fileSignature = (filePath) => {
  try {
    let statPath = filePath;
    if (!fsSync.existsSync(statPath) && filePath.endsWith('.json')) {
      const gzPath = `${filePath}.gz`;
      if (fsSync.existsSync(gzPath)) statPath = gzPath;
    }
    const stat = fsSync.statSync(statPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const shardSignature = (dir, prefix) => {
  try {
    if (!fsSync.existsSync(dir)) return null;
    const entries = fsSync
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort();
    if (!entries.length) return null;
    return entries
      .map((name) => fileSignature(path.join(dir, name)) || 'missing')
      .join(',');
  } catch {
    return null;
  }
};

const chunkMetaSignature = (dir) => {
  const jsonPath = path.join(dir, 'chunk_meta.json');
  const jsonSig = fileSignature(jsonPath);
  if (jsonSig) return `chunk_meta.json:${jsonSig}`;
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const jsonlSig = fileSignature(jsonlPath);
  if (jsonlSig) return `chunk_meta.jsonl:${jsonlSig}`;
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const metaSig = fileSignature(metaPath);
  const partsSig = shardSignature(path.join(dir, 'chunk_meta.parts'), 'chunk_meta.part-');
  if (metaSig || partsSig) {
    return `chunk_meta.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return 'chunk_meta.json:missing';
};

const tokenPostingsSignature = (dir) => {
  const jsonPath = path.join(dir, 'token_postings.json');
  const jsonSig = fileSignature(jsonPath);
  if (jsonSig) return `token_postings.json:${jsonSig}`;
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const metaSig = fileSignature(metaPath);
  const partsSig = shardSignature(path.join(dir, 'token_postings.shards'), 'token_postings.part-');
  if (metaSig || partsSig) {
    return `token_postings.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return 'token_postings.json:missing';
};

export function buildIndexSignature(dir) {
  if (!dir) return null;
  const parts = [
    chunkMetaSignature(dir),
    tokenPostingsSignature(dir),
    ...INDEX_FILES.map((name) => {
      const target = path.join(dir, name);
      const sig = fileSignature(target);
      return `${name}:${sig || 'missing'}`;
    })
  ];
  return parts.join('|');
}

export function loadIndexWithCache(cache, dir, options, loader) {
  if (!cache) return loader(dir, options);
  const cacheKey = `${dir}::${options?.modelIdDefault || ''}::${options?.fileChargramN || ''}`;
  const signature = buildIndexSignature(dir);
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.value;
  }
  const value = loader(dir, options);
  cache.set(cacheKey, { signature, value });
  return value;
}
