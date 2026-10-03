import { MAX_JSON_BYTES, loadChunkMeta, loadJsonArrayArtifact } from '../../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig } from '../../../../tools/shared/dict-utils.js';

export const loadCodeChunkArtifacts = async (repoDir, label) => {
  const userConfig = loadUserConfig(repoDir);
  const codeDir = getIndexDir(repoDir, 'code', userConfig);
  try {
    const chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES, strict: true });
    const fileMeta = await loadJsonArrayArtifact(codeDir, 'file_meta', { maxBytes: MAX_JSON_BYTES, strict: true });
    const fileById = new Map(
      (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
    );
    return {
      chunkMeta,
      fileMeta,
      resolveChunkFile: (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null
    };
  } catch (err) {
    console.error(`Failed to load ${label} artifacts at ${codeDir}: ${err?.message || err}`);
    process.exit(1);
  }
};
