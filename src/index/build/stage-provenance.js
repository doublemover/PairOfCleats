import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocess } from '../../shared/subprocess/runner.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { runWithSettledConcurrency } from '../../shared/concurrency/run-with-queue.js';
import { stageIdentityHash } from './stage-output.js';
import { normalizeContentConfig } from './runtime/hash.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../semantic/analysis-versions.js';
import { SIGNATURE_VERSION } from './indexer/signatures.js';

const toolRoot = fileURLToPath(new URL('../../../', import.meta.url));
const paths = ['src', 'bin', 'tools', 'rules', 'patches', 'package.json', 'package-lock.json'];

// Parse the NUL format, including the second pathname of rename/copy records.
// Tracked paths still come from diff HEAD: index-only changes can cancel in the
// worktree, so status is authoritative only for HEAD and untracked membership.
export const readProducerStatus = status => {
  const invalid = () => { throw new Error('Invalid implementation Git status observation.'); };
  if (!status.endsWith('\0')) invalid();
  const records = status.slice(0, -1).split('\0'), headers = new Map(), untracked = [];
  const ordinary = /^1 [.MADRCUT]{2} (?:N\.\.\.|S[.C][.M][.U])(?: [0-7]{6}){3}(?: [a-f0-9]{40}(?:[a-f0-9]{24})?){2} (.+)$/s;
  const renamed = /^2 [.MADRCUT]{2} (?:N\.\.\.|S[.C][.M][.U])(?: [0-7]{6}){3}(?: [a-f0-9]{40}(?:[a-f0-9]{24})?){2} [RC](?:100|[1-9]?\d) (.+)$/s;
  const unmerged = /^u (?:DD|AU|UD|UA|DU|AA|UU) (?:N\.\.\.|S[.C][.M][.U])(?: [0-7]{6}){4}(?: [a-f0-9]{40}(?:[a-f0-9]{24})?){3} (.+)$/s;
  let changed = false;
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const header = /^# branch\.(oid|head|upstream|ab) (.+)$/.exec(record);
    if (header) {
      const [, name, value] = header;
      if (headers.has(name) || (name === 'oid' && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value))
        || (name === 'ab' && !/^\+\d+ -\d+$/.test(value))
        || ((name === 'head' || name === 'upstream') && /[\x00-\x20\x7f]/.test(value))) invalid();
      headers.set(name, value);
    } else if (record.startsWith('? ') && record.length > 2) {
      changed = true; untracked.push(record.slice(2));
    } else if (renamed.test(record)) {
      if (!records[++index]) invalid();
      changed = true;
    } else if (ordinary.test(record) || unmerged.test(record)) {
      changed = true;
    } else invalid();
  }
  if (!headers.has('oid') || !headers.has('head')) invalid();
  return { revision: headers.get('oid'), clean: !changed, untracked };
};

const producerIdentity = (revision, dirty, bootstrap) => {
  const value = { schemaVersion: 1, revision, dirty: stageIdentityHash(dirty), dirtyFiles: dirty.length,
    bootstrap, node: process.version, signatureVersion: SIGNATURE_VERSION,
    analysisVersions: SEMANTIC_ANALYSIS_VERSIONS, evidenceScope: 'observed-implementation-files-and-bootstrap-receipt' };
  return { ...value, identity: stageIdentityHash(value) };
};

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
    const capture = result.outputCapture?.stdout;
    // The bounded collector compares its original raw bytes with the encoded
    // result. Unknown or lossy decoding cannot grant pathname authority, while
    // a legitimate literal replacement character remains lossless.
    if (result.exitCode !== 0 || capture?.enabled !== true || capture?.truncated !== false
      || capture?.encodingLoss !== false || result.outputCapture?.stderr?.truncated
      || result.outputCapture?.stderr?.encodingLoss === true || typeof result.stdout !== 'string') {
      throw new Error('Implementation Git provenance is unavailable, truncated, or not lossless UTF-8.');
    }
    return result.stdout;
  };
  try {
    const status = () => git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--', ...paths]);
    const initial = readProducerStatus(await status());
    const revision = initial.revision;
    if (initial.clean) {
      // One status supplies both HEAD and dirty membership. No file hashes are
      // omitted unless that closed observation is clean, and a second fresh
      // observation must agree after reading the actual bootstrap receipt.
      const bootstrap = await readVerifiedContainedFile(toolRoot, path.join(toolRoot, 'node_modules/.pairofcleats-bootstrap.json'), { maxBytes: 8 * 1024 * 1024, signal });
      const final = readProducerStatus(await status());
      if (!final.clean || final.revision !== revision) throw new Error('Implementation membership changed during observation.');
      return producerIdentity(revision, [], bootstrap.hash);
    }
    const membership = async observation => {
      const tracked = await git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--', ...paths]);
      if (tracked && !tracked.endsWith('\0')) throw new Error('Invalid implementation Git diff observation.');
      const trackedPaths = tracked ? tracked.slice(0, -1).split('\0') : [];
      if (trackedPaths.some(relative => !relative)) throw new Error('Invalid implementation Git diff observation.');
      return [...new Set([...trackedPaths, ...observation.untracked])].sort();
    };
    const dirtyPaths = await membership(initial);
    if (dirtyPaths.length > 2000) throw new Error('Implementation dirty inventory exceeds its allowance.');
    let bytes = 0;
    const dirty = await runWithSettledConcurrency(dirtyPaths, 4, async relative => {
      try {
        const filename = resolveArtifactPath(toolRoot, relative);
        const read = await readVerifiedContainedFile(toolRoot, filename, { maxBytes: 8 * 1024 * 1024, signal });
        bytes += read.buffer.length;
        if (bytes > 64 * 1024 * 1024) throw new Error('Implementation dirty content exceeds its allowance.');
        return { path: relative, bytes: read.buffer.length, hash: read.hash };
      } catch (error) {
        const observation = observeStorageResource(error, { phase: 'stage-producer-source-read' });
        observation.requireSettled();
        if (signal?.aborted || error.code !== 'ENOENT') throw error;
        return { path: relative, missing: true };
      }
    }, { signal, collectResults: true });
    // Keep the final diff before the final status, closing both tracked and
    // untracked inventories after every original content reader has settled.
    const finalTracked = await membership({ untracked: [] });
    const final = readProducerStatus(await status());
    const finalPaths = [...new Set([...finalTracked, ...final.untracked])].sort();
    if (stageIdentityHash(finalPaths) !== stageIdentityHash(dirtyPaths)
      || final.revision !== revision) throw new Error('Implementation membership changed during observation.');
    const bootstrap = await readVerifiedContainedFile(toolRoot, path.join(toolRoot, 'node_modules/.pairofcleats-bootstrap.json'), { maxBytes: 8 * 1024 * 1024, signal });
    return producerIdentity(revision, dirty, bootstrap.hash);
  } catch (error) {
    observeStorageResource(error, { phase: 'stage-producer-observation' }).requireSettled();
    if (signal?.aborted) throw error;
    return { schemaVersion: 1, identity: null, reason: 'implementation-or-bootstrap-provenance-unavailable' };
  }
};

export const buildStageReusePolicy = (runtime, mode) => {
  if (!Object.hasOwn(runtime, 'stageReuseEnvironment')) return null;
  const config = normalizeContentConfig({ ...runtime.userConfig, indexing: runtime.indexingConfig });
  const environment = { ...runtime.stageReuseEnvironment };
  if (!runtime.embeddingEnabled && !runtime.embeddingService) {
    if (config.indexing) delete config.indexing.embeddings;
    delete config.models;
    for (const name of ['embeddings', 'embeddingsSampleFiles', 'embeddingsSampleSeed']) delete environment[name];
  }
  delete config.sqlite;
  if (config.indexing?.twoStage) {
    for (const name of ['enabled', 'stage1', 'stage3', 'stage4', 'background']) delete config.indexing.twoStage[name];
  }
  return stageIdentityHash({ schemaVersion: 1, mode, config, semanticPolicy: runtime.semanticPolicy,
    environment,
    dependencyContract: 'whole-mode-stage2.v1' });
};
