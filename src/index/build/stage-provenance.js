import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocess } from '../../shared/subprocess/runner.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { stageIdentityHash } from './stage-output.js';
import { normalizeContentConfig } from './runtime/hash.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../semantic/analysis-versions.js';
import { SIGNATURE_VERSION } from './indexer/signatures.js';

const toolRoot = fileURLToPath(new URL('../../../', import.meta.url));
const paths = ['src', 'bin', 'tools', 'rules', 'patches', 'package.json', 'package-lock.json'];

/** Git supplies dirty membership; only changed implementation files are hashed.
 * This is reuse admission evidence, not a second full-tree diagnostic scan.
 */
export const observeStageProducer = async (signal = null) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
  const git = async args => {
    const result = await spawnSubprocess('git', ['--no-pager', '--no-replace-objects', '-C', toolRoot, ...args], {
      env, signal, outputMode: 'string', rejectOnNonZeroExit: false, timeoutMs: 2000,
      maxOutputBytes: 2 * 1024 * 1024
    });
    if (result.exitCode !== 0 || result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated) throw new Error('Implementation Git provenance is unavailable or truncated.');
    return String(result.stdout || '');
  };
  try {
    const revision = (await git(['rev-parse', '--verify', 'HEAD'])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Invalid implementation revision.');
    const membership = async () => [...new Set((await git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--', ...paths])
      + await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths])).split('\0').filter(Boolean))].sort();
    const dirtyPaths = await membership();
    if (dirtyPaths.length > 2000) throw new Error('Implementation dirty inventory exceeds its allowance.');
    const dirty = []; let bytes = 0;
    for (const relative of dirtyPaths) {
      const filename = resolveArtifactPath(toolRoot, relative);
      try {
        const read = await readVerifiedContainedFile(toolRoot, filename, { maxBytes: 8 * 1024 * 1024, signal });
        bytes += read.buffer.length;
        if (bytes > 64 * 1024 * 1024) throw new Error('Implementation dirty content exceeds its allowance.');
        dirty.push({ path: relative, bytes: read.buffer.length, hash: read.hash });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        dirty.push({ path: relative, missing: true });
      }
    }
    if (stageIdentityHash(await membership()) !== stageIdentityHash(dirtyPaths)
      || (await git(['rev-parse', '--verify', 'HEAD'])).trim() !== revision) throw new Error('Implementation membership changed during observation.');
    const bootstrap = await readVerifiedContainedFile(toolRoot, path.join(toolRoot, 'node_modules/.pairofcleats-bootstrap.json'), { maxBytes: 8 * 1024 * 1024, signal });
    const value = { schemaVersion: 1, revision, dirty: stageIdentityHash(dirty), dirtyFiles: dirty.length,
      bootstrap: bootstrap.hash, node: process.version, signatureVersion: SIGNATURE_VERSION,
      analysisVersions: SEMANTIC_ANALYSIS_VERSIONS, evidenceScope: 'observed-implementation-files-and-bootstrap-receipt' };
    return { ...value, identity: stageIdentityHash(value) };
  } catch (error) {
    observeStorageResource(error, { phase: 'stage-producer-observation' }).requireSettled();
    if (signal?.aborted) throw error;
    return { schemaVersion: 1, identity: null, reason: 'implementation-or-bootstrap-provenance-unavailable' };
  }
};

export const buildStageReusePolicy = (runtime, mode) => {
  if (!Object.hasOwn(runtime, 'stageReuseEnvironment')) return null;
  const config = normalizeContentConfig({ ...runtime.userConfig, indexing: runtime.indexingConfig });
  if (!runtime.embeddingEnabled && !runtime.embeddingService) {
    if (config.indexing) delete config.indexing.embeddings;
    delete config.models;
  }
  delete config.sqlite;
  return stageIdentityHash({ schemaVersion: 1, mode, config, semanticPolicy: runtime.semanticPolicy,
    environment: runtime.stageReuseEnvironment,
    dependencyContract: 'whole-mode-stage2.v1' });
};
