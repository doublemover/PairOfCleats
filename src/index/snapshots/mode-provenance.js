import { createHash } from 'node:crypto';
import { readVerifiedContainedFileSync } from '../../shared/contained-file.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';

export const readFrozenModeState = ({ frozenRoot, mode, receipt }) => {
  if (receipt?.mode !== mode || receipt.statePath !== `provenance/${mode}.build_state.json`
    || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')) throw new Error(`Invalid frozen ${mode} provenance receipt.`);
  const file = resolveArtifactPath(frozenRoot, receipt.statePath);
  const { buffer } = readVerifiedContainedFileSync(frozenRoot, file, { maxBytes: 8 * 1024 * 1024 });
  if (createHash('sha256').update(buffer).digest('hex') !== receipt.sha256) throw new Error(`Frozen ${mode} state checksum mismatch.`);
  const state = JSON.parse(buffer.toString('utf8'));
  const manifestPath = resolveArtifactPath(frozenRoot, `index-${mode}/pieces/manifest.json`);
  const manifest = JSON.parse(readVerifiedContainedFileSync(frozenRoot, manifestPath, { maxBytes: 8 * 1024 * 1024 }).buffer.toString('utf8'));
  if (state.buildId !== receipt.buildId || manifest.buildId !== state.buildId || manifest.mode !== mode
    || (state.configHash ?? null) !== receipt.configHash || (state.tool?.version ?? null) !== receipt.toolVersion
    || (manifest.compatibilityKey ?? null) !== receipt.compatibilityKey) {
    throw new Error(`Frozen ${mode} state and artifact generation disagree.`);
  }
  return state;
};
