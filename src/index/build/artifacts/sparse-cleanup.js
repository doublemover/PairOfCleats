import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runWithConcurrency } from '../../../shared/concurrency.js';

export const VECTOR_ONLY_SPARSE_PIECE_DENYLIST = new Set([
  'token_postings',
  'token_postings_offsets',
  'token_postings_meta',
  'token_postings_binary_columnar',
  'token_postings_binary_columnar_offsets',
  'token_postings_binary_columnar_lengths',
  'token_postings_binary_columnar_meta',
  'phrase_ngrams',
  'chargram_postings',
  'field_postings',
  'field_tokens',
  'vocab_order',
  'minhash_signatures',
  'minhash_signatures_packed',
  'minhash_signatures_packed_meta'
]);

export const VECTOR_ONLY_SPARSE_CLEANUP_ALLOWLIST = new Set([
  'token_postings.json',
  'token_postings.json.gz',
  'token_postings.json.zst',
  'token_postings.meta.json',
  'token_postings.shards',
  'token_postings.parts',
  'token_postings.packed.bin',
  'token_postings.packed.offsets.bin',
  'token_postings.packed.meta.json',
  'token_postings.binary-columnar.bin',
  'token_postings.binary-columnar.offsets.bin',
  'token_postings.binary-columnar.lengths.varint',
  'token_postings.binary-columnar.meta.json',
  'phrase_ngrams.json',
  'phrase_ngrams.json.gz',
  'phrase_ngrams.json.zst',
  'phrase_ngrams.meta.json',
  'phrase_ngrams.parts',
  'chargram_postings.json',
  'chargram_postings.json.gz',
  'chargram_postings.json.zst',
  'chargram_postings.meta.json',
  'chargram_postings.parts',
  'field_postings.json',
  'field_postings.json.gz',
  'field_postings.json.zst',
  'field_postings.meta.json',
  'field_postings.parts',
  'field_tokens.json',
  'field_tokens.json.gz',
  'field_tokens.json.zst',
  'field_tokens.meta.json',
  'field_tokens.parts',
  'vocab_order.json',
  'vocab_order.json.gz',
  'vocab_order.json.zst',
  'minhash_signatures.json',
  'minhash_signatures.json.gz',
  'minhash_signatures.json.zst',
  'minhash_signatures.meta.json',
  'minhash_signatures.parts',
  'minhash_signatures.packed.bin',
  'minhash_signatures.packed.meta.json'
]);

const VECTOR_ONLY_SPARSE_RECURSIVE_ALLOWLIST = new Set([
  'token_postings.shards',
  'token_postings.parts',
  'phrase_ngrams.parts',
  'chargram_postings.parts',
  'field_postings.parts',
  'field_tokens.parts',
  'minhash_signatures.parts'
]);

export const cleanupVectorOnlySparseArtifacts = async ({
  outDir,
  removeArtifact,
  concurrency = 8
}) => {
  const names = Array.from(VECTOR_ONLY_SPARSE_CLEANUP_ALLOWLIST).sort((a, b) => a.localeCompare(b));
  const root = path.resolve(outDir);
  await runWithConcurrency(
    names,
    Math.max(1, Math.min(concurrency, names.length || 1)),
    async (artifactName) => {
      const targetPath = path.join(outDir, artifactName);
      const resolvedTarget = path.resolve(targetPath);
      if (path.dirname(resolvedTarget) !== root) return;
      let recursive = false;
      try {
        const stat = await fs.stat(targetPath);
        recursive = stat.isDirectory();
      } catch {
        return;
      }
      if (recursive && !VECTOR_ONLY_SPARSE_RECURSIVE_ALLOWLIST.has(artifactName)) return;
      await removeArtifact(targetPath, { recursive, policy: 'vector_only_allowlist' });
    },
    { collectResults: false }
  );
};

export const removeCompressedArtifact = async ({ outDir, base, removeArtifact }) => {
  await Promise.all([
    removeArtifact(path.join(outDir, `${base}.json.gz`), { policy: 'format_cleanup' }),
    removeArtifact(path.join(outDir, `${base}.json.zst`), { policy: 'format_cleanup' })
  ]);
};

export const removePackedPostings = async ({ outDir, removeArtifact }) => {
  await Promise.all([
    removeArtifact(path.join(outDir, 'token_postings.packed.bin'), { policy: 'format_cleanup' }),
    removeArtifact(path.join(outDir, 'token_postings.packed.offsets.bin'), { policy: 'format_cleanup' }),
    removeArtifact(path.join(outDir, 'token_postings.packed.meta.json'), { policy: 'format_cleanup' })
  ]);
};

export const removePackedMinhash = async ({ outDir, removeArtifact }) => {
  await Promise.all([
    removeArtifact(path.join(outDir, 'minhash_signatures.packed.bin'), { policy: 'format_cleanup' }),
    removeArtifact(path.join(outDir, 'minhash_signatures.packed.meta.json'), { policy: 'format_cleanup' })
  ]);
};

export const getLingeringSparseArtifacts = (outDir) => {
  const lingering = [];
  for (const artifactName of VECTOR_ONLY_SPARSE_CLEANUP_ALLOWLIST) {
    if (!fsSync.existsSync(path.join(outDir, artifactName))) continue;
    lingering.push(artifactName);
  }
  return lingering;
};
