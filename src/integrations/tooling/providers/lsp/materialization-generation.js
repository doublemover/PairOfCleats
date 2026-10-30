import path from 'node:path';
import { createHash } from 'node:crypto';

/** A file-backed session epoch depends on actual bytes, origin and selected
 * root. Reported docHash alone cannot authorize replacing an active URI.
 * Length framing avoids ambiguous concatenation without copying all source text.
 */
export const buildVfsConsumerGeneration = ({ rootDir, docs }) => {
  if (typeof rootDir !== 'string' || !rootDir || !Array.isArray(docs)) throw new TypeError('VFS consumer generation requires its selected root and documents.');
  const hash = createHash('sha256');
  const field = value => {
    if (typeof value !== 'string') throw new TypeError('VFS generation fields must be strings.');
    hash.update(`${Buffer.byteLength(value, 'utf8')}:`); hash.update(value, 'utf8');
  };
  field('lsp.vfs-consumer-generation.v1');
  const root = path.resolve(rootDir); field(process.platform === 'win32' ? root.toLowerCase() : root);
  field(String(docs.length));
  const ordered = docs.map(doc => {
    const text = doc?.text || '';
    if (!doc || typeof doc.virtualPath !== 'string' || !doc.virtualPath || typeof text !== 'string') {
      throw new TypeError('VFS generation requires actual document origins and source bytes.');
    }
    return { virtualPath: doc.virtualPath, docHash: doc.docHash ?? '', languageId: doc.languageId ?? '',
      effectiveExt: doc.effectiveExt ?? '', text };
  }).sort((left, right) => left.virtualPath < right.virtualPath ? -1 : left.virtualPath > right.virtualPath ? 1 : 0);
  for (const doc of ordered) {
    for (const value of [doc.virtualPath, doc.docHash ?? '', doc.languageId ?? '', doc.effectiveExt ?? '', doc.text]) field(value);
  }
  return hash.digest('hex');
};
