import fsSync from 'node:fs';
import path from 'node:path';

const INDEX_FILES = [
  'chunk_meta.json',
  'token_postings.json',
  'phrase_ngrams.json',
  'chargram_postings.json',
  'dense_vectors_uint8.json',
  'dense_vectors_doc_uint8.json',
  'dense_vectors_code_uint8.json',
  'minhash_signatures.json',
  'file_relations.json',
  'file_meta.json'
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

export function buildIndexSignature(dir) {
  if (!dir) return null;
  const parts = INDEX_FILES.map((name) => {
    const target = path.join(dir, name);
    const sig = fileSignature(target);
    return `${name}:${sig || 'missing'}`;
  });
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
