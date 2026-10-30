import { readExactAt } from '../../../shared/io/read-exact.js';
import { openContainedFile } from '../../../shared/contained-file.js';
import { readRuntimeMemberBytes, readRuntimeMemberJson } from './verified-reads.js';
import path from 'node:path';
import { assertRuntimeFamily } from '../../../contracts/validators/runtime-evidence-family.js';
import { assertRuntimeEvidence, assertRuntimeProjection } from '../../../contracts/validators/runtime-evidence.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { semanticHash } from '../identity.js';
import { runtimeByteHash, runtimeImportError } from './raw-store.js';
import { openRuntimeQueryIndex, assertRuntimeIndexedRow } from './query-index.js';
import { runtimeEventLimit } from './adapters/shared.js';
import { closeRuntimeResources } from './close-resources.js';

const MAX_METADATA_BYTES = 1024 * 1024;

/** Own every database and file handle; no global cache, source overlay, or mutable runtime connection. */
export const openRuntimeQueryFamily = async ({ destination, generationId, signal, maxIndexBytes = 64 * 1024 * 1024, metrics = null }) => {
  if (!/^[a-f0-9]{64}$/.test(generationId)) throw runtimeImportError('Invalid pinned runtime family.');
  let db = null, evidence = null;
  try {
    const root = await resolveSemanticPartPath(destination, 'generations/' + generationId);
    const openedManifest = await readRuntimeMemberJson({ root, relativePath: 'manifest.json',
      maxBytes: MAX_METADATA_BYTES, signal, metrics });
    const manifestBytes = openedManifest.buffer;
    const manifest = assertRuntimeFamily('manifest', openedManifest.value);
    if (manifest.generationId !== generationId
      || semanticHash('pairofcleats.runtime.family.v1', { ...manifest, generationId: null }) !== generationId) throw runtimeImportError('Pinned runtime family identity mismatch.');
    const capture = assertRuntimeEvidence('capture', (await readRuntimeMemberJson({ root, relativePath: manifest.capture.path,
      expectedHash: manifest.capture.hash, expectedBytes: manifest.capture.byteLength, maxBytes: MAX_METADATA_BYTES, signal, metrics })).value);
    if (manifest.evidence.count > runtimeEventLimit(capture)) throw runtimeImportError('Runtime evidence count exceeds projection allowance.');
    if (manifest.queryIndex.path !== 'query.sqlite' || manifest.evidence.path !== 'evidence.jsonl'
      || manifest.evidence.offsetsPath !== 'evidence.offsets') throw runtimeImportError('Runtime family member layout mismatch.');
    const index = await readRuntimeMemberBytes({ root, relativePath: manifest.queryIndex.path,
      expectedHash: manifest.queryIndex.hash, expectedBytes: manifest.queryIndex.byteLength, maxBytes: maxIndexBytes, signal, metrics });
    const offsets = (await readRuntimeMemberBytes({ root, relativePath: manifest.evidence.offsetsPath,
      expectedHash: manifest.evidence.offsetsHash, expectedBytes: manifest.evidence.count * 8, maxBytes: maxIndexBytes, signal, metrics })).buffer;
    throwIfAborted(signal);
    // The database deserializes the verified bytes, never reopens a mutable pathname.
    db = openRuntimeQueryIndex({ bytes: index.buffer, manifest, capture });
    evidence = await openContainedFile(root, path.join(root, manifest.evidence.path));
    if ((await evidence.stat()).size !== manifest.evidence.byteLength) throw runtimeImportError('Runtime evidence file size mismatch.');
    const hydrate = async (entry, maxBytes) => {
      throwIfAborted(signal);
      if (entry.ordinal >= manifest.evidence.count || entry.byte_length < 1 || entry.byte_length > 16 * 1024 * 1024) throw runtimeImportError('Runtime lookup row bounds invalid.');
      if (entry.byte_length > maxBytes) return null;
      const start = offsets.readBigUInt64LE(entry.ordinal * 8);
      const end = entry.ordinal + 1 < manifest.evidence.count ? offsets.readBigUInt64LE((entry.ordinal + 1) * 8) : BigInt(manifest.evidence.byteLength);
      if (start > BigInt(Number.MAX_SAFE_INTEGER) || end - start !== BigInt(entry.byte_length)
        || end > BigInt(manifest.evidence.byteLength)) throw runtimeImportError('Runtime lookup offset range mismatch.');
      const bytes = Buffer.alloc(entry.byte_length);
      const read = await readExactAt(evidence, bytes, 0, bytes.length, Number(start), { signal });
      if (metrics) {
        metrics.verificationBytes = (metrics.verificationBytes || 0) + read.bytesRead;
        if (Object.hasOwn(metrics, 'hydratedBytes')) metrics.hydratedBytes += read.bytesRead;
      }
      if (read.bytesRead !== bytes.length
        || bytes.at(-1) !== 10 || runtimeByteHash(bytes) !== entry.row_hash) throw runtimeImportError('Runtime selected evidence row hash mismatch.');
      throwIfAborted(signal);
      const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      assertRuntimeProjection({ capture, evidence: [row] });
      assertRuntimeIndexedRow(row, entry);
      return row;
    };
    let closing = null;
    return { manifest, capture, manifestHash: runtimeByteHash(manifestBytes), db, hydrate,
      close: () => { closing ??= closeRuntimeResources([db, evidence]); return closing; } };
  } catch (error) {
    if (error.code === 'ENOENT') error = runtimeImportError('Pinned runtime family unavailable.', 'ERR_RUNTIME_FAMILY_UNAVAILABLE');
    await closeRuntimeResources([db, evidence], error, { hasOperationError: true });
  }
};
