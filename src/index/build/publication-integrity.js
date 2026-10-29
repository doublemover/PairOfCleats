import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { hashFileObservation } from '../../shared/hash.js';
import { resolveArtifactPath, assertArtifactFilePath } from '../../shared/artifact-io/contained-path.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { runWithSettledConcurrency } from '../../shared/concurrency/run-with-queue.js';
import { throwIfAborted } from '../../shared/abort.js';

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const changed = () => Object.assign(new Error('[artifact-publication] generation integrity changed; fresh qualification is required.'),
  { code: 'ERR_ARTIFACT_PUBLICATION_INTEGRITY' });
export const publicationInventoryDigest = pieces => createHash('sha256').update(stableStringify(pieces)).digest('hex');

/** No all-generation sealed owner is available here. Independently qualify
 * current contained bytes, with bounded streaming hashes, at each boundary. */
export const observePublicationIntegrity = async ({ outDir, manifestPath, signal = null }) => {
  throwIfAborted(signal);
  const filename = assertArtifactFilePath(outDir, manifestPath);
  const read = await readVerifiedContainedFile(outDir, filename, { maxBytes: MAX_MANIFEST_BYTES, signal });
  const manifest = JSON.parse(read.buffer.toString('utf8'));
  if (!Array.isArray(manifest.pieces)) throw changed();
  const declared = new Map(manifest.pieces.map(piece => [piece.path, piece]));
  const content = createHash('sha256');
  const observeMember = async relative => {
    throwIfAborted(signal);
    const selected = resolveArtifactPath(outDir, relative);
    const stat = await fs.lstat(selected);
    if (stat.isDirectory()) {
      return { path: relative, type: 'directory' };
    } else if (stat.isFile()) {
      const piece = declared.get(relative);
      let algorithm = 'sha256', expectedHash = null;
      if (piece?.checksum != null) {
        const match = /^(sha256|sha1|xxh64):([a-f0-9]+)$/i.exec(piece.checksum);
        const lengths = { sha256: 64, sha1: 40, xxh64: 16 };
        algorithm = match?.[1]?.toLowerCase();
        if (!algorithm || match[2].length !== lengths[algorithm]) throw changed();
        expectedHash = match[2].toLowerCase();
      }
      const observed = await hashFileObservation(selected, { containedRoot: outDir, signal,
        algorithms: algorithm === 'sha256' ? ['sha256'] : ['sha256', algorithm] });
      if (piece?.bytes != null && piece.bytes !== observed.bytes) throw changed();
      if (expectedHash !== null && observed.value[algorithm].toLowerCase() !== expectedHash) throw changed();
      return { path: relative, type: 'file', hash: observed.value.sha256 };
    } else throw changed();
  };
  const commitMember = async observed => {
    throwIfAborted(signal);
    content.update(stableStringify(observed) + '\n');
    if (observed.type === 'directory') {
      const selected = resolveArtifactPath(outDir, observed.path);
      const entries = await fs.readdir(selected);
      entries.sort();
      // Directory descendants stream in the original canonical order; never
      // retain an unbounded subtree transcript to parallelize its hash updates.
      for (const name of entries) await commitMember(await observeMember(path.posix.join(observed.path, name)));
    }
  };
  const paths = [...new Set(manifest.pieces.map(piece => piece.path))].sort();
  for (let offset = 0; offset < paths.length; offset += 4) {
    // At most four original readers/64KiB buffers. Settle the entire admitted
    // batch before exposing failure; hash its compact receipts in source order.
    const observed = await runWithSettledConcurrency(paths.slice(offset, offset + 4), 4,
      observeMember, { signal, collectResults: true });
    for (const member of observed) await commitMember(member);
  }
  await readVerifiedContainedFile(outDir, filename, { maxBytes: MAX_MANIFEST_BYTES, expectedHash: read.hash, signal });
  return { schemaVersion: 1, algorithm: 'sha256',
    manifestHash: createHash('sha256').update(stableStringify(manifest)).digest('hex'),
    contentHash: content.digest('hex') };
};

export const assertPublicationIntegrity = async ({ outDir, manifestPath, binding }) => {
  if (!binding || binding.schemaVersion !== 1 || binding.algorithm !== 'sha256') throw changed();
  const current = await observePublicationIntegrity({ outDir, manifestPath });
  if (stableStringify(current) !== stableStringify(binding)) throw changed();
  return current;
};
