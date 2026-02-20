export { VFS_MANIFEST_MAX_ROW_BYTES } from './vfs/constants.js';

export {
  resolveEffectiveExt,
  buildVfsVirtualPath,
  buildVfsHashVirtualPath,
  resolveVfsVirtualPath
} from './vfs/virtual-path.js';

export { resolveEffectiveLanguageId } from './vfs/segments.js';

export {
  trimVfsManifestRow,
  compareVfsManifestRows,
  buildToolingVirtualDocuments,
  buildVfsManifestRowsForFile
} from './vfs/documents.js';

export { ensureVfsDiskDocument, resolveVfsDiskPath } from './vfs/disk.js';

export { loadVfsManifestBloomFilter, computeVfsManifestHash } from './vfs/manifest.js';

export { createVfsColdStartCache } from './vfs/cold-start.js';

export { loadVfsManifestIndex } from './vfs/manifest-index.js';

export {
  parseBinaryJsonRowBuffer,
  createVfsManifestOffsetReader,
  readVfsManifestRowsAtOffsets,
  readVfsManifestRowAtOffset
} from './vfs/offset-reader.js';

export { loadVfsManifestRowByPath } from './vfs/lookup.js';
