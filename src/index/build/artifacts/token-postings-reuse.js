import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { readJsonFile } from '../../../shared/artifact-io/json.js';
import { resolveArtifactPath } from '../../../shared/artifact-io/contained-path.js';
import { sha256File } from '../../../shared/hash.js';
import { stableStringify } from '../../../shared/stable-json.js';
import { copyFileWithDurability } from '../../../shared/io/persistence-helpers.js';
import { captureSelectedModeRoots } from '../../../shared/indexing/selected-mode-roots.js';
import { assertArtifactPublicationReady, readArtifactPublicationRecord } from '../artifact-publication.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../semantic/analysis-versions.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { TOKEN_ID_META } from '../../../shared/token-id.js';
import { throwIfAborted } from '../../../shared/abort.js';
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const RECEIPT_PATH = 'pieces/token-postings.reuse.json';
const RECEIPT_NAME = 'token_postings_reuse_receipt';
const familyEntry = entry => entry?.name?.startsWith('token_postings') && entry.name !== RECEIPT_NAME;
const coreIdentity = piece => ({ path: piece.path, name: piece.name, format: piece.format,
  count: piece.count ?? null, compression: piece.compression ?? null });

/** Bind the loaded dictionary meaning, not path/size/mtime hints. Unknown
 * containers decline reuse; no separate global cache survives this build. */
export const tokenPostingsDictionaryProof = runtime => {
  const sets = [runtime.dictWords, runtime.codeDictCommonWords, runtime.codeDictWordsAll];
  if (!sets.every(value => value instanceof Set) || !(runtime.codeDictWordsByLanguage instanceof Map)) return null;
  const digest = createHash('sha256');
  const add = value => { const encoded = stableStringify(value); digest.update(String(Buffer.byteLength(encoded)) + ':'); digest.update(encoded); };
  add('loaded-scoring-dictionaries.v1');
  for (const words of sets) {
    if (![...words].every(value => typeof value === 'string')) return null;
    add([...words].sort());
  }
  for (const [language, words] of [...runtime.codeDictWordsByLanguage].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    if (typeof language !== 'string' || !(words instanceof Set) || ![...words].every(value => typeof value === 'string')) return null;
    add(language); add([...words].sort());
  }
  return digest.digest('hex');
};

/** Hash the complete current producer representation before artifact encoding.
 * This remains real O(postings) verification work; no zero-work/speed claim. */
export const tokenPostingsRepresentationProof = ({ state, postings, policy, format }) => {
  if (!policy || typeof policy.dictionarySignature !== 'string' || !policy.dictionarySignature
    || !policy.dictionary || typeof policy.dictionary !== 'object' || Array.isArray(policy.dictionary)
    || !policy.postings || typeof policy.postings !== 'object' || Array.isArray(policy.postings)
    || !Array.isArray(state?.chunks) || !Array.isArray(state.docLengths)
    || !Array.isArray(postings?.tokenVocab) || !Array.isArray(postings.tokenPostingsList)) return null;
  try {
    const digest = createHash('sha256');
    const scalar = value => {
      if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value) && value !== null) throw new Error('Unknown posting representation.');
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite posting representation.');
      const text = typeof value + ':' + String(value); digest.update(String(Buffer.byteLength(text)) + ':'); digest.update(text);
    };
    scalar(stableStringify({ schema: 'token-postings-family.v1', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      lexicalProducer: SEMANTIC_ANALYSIS_VERSIONS.lexicalAnalyzer, sourceProducer: SEMANTIC_ANALYSIS_VERSIONS.sourceChunking,
      policy, format, tokenId: TOKEN_ID_META, avgDocLen: postings.avgDocLen }));
    scalar(state.chunks.length);
    for (const chunk of state.chunks) {
      if (!chunk.chunkUid || !Number.isSafeInteger(chunk.id)) return null;
      for (const value of [chunk.id, chunk.chunkUid, chunk.file, chunk.start, chunk.end]) scalar(value);
    }
    scalar(state.docLengths.length); for (const length of state.docLengths) scalar(length);
    scalar(postings.tokenVocab.length); for (const token of postings.tokenVocab) scalar(token);
    const ids = Array.isArray(postings.tokenVocabIds) ? postings.tokenVocabIds : null;
    scalar(ids?.length ?? null); if (ids) for (const id of ids) scalar(id);
    scalar(postings.tokenPostingsList.length);
    for (const list of postings.tokenPostingsList) {
      if (!Array.isArray(list)) return null;
      scalar(list.length);
      for (const pair of list) { if (!Array.isArray(pair) || pair.length !== 2) return null; scalar(pair[0]); scalar(pair[1]); }
    }
    return digest.digest('hex');
  } catch { return null; }
};

/** Reuse is admitted only from the selected, published mode root retained by the
 * existing cache lease. Complete sidecar inventory and every byte are reverified. */
export const reuseTokenPostingsFamily = async ({ root, userConfig, outDir, mode, proof,
  enabled, addPieceFile, signal }) => {
  const miss = reason => ({ proof, reused: false, reason, payloadBytesRead: 0, payloadBytesCopied: 0, metadataReadsExcluded: true });
  if (!enabled || !proof) return miss('unknown-dependency-proof');
  const selected = captureSelectedModeRoots({ root, userConfig });
  const sourceRoot = selected.roots[mode];
  if (!sourceRoot) return miss('no-selected-mode');
  const sourceDir = path.join(sourceRoot, `index-${mode}`);
  let stagingStarted = false;
  try {
    await assertArtifactPublicationReady({ buildRoot: sourceRoot, modes: [mode] });
    const manifestPath = path.join(sourceDir, 'pieces', 'manifest.json');
    const manifestChecksum = await sha256File(manifestPath, { containedRoot: sourceDir, signal });
    const manifest = readJsonFile(manifestPath, { containedRoot: sourceDir, signal });
    if (!Array.isArray(manifest.pieces)) return miss('invalid-family-manifest');
    const receiptPiece = manifest.pieces.find(piece => piece.name === RECEIPT_NAME && piece.path === RECEIPT_PATH);
    if (!receiptPiece || !/^sha256:[a-f0-9]{64}$/.test(receiptPiece.checksum || '')) return miss('no-sealed-family-receipt');
    const receiptPath = resolveArtifactPath(sourceDir, RECEIPT_PATH);
    if (`sha256:${await sha256File(receiptPath, { containedRoot: sourceDir, signal })}` !== receiptPiece.checksum) return miss('receipt-integrity-mismatch');
    const receipt = readJsonFile(receiptPath, { maxBytes: MAX_RECEIPT_BYTES, containedRoot: sourceDir });
    const pieces = manifest.pieces.filter(familyEntry);
    if (receipt.schemaVersion !== 1 || receipt.proof !== proof || !Array.isArray(receipt.files)
      || !pieces.length || pieces.length !== receipt.files.length) return miss('family-proof-or-inventory-mismatch');
    const byPath = new Map(pieces.map(piece => [piece.path, piece]));
    if (byPath.size !== pieces.length || new Set(receipt.files.map(row => row.piece?.path)).size !== pieces.length) return miss('ambiguous-family-inventory');
    let bytesRead = 0, bytesCopied = 0;
    for (const file of receipt.files) {
      throwIfAborted(signal);
      const selectedPiece = byPath.get(file.piece?.path);
      if (!selectedPiece || stableStringify(coreIdentity(selectedPiece)) !== stableStringify(file.piece)
        || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0) return miss('family-member-identity-mismatch');
      const source = resolveArtifactPath(sourceDir, file.piece.path);
      if ((await fs.stat(source)).size !== file.bytes || await sha256File(source, { containedRoot: sourceDir, signal }) !== file.sha256) return miss('family-member-integrity-mismatch');
      bytesRead += file.bytes;
    }
    const sameGeneration = path.resolve(sourceDir) === path.resolve(outDir);
    const transfers = [];
    // Preflight every destination before copying any member. Exclusive creation
    // also refuses a collision introduced after this check.
    if (!sameGeneration) for (const file of receipt.files) {
      throwIfAborted(signal);
      const source = resolveArtifactPath(sourceDir, file.piece.path);
      const target = resolveArtifactPath(outDir, file.piece.path, { allowMissing: true });
      try { await fs.lstat(target); return miss('target-member-already-exists'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      transfers.push({ source, target, file });
    }
    for (const { source, target, file } of transfers) {
      throwIfAborted(signal);
      await fs.mkdir(path.dirname(target), { recursive: true });
      stagingStarted = true;
      await copyFileWithDurability(source, target, { exclusive: true });
      bytesRead += file.bytes * 2; bytesCopied += file.bytes;
      if (await sha256File(target, { containedRoot: outDir, signal }) !== file.sha256) {
        throw Object.assign(new Error('Copied token postings family changed.'), { code: 'ERR_TOKEN_POSTINGS_COPY' });
      }
    }
    if (await sha256File(manifestPath, { containedRoot: sourceDir, signal }) !== manifestChecksum) {
      throw Object.assign(new Error('Selected manifest changed during family admission.'), { code: 'ERR_TOKEN_POSTINGS_AUTHORITY_CHANGED' });
    }
    const publication = await readArtifactPublicationRecord(sourceRoot, mode);
    for (const file of receipt.files) {
      const { layout: _layout, ...piece } = byPath.get(file.piece.path);
      addPieceFile({ ...piece, checksum: `sha256:${file.sha256}`, bytes: file.bytes }, resolveArtifactPath(outDir, file.piece.path));
    }
    return { proof, reused: true, reason: 'verified-complete-family',
      payloadBytesRead: bytesRead, payloadBytesCopied: bytesCopied, metadataReadsExcluded: true,
      sameGeneration, receiptPiece,
      reusedFrom: { buildId: publication.buildId, mode, manifestChecksum } };
  } catch (error) {
    throwIfAborted(signal);
    if (stagingStarted) throw error;
    for (let cause = error; cause; cause = cause.cause) {
      if (['EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'EBUSY', 'ENOSPC', 'EEXIST'].includes(cause.code)) throw error;
    }
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return miss('missing-family-member');
    // Integrity and publication mismatch recompute; operational failures keep their authority.
    if (error instanceof SyntaxError || error.code === 'ERR_ARTIFACT_PATH'
      || String(error.message).startsWith('[artifact-publication]')) return miss('invalid-family-authority');
    throw error;
  }
};

export const sealTokenPostingsFamily = async ({ outDir, plan, entries, addPieceFile, signal }) => {
  if (!plan?.proof) return;
  const receiptPath = resolveArtifactPath(outDir, RECEIPT_PATH, { allowMissing: true });
  if (plan.reused && plan.sameGeneration) { addPieceFile(plan.receiptPiece, receiptPath); return; }
  const files = [];
  for (const piece of entries.filter(familyEntry)) {
    throwIfAborted(signal);
    const file = resolveArtifactPath(outDir, piece.path);
    files.push({ piece: coreIdentity(piece), bytes: (await fs.stat(file)).size,
      sha256: await sha256File(file, { containedRoot: outDir, signal }) });
  }
  if (!files.length) return;
  const receipt = { schemaVersion: 1, proof: plan.proof, files, reusedFrom: plan.reusedFrom || null };
  if (Buffer.byteLength(JSON.stringify(receipt)) > MAX_RECEIPT_BYTES) return;
  await atomicWriteJson(receiptPath, receipt, { spaces: 0, signal });
  addPieceFile({ type: 'postings', name: RECEIPT_NAME, format: 'json',
    bytes: (await fs.stat(receiptPath)).size, checksum: `sha256:${await sha256File(receiptPath, { containedRoot: outDir, signal })}` }, receiptPath);
};
