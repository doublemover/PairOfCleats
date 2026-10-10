import { createHash } from 'node:crypto';
import { createSourceUnitId } from './identity.js';

/**
 * Own an exact UTF-8 source snapshot. Offsets and line starts are UTF-16 code
 * units into text, including BOM/CRLF; byteHash always hashes original bytes.
 * Other decoder families must provide a separate explicit adapter.
 */
export const createSemanticSourceSnapshot = ({
  bytes, repositoryNamespace, path, language, dialect = null, mapping = null
}) => {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Original source bytes are required.');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const byteHash = createHash('sha256').update(bytes).digest('hex');
  const textHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const decoding = 'utf8-fatal-preserve-bom-v1';
  const lineStarts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    const unit = text.charCodeAt(offset);
    if (unit === 13) {
      if (text.charCodeAt(offset + 1) === 10) offset += 1;
      lineStarts.push(offset + 1);
    } else if (unit === 10 || unit === 0x2028 || unit === 0x2029) {
      lineStarts.push(offset + 1);
    }
  }
  const sourceUnitId = createSourceUnitId({
    repositoryNamespace, path, byteHash, decoding, language, dialect, mapping
  });
  return {
    text,
    manifest: {
      schemaVersion: 1, sourceUnitId, repositoryNamespace, path, byteHash, textHash,
      encoding: 'utf8', decoding, language, dialect, mapping,
      coordinateUnit: 'utf16', textLength: text.length, byteLength: bytes.byteLength, lineStarts
    }
  };
};
