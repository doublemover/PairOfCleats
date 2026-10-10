import fs from 'node:fs/promises';
import path from 'node:path';
import { assertRuntimeFamily } from '../../../contracts/validators/runtime-evidence-family.js';
import { assertRuntimeEvidence, assertRuntimeProjection } from '../../../contracts/validators/runtime-evidence.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { semanticHash } from '../identity.js';
import { hashRuntimeFile, runtimeByteHash, runtimeImportError } from './raw-store.js';
import { openRuntimeQueryIndex, assertRuntimeIndexedRow } from './query-index.js';
import { runtimeEventLimit } from './adapters/shared.js';

const MAX_METADATA_BYTES = 1024 * 1024;
const readMember = async (root, member, signal) => {
  const filename = await resolveSemanticPartPath(root, member.path);
  await hashRuntimeFile({ filename, expectedHash: member.hash, expectedBytes: member.byteLength, maxBytes: MAX_METADATA_BYTES, signal });
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(filename)));
};

/** Own every database and file handle; no global cache, source overlay, or mutable runtime connection. */
export const openRuntimeQueryFamily = async ({ destination, generationId, signal, maxIndexBytes = 1024 * 1024 * 1024 }) => {
  if (!/^[a-f0-9]{64}$/.test(generationId)) throw runtimeImportError('Invalid pinned runtime family.');
  let db = null, evidence = null, offsets = null;
  try {
    const root = await resolveSemanticPartPath(destination, 'generations/' + generationId);
    const manifestFile = await resolveSemanticPartPath(root, 'manifest.json');
    if ((await fs.stat(manifestFile)).size > MAX_METADATA_BYTES) throw runtimeImportError('Runtime family manifest exceeds metadata allowance.');
    const manifestBytes = await fs.readFile(manifestFile);
    const manifest = assertRuntimeFamily('manifest', JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
    if (manifest.generationId !== generationId
      || semanticHash('pairofcleats.runtime.family.v1', { ...manifest, generationId: null }) !== generationId) throw runtimeImportError('Pinned runtime family identity mismatch.');
    const capture = assertRuntimeEvidence('capture', await readMember(root, manifest.capture, signal));
    if (manifest.evidence.count > runtimeEventLimit(capture)) throw runtimeImportError('Runtime evidence count exceeds projection allowance.');
    if (manifest.queryIndex.path !== 'query.sqlite' || manifest.evidence.path !== 'evidence.jsonl'
      || manifest.evidence.offsetsPath !== 'evidence.offsets') throw runtimeImportError('Runtime family member layout mismatch.');
    const indexPath = await resolveSemanticPartPath(root, manifest.queryIndex.path);
    await hashRuntimeFile({ filename: indexPath, expectedHash: manifest.queryIndex.hash,
      expectedBytes: manifest.queryIndex.byteLength, maxBytes: maxIndexBytes, signal });
    await hashRuntimeFile({ filename: await resolveSemanticPartPath(root, manifest.evidence.offsetsPath),
      expectedHash: manifest.evidence.offsetsHash, expectedBytes: manifest.evidence.count * 8, maxBytes: maxIndexBytes, signal });
    throwIfAborted(signal);
    db = openRuntimeQueryIndex({ filename: indexPath, manifest, capture });
    evidence = await fs.open(await resolveSemanticPartPath(root, manifest.evidence.path), 'r');
    offsets = await fs.open(await resolveSemanticPartPath(root, manifest.evidence.offsetsPath), 'r');
    if ((await evidence.stat()).size !== manifest.evidence.byteLength) throw runtimeImportError('Runtime evidence file size mismatch.');
    const hydrate = async (entry, maxBytes) => {
      throwIfAborted(signal);
      if (entry.ordinal >= manifest.evidence.count || entry.byte_length < 1 || entry.byte_length > 16 * 1024 * 1024) throw runtimeImportError('Runtime lookup row bounds invalid.');
      if (entry.byte_length > maxBytes) return null;
      const range = Buffer.alloc(16);
      const required = entry.ordinal + 1 < manifest.evidence.count ? 16 : 8;
      if ((await offsets.read(range, 0, required, entry.ordinal * 8)).bytesRead !== required) throw runtimeImportError('Runtime lookup offset unavailable.');
      throwIfAborted(signal);
      const start = range.readBigUInt64LE(0), end = required === 16 ? range.readBigUInt64LE(8) : BigInt(manifest.evidence.byteLength);
      if (start > BigInt(Number.MAX_SAFE_INTEGER) || end - start !== BigInt(entry.byte_length)
        || end > BigInt(manifest.evidence.byteLength)) throw runtimeImportError('Runtime lookup offset range mismatch.');
      const bytes = Buffer.alloc(entry.byte_length);
      if ((await evidence.read(bytes, 0, bytes.length, Number(start))).bytesRead !== bytes.length
        || bytes.at(-1) !== 10 || runtimeByteHash(bytes) !== entry.row_hash) throw runtimeImportError('Runtime selected evidence row hash mismatch.');
      throwIfAborted(signal);
      const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      assertRuntimeProjection({ capture, evidence: [row] });
      assertRuntimeIndexedRow(row, entry);
      return row;
    };
    return { manifest, capture, manifestHash: runtimeByteHash(manifestBytes), db, hydrate,
      close: async () => { db.close(); await evidence.close(); await offsets.close(); } };
  } catch (error) {
    db?.close(); await evidence?.close(); await offsets?.close();
    if (error.code === 'ENOENT') throw runtimeImportError('Pinned runtime family unavailable.', 'ERR_RUNTIME_FAMILY_UNAVAILABLE');
    throw error;
  }
};
