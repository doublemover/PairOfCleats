import { projectEmbeddingSamplingObservation } from '../../build/embeddings/sampling-observation.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { TextDecoder } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { readVerifiedContainedFileSync } from '../../../src/shared/contained-file.js';
import { resolveArtifactPath } from '../../../src/shared/artifact-io/contained-path.js';
import { sha256File } from '../../../src/shared/hash.js';
const hash = value => createHash('sha256').update(value).digest('hex');

export const evaluationFileIdentity = (file, { canonicalJson = false } = {}) => {
  if (!file) return null;
  const resolved = path.resolve(file);
  const { buffer } = readVerifiedContainedFileSync(path.dirname(resolved), resolved, { maxBytes: 32 * 1024 * 1024 });
  return { schema: 'evaluation-input.v2', sha256: hash(canonicalJson ? stableStringify(JSON.parse(buffer.toString('utf8'))) : buffer) };
};

/** Manifest checksums bind data bytes; index_state binds effective model/config.
 * Missing generations are unknown and therefore never authorize report reuse. */
export const bakeoffGenerationObservation = async (repoCacheRoot, { requestedModes = [] } = {}) => {
  const missing = () => ({ observation: 'unknown', modes: Object.fromEntries(requestedModes.map(mode => [mode,
    { observation: 'unknown', reason: 'selected-generation-mode-unavailable' }])) });
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  if (!fs.existsSync(currentPath)) return { identity: null, coverage: missing() };
  const pointer = JSON.parse(readVerifiedContainedFileSync(repoCacheRoot, currentPath, { maxBytes: 512 * 1024 }).buffer.toString('utf8'));
  const roots = pointer.buildRootsByMode ?? pointer.buildRoots;
  if (!roots || typeof roots !== 'object' || Array.isArray(roots) || !Object.keys(roots).length) return { identity: null, coverage: missing() };
  const modes = {}, coverage = {};
  for (const mode of Object.keys(roots).sort()) {
    if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) throw new Error('Unknown bakeoff generation mode.');
    const buildRoot = resolveArtifactPath(repoCacheRoot, roots[mode]);
    const manifest = resolveArtifactPath(repoCacheRoot, path.relative(repoCacheRoot, path.join(buildRoot, `index-${mode}`, 'pieces', 'manifest.json')));
    const state = resolveArtifactPath(repoCacheRoot, path.relative(repoCacheRoot, path.join(buildRoot, `index-${mode}`, 'index_state.json')));
    let stateHash = null;
    try {
      const stateRead = readVerifiedContainedFileSync(repoCacheRoot, state, { maxBytes: 8 * 1024 * 1024 });
      stateHash = stateRead.hash;
      coverage[mode] = projectEmbeddingSamplingObservation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateRead.buffer)), mode);
    } catch (error) {
      observeStorageResource(error, { phase: 'bakeoff-sampling-observation' }).requireSettled();
      stateHash ||= await sha256File(state, { containedRoot: repoCacheRoot });
      coverage[mode] = { observation: 'unknown', reason: typeof error.code === 'string' ? error.code : 'unavailable-selection-receipt' };
    }
    modes[mode] = { manifest: await sha256File(manifest, { containedRoot: repoCacheRoot }), state: stateHash };
  }
  for (const mode of requestedModes) coverage[mode] ||= { observation: 'unknown', reason: 'selected-generation-mode-unavailable' };
  return { identity: hash(stableStringify({ schema: 'bakeoff-generation.v2', pointer, modes })),
    coverage: { observation: Object.values(coverage).every(value => value.observation === 'observed') ? 'observed' : 'partial-or-unknown', modes: coverage } };
};

export const bakeoffGenerationIdentity = async repoCacheRoot => (await bakeoffGenerationObservation(repoCacheRoot)).identity;
