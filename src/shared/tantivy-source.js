import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from './contained-file.js';
import { assertPiecesManifestFormat } from './artifact-io/manifest-read.js';
import { MAX_JSON_BYTES } from './artifact-io/constants.js';
import { stableStringify } from './stable-json.js';
import { throwIfAborted } from './abort.js';

// The builder consumes the already-tokenized postings, not raw text. Changing
// either interpretation must invalidate receipts even if the source is unchanged.
export const TANTIVY_INPUT_CONTRACT = Object.freeze({ version: 1,
  documents: 'chunk-meta-array-ordinal-v1', analyzer: 'source-token-postings-v1',
  postings: 'sorted-doc-id-positive-tf-v1', adapter: 'synchronous-ranked-ordinal-close-v1' });
const invalid = message => Object.assign(new Error(message), { code: 'ERR_TANTIVY_SOURCE' });
const identityPath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const tick = async signal => { await new Promise(resolve => setImmediate(resolve)); throwIfAborted(signal); };

export const readTantivyManifest = async (indexDir, { repoRoot, signal = null } = {}) => {
  const { buffer } = await readVerifiedContainedFile(indexDir, path.join(indexDir, 'pieces', 'manifest.json'),
    { maxBytes: MAX_JSON_BYTES, signal });
  const raw = JSON.parse(buffer.toString('utf8'));
  const manifest = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  assertPiecesManifestFormat(indexDir, manifest, repoRoot);
  if (!Array.isArray(manifest?.pieces)) throw invalid('Tantivy requires a complete selected pieces manifest.');
  return { manifest, sha256: hash(buffer) };
};

/** Bind the native ordinal domain and actual materialized postings. No mtime,
 * aggregate count, selector path or hydrated display metadata grants identity. */
export const createTantivySource = async ({ repoRoot, indexDir, mode, manifestSha256,
  chunkMeta, tokenPostings, signal = null }) => {
  if (!path.isAbsolute(repoRoot || '') || !path.isAbsolute(indexDir || '')
    || !['code', 'prose', 'extracted-prose', 'records'].includes(mode)
    || !/^[a-f0-9]{64}$/.test(manifestSha256 || '') || !Array.isArray(chunkMeta)) throw invalid('Invalid Tantivy source selection.');
  const { vocab, postings, docLengths, totalDocs, avgDocLen } = tokenPostings || {};
  if (!Array.isArray(vocab) || !Array.isArray(postings) || vocab.length !== postings.length
    || !(Array.isArray(docLengths) || ArrayBuffer.isView(docLengths)) || docLengths.length !== chunkMeta.length
    || totalDocs !== chunkMeta.length || !Number.isFinite(avgDocLen) || avgDocLen < 0) throw invalid('Tantivy input cardinalities disagree.');
  const documents = createHash('sha256'), tokens = createHash('sha256');
  for (let id = 0; id < chunkMeta.length; id++) {
    if (id % 256 === 0) await tick(signal);
    const row = chunkMeta[id];
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(docLengths[id]) || docLengths[id] < 0) throw invalid('Tantivy input has an invalid document ordinal.');
    // File hydration may add `file` to a fileId-based row; prefer its stored ID.
    documents.update(stableStringify([id, row.chunkUid ?? null, row.chunkId ?? null, row.id ?? null,
      row.fileId ?? row.file ?? null, row.start ?? null, row.end ?? null]));
    documents.update('\n');
    tokens.update(`${docLengths[id]}\n`);
  }
  tokens.update(stableStringify([totalDocs, avgDocLen]));
  for (let term = 0; term < vocab.length; term++) {
    if (term % 256 === 0) await tick(signal);
    if (typeof vocab[term] !== 'string' || !Array.isArray(postings[term])) throw invalid('Tantivy input has an invalid token or posting list.');
    tokens.update(stableStringify(vocab[term])); tokens.update('\n');
    let previous = -1;
    for (let n = 0; n < postings[term].length; n++) {
      if (n > 0 && n % 4096 === 0) await tick(signal);
      const pair = postings[term][n], id = pair?.[0], tf = pair?.[1];
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(id) || id <= previous
        || id >= chunkMeta.length || !Number.isFinite(tf) || tf <= 0) throw invalid('Tantivy input has an invalid posting ordinal or frequency.');
      previous = id; tokens.update(stableStringify(pair)); tokens.update('\n');
    }
  }
  throwIfAborted(signal);
  return Object.freeze({ repoRoot: identityPath(repoRoot), indexDir: identityPath(indexDir), mode,
    manifestSha256, documentMappingSha256: documents.digest('hex'), postingsSha256: tokens.digest('hex'),
    chunkCount: chunkMeta.length, docCount: totalDocs, vocabCount: vocab.length,
    contract: TANTIVY_INPUT_CONTRACT });
};

export const tantivySourceKey = source => hash(stableStringify(source));
export const sameTantivySource = (left, right) => stableStringify(left) === stableStringify(right);
