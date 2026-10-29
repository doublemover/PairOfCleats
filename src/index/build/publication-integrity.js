import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { sha256File, sha1File, checksumFile } from '../../shared/hash.js';
import { resolveArtifactPath, assertArtifactFilePath } from '../../shared/artifact-io/contained-path.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const changed = () => Object.assign(new Error('[artifact-publication] generation integrity changed; fresh qualification is required.'),
  { code: 'ERR_ARTIFACT_PUBLICATION_INTEGRITY' });
export const publicationInventoryDigest = pieces => createHash('sha256').update(stableStringify(pieces)).digest('hex');

/** No all-generation sealed owner is available here. Independently qualify
 * current contained bytes, with bounded streaming hashes, at each boundary. */
export const observePublicationIntegrity = async ({ outDir, manifestPath }) => {
  const filename = assertArtifactFilePath(outDir, manifestPath);
  const read = await readVerifiedContainedFile(outDir, filename, { maxBytes: MAX_MANIFEST_BYTES });
  const manifest = JSON.parse(read.buffer.toString('utf8'));
  if (!Array.isArray(manifest.pieces)) throw changed();
  const declared = new Map(manifest.pieces.map(piece => [piece.path, piece]));
  const content = createHash('sha256');
  const visit = async relative => {
    const selected = resolveArtifactPath(outDir, relative);
    const stat = await fs.lstat(selected);
    if (stat.isDirectory()) {
      content.update(stableStringify({ path: relative, type: 'directory' }) + '\n');
      const entries = await fs.readdir(selected);
      entries.sort();
      for (const name of entries) await visit(path.posix.join(relative, name));
    } else if (stat.isFile()) {
      const hash = await sha256File(selected, { containedRoot: outDir });
      const piece = declared.get(relative);
      if (piece?.bytes != null && piece.bytes !== stat.size) throw changed();
      if (piece?.checksum != null) {
        const match = /^(sha256|sha1|xxh64):([a-f0-9]+)$/i.exec(piece.checksum);
        const algorithm = match?.[1]?.toLowerCase(), lengths = { sha256: 64, sha1: 40, xxh64: 16 };
        if (!algorithm || match[2].length !== lengths[algorithm]) throw changed();
        const actual = algorithm === 'sha256' ? hash : algorithm === 'sha1'
          ? await sha1File(selected, { containedRoot: outDir })
          : (await checksumFile(selected, { containedRoot: outDir })).value;
        if (actual.toLowerCase() !== match[2].toLowerCase()) throw changed();
      }
      content.update(stableStringify({ path: relative, type: 'file', hash }) + '\n');
    } else throw changed();
  };
  const paths = [...new Set(manifest.pieces.map(piece => piece.path))].sort();
  for (const relative of paths) await visit(relative);
  await readVerifiedContainedFile(outDir, filename, { maxBytes: MAX_MANIFEST_BYTES, expectedHash: read.hash });
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
