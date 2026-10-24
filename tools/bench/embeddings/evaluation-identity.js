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
export const bakeoffGenerationIdentity = async repoCacheRoot => {
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  if (!fs.existsSync(currentPath)) return null;
  const pointer = JSON.parse(readVerifiedContainedFileSync(repoCacheRoot, currentPath, { maxBytes: 512 * 1024 }).buffer.toString('utf8'));
  const roots = pointer.buildRootsByMode ?? pointer.buildRoots;
  if (!roots || typeof roots !== 'object' || Array.isArray(roots) || !Object.keys(roots).length) return null;
  const modes = {};
  for (const mode of Object.keys(roots).sort()) {
    if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) throw new Error('Unknown bakeoff generation mode.');
    const buildRoot = resolveArtifactPath(repoCacheRoot, roots[mode]);
    const manifest = resolveArtifactPath(repoCacheRoot, path.relative(repoCacheRoot, path.join(buildRoot, `index-${mode}`, 'pieces', 'manifest.json')));
    const state = resolveArtifactPath(repoCacheRoot, path.relative(repoCacheRoot, path.join(buildRoot, `index-${mode}`, 'index_state.json')));
    modes[mode] = { manifest: await sha256File(manifest, { containedRoot: repoCacheRoot }),
      state: await sha256File(state, { containedRoot: repoCacheRoot }) };
  }
  return hash(stableStringify({ schema: 'bakeoff-generation.v2', pointer, modes }));
};
