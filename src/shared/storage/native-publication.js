import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createScanner, SyntaxKind, parseTree } from 'jsonc-parser';
import { getApplicationHome } from '../cache-roots.js';
import { resolveRepoCacheRootPath } from '../repo-paths.js';
import { isPathWithinRoot } from '../file-paths.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { stableStringify } from '../stable-json.js';
import { withFileLock } from '../locks/file-lock.js';
import { isKnownRepoAccessOwner } from '../cache/repo-access-owner.js';
import { isLocalProcessDefinitelyDead, removeLockFileSyncIfOwned } from '../locks/file-lock-info.js';
import { writeJsonObjectFile } from '../json-stream/json-writers.js';
import { isGeneratedArtifactMetadata } from '../generated-artifact-core.js';
import { resolveConfiguredNativeStorageSelection } from './configured-native-storage.js';
import { inspectNativePublicationFiles, sameNativePublicationFiles } from './native-publication-files.js';
import { describeStorageFailure } from './failure-observation.js';
import { nativePublicationFilePath } from './native-publication-files.js';
import { nativePublicationRegistryPaths, nativePublicationHomeDigest } from './native-publication-paths.js';
import { withStorageDirectory } from './directory.js';
export { nativePublicationRegistryPaths } from './native-publication-paths.js';

const pending = new WeakMap();
const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_NATIVE_PUBLICATION' });
const kinds = new Set(['building', 'ready', 'unqualified', 'deleting', 'removed']);
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && value.length < 32768;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const sourceIdentity = source => [source.repoRoot, source.repoCacheRoot, source.indexDir].map(normalize).join('\0');
const validSource = source => plain(source) && Object.keys(source).sort().join(',') === 'indexDir,repoCacheRoot,repoRoot'
  && [source.repoRoot, source.repoCacheRoot, source.indexDir].every(absolute)
  && isPathWithinRoot(source.indexDir, path.join(source.repoCacheRoot, 'builds'))
  && normalize(source.indexDir) !== normalize(path.join(source.repoCacheRoot, 'builds'));
const validIdentity = identity => plain(identity) && Object.keys(identity).sort().join(',') === 'ctimeMs,ctimeNs,dev,ino,mode,mtimeMs,mtimeNs,nlink,size'
  && ['dev', 'ino', 'mtimeNs', 'ctimeNs'].every(key => typeof identity[key] === 'string' && /^\d{1,30}$/u.test(identity[key]))
  && ['size', 'mode', 'nlink'].every(key => Number.isSafeInteger(identity[key]) && identity[key] >= 0)
  && ['mtimeMs', 'ctimeMs'].every(key => Number.isFinite(identity[key]));
const validDescriptor = identity => plain(identity) && Object.keys(identity).sort().join(',') === 'dev,ino'
  && ['dev', 'ino'].every(key => typeof identity[key] === 'string' && /^\d{1,32}$/u.test(identity[key]));
const validFamily = (family, record) => {
  if (!plain(family) || typeof family.complete !== 'boolean' || typeof family.missing !== 'boolean'
    || Object.keys(family).some(key => !['complete', 'missing', 'root', 'files', 'reason'].includes(key))
    || family.complete && Object.hasOwn(family, 'reason')
    || family.root !== null && !validIdentity(family.root) || !Array.isArray(family.files) || family.files.length > 4) return false;
  const seen = new Set();
  for (const file of family.files) {
    if (!plain(file) || Object.keys(file).sort().join(',') !== 'identity,name' || !validIdentity(file.identity)
      || file.identity.nlink !== 1 || file.identity.ino === '0' || seen.has(file.name)) return false;
    try { nativePublicationFilePath(record.backend, record.target, file.name); } catch { return false; }
    seen.add(file.name);
  }
  return true;
};
const parseRecord = buffer => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer), scanner = createScanner(text);
  let depth = 0, tokens = 0, token;
  while ((token = scanner.scan()) !== SyntaxKind.EOF) {
    if (++tokens > 8192) throw fail('Native publication token budget exceeded.');
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      if (++depth > 16) throw fail('Native publication depth budget exceeded.');
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
    if (depth < 0 || scanner.getTokenError()) throw fail('Native publication JSON is malformed.');
  }
  const errors = [], tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (errors.length || tree?.type !== 'object') throw fail('Native publication JSON is malformed.');
  const nodes = [tree];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.type === 'object') {
      const keys = new Set();
      for (const property of node.children || []) {
        const key = property.children?.[0]?.value;
        if (keys.has(key)) throw fail('Native publication JSON contains duplicate keys.');
        keys.add(key);
      }
    }
    nodes.push(...(node.children || []));
  }
  return JSON.parse(text);
};
export const validateNativePublicationRecord = (record, target) => {
  if (!plain(record) || Object.keys(record).sort().join(',') !== 'backend,deletion,family,kind,mode,namespace,ownerHomeDigest,publicationId,qualified,reason,schemaVersion,sourceWitness,sources,state,target'
    || record.schemaVersion !== 1 || record.kind !== 'native-backend-publication'
    || !['sqlite', 'lmdb'].includes(record.backend) || !kinds.has(record.state)
    || typeof record.qualified !== 'boolean' || !(record.reason === null || typeof record.reason === 'string' && record.reason.length <= 256)
    || typeof record.publicationId !== 'string'
    || !/^[a-f0-9]{64}$/u.test(record.ownerHomeDigest)
    || !/^[a-f0-9-]{36}$/u.test(record.publicationId)
    || !absolute(record.target) || normalize(record.target) !== normalize(target)
    || !absolute(record.namespace) || normalize(record.namespace) !== normalize(record.backend === 'sqlite' ? path.dirname(target) : target)
    || !['code', 'prose', 'extracted-prose', 'records'].includes(record.mode)
    || record.backend === 'lmdb' && !['code', 'prose'].includes(record.mode)
    || !Array.isArray(record.sources) || !record.sources.length || record.sources.length > 64
    || !record.sources.every(validSource) || new Set(record.sources.map(sourceIdentity)).size !== record.sources.length
    || record.sources.some(source => path.basename(source.indexDir) !== `index-${record.mode}`)
    || record.family !== null && !validFamily(record.family, record)
    || record.state === 'building' && (record.family !== null || record.sourceWitness !== null || record.deletion !== null)
    || ['ready', 'deleting', 'removed'].includes(record.state) && (!record.qualified || !record.family?.complete
      || record.family.missing || record.sourceWitness === null)
    || ['deleting', 'removed'].includes(record.state) && record.deletion === null
    || ['ready', 'unqualified'].includes(record.state) && record.deletion !== null
    || record.state === 'unqualified' && record.qualified
    || record.state === 'removed' && record.deletion?.remaining.length !== 0
    || record.state !== 'building' && record.sourceWitness !== null && (!plain(record.sourceWitness)
      || Object.keys(record.sourceWitness).sort().join(',') !== 'identity,indexDir,schemaVersion,sha256'
      || !/^[a-f0-9]{64}$/u.test(record.sourceWitness.sha256) || !validDescriptor(record.sourceWitness.identity)
      || !record.sources.some(source => normalize(source.indexDir) === normalize(record.sourceWitness.indexDir || ''))
      || !Number.isSafeInteger(record.sourceWitness.schemaVersion) || record.sourceWitness.schemaVersion < 1)
    || record.deletion !== null && (!plain(record.deletion)
      || Object.keys(record.deletion).sort().join(',') !== 'remaining'
      || !Array.isArray(record.deletion.remaining) || !record.family
      || new Set(record.deletion.remaining).size !== record.deletion.remaining.length
      || record.deletion.remaining.some(name => !record.family.files.some(file => file.name === name)))
    || record.qualified && (record.reason !== null || record.sources.some(source =>
      normalize(source.repoRoot) !== normalize(record.sources[0].repoRoot)
      || normalize(source.repoCacheRoot) !== normalize(record.sources[0].repoCacheRoot)))) throw fail('Native publication record is unknown or incompatible.');
  return record;
};

export const inspectNativePublicationHome = async (target, home, record) => {
  if (record.ownerHomeDigest !== nativePublicationHomeDigest(home)) return 'native-publication-home-mismatch';
  const paths = nativePublicationRegistryPaths(target, { home }), own = path.basename(paths.homeGuard);
  let unknown = false, found = false;
  await withStorageDirectory(paths.root, async directory => {
    for (let count = 0; ; count++) {
      if (count === 5) { unknown = true; break; }
      const entry = await directory.read(); if (!entry) break;
      if (entry.name === own) found = true;
      else if (!['publication.json', 'publication.lock', 'access'].includes(entry.name)) { unknown = true; break; }
    }
  });
  if (unknown || !found) return 'shared-or-unknown-native-home-history';
  const read = await readVerifiedContainedFile(paths.root, paths.homeGuard, { maxBytes: 1024 });
  const guard = parseRecord(read.buffer);
  if (!plain(guard) || Object.keys(guard).sort().join(',') !== 'homeDigest,kind,schemaVersion'
    || guard.schemaVersion !== 1 || guard.kind !== 'native-publication-home' || guard.homeDigest !== record.ownerHomeDigest) {
    return 'unknown-native-home-guard';
  }
  return null;
};

export const readNativePublicationRecord = async (target, options = {}) => {
  const paths = nativePublicationRegistryPaths(target, options);
  try {
    const read = await readVerifiedContainedFile(path.parse(paths.root).root, paths.record, { maxBytes: 256 * 1024, hashAlgorithm: 'sha256' });
    return { record: validateNativePublicationRecord(parseRecord(read.buffer), target),
      sha256: read.hash, identity: read.fileIdentity };
  } catch (error) {
    if (describeStorageFailure(error, { phase: 'native-publication-read' }).code === 'ENOENT') return null;
    throw error;
  }
};

/** Short metadata critical sections only. Native work keeps its original
 * backend/session owner; no publication lock is held while a database runs. */
export const withNativePublicationLock = async (target, options, action) => {
  const paths = nativePublicationRegistryPaths(target, options);
  assertNoSymlinkPath(path.parse(paths.root).root, paths.root, { allowMissing: true });
  await fs.mkdir(paths.root, { recursive: true });
  assertNoSymlinkPath(path.parse(paths.root).root, paths.root);
  return withFileLock({ lockPath: paths.lock, waitMs: 5000, staleMs: Number.MAX_SAFE_INTEGER,
    metadata: { scope: 'native-backend-publication', hostname: os.hostname() },
    timeoutBehavior: 'throw', staleRemovalImpl: async ({ lockPath, info }) => ({
      removed: Boolean(isKnownRepoAccessOwner(info) && info.scope === 'native-backend-publication'
        && isLocalProcessDefinitelyDead(info.pid) && removeLockFileSyncIfOwned(lockPath, info)), removalMode: 'owner'
    }) }, async () => {
    assertNoSymlinkPath(paths.root, paths.record, { allowMissing: true });
    return action(paths);
  });
};

export const writeNativePublicationRecord = async (paths, record) => {
  validateNativePublicationRecord(record, record.target);
  if (Buffer.byteLength(stableStringify(record)) > 240 * 1024) throw fail('Native publication exceeds its durable metadata byte budget.');
  assertNoSymlinkPath(paths.root, paths.record, { allowMissing: true });
  await writeJsonObjectFile(paths.record, { fields: record, atomic: true });
};

/** Called by the actual selected producer before its first native mutation.
 * Existing unregistered bytes, failed attempts and shared targets remain
 * unqualified. A configured path or generated marker cannot adopt them. */
export const prepareConfiguredNativePublication = async ({ backend, mode, target, indexDir, repoRoot, userConfig }) => {
  if (!absolute(indexDir) || !absolute(repoRoot)) return null;
  const context = { nativeBackend: backend, nativeMode: mode, repoRoot, userConfig };
  const selection = resolveConfiguredNativeStorageSelection(target, context);
  if (!selection) return null;
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
  if (isPathWithinRoot(target, repoCacheRoot)) return null;
  const source = { repoRoot: path.resolve(repoRoot), repoCacheRoot, indexDir: path.resolve(indexDir) };
  if (!validSource(source) || path.basename(source.indexDir) !== `index-${mode}`) return null;
  assertNoSymlinkPath(repoCacheRoot, source.indexDir);
  const home = getApplicationHome();
  const record = await withNativePublicationLock(target, { home }, async paths => {
    const previous = (await readNativePublicationRecord(target, { home }))?.record;
    if (previous && (previous.backend !== backend || previous.mode !== mode)) {
      await writeNativePublicationRecord(paths, { ...previous, state: 'unqualified', qualified: false,
        reason: 'incompatible-native-producer' });
      return null;
    }
    const family = await inspectNativePublicationFiles(backend, target);
    let qualified = family.complete && family.missing, reason = qualified ? null : 'preexisting-unregistered-native';
    if (previous) {
      qualified = previous.qualified && previous.backend === backend && previous.mode === mode
        && (previous.state === 'removed' && family.missing || previous.state === 'ready'
          && sameNativePublicationFiles(backend, previous.family, family, { allowLmdbReaderLock: true }));
      reason = qualified ? null : 'prior-publication-unqualified-or-changed';
      if (previous.ownerHomeDigest !== nativePublicationHomeDigest(home)) { qualified = false; reason = 'shared-native-publication-home'; }
    }
    const sources = [...(previous?.sources || [])];
    if (!sources.some(value => sourceIdentity(value) === sourceIdentity(source))) {
      if (sources.length === 64 || Buffer.byteLength(stableStringify([...sources, source])) > 128 * 1024) {
        qualified = false; reason = 'native-source-history-budget';
      }
      else sources.push(source);
    }
    if (sources.some(value => normalize(value.repoRoot) !== normalize(repoRoot)
      || normalize(value.repoCacheRoot) !== normalize(repoCacheRoot))) {
      qualified = false; reason = 'shared-native-publication';
    }
    const next = { schemaVersion: 1, kind: 'native-backend-publication', backend, mode,
      target: path.resolve(target), namespace: selection.namespace, publicationId: randomUUID(),
      ownerHomeDigest: previous?.ownerHomeDigest || nativePublicationHomeDigest(home),
      state: 'building', qualified, reason, sources, family: null, sourceWitness: null, deletion: null };
    if (Buffer.byteLength(stableStringify(next)) + Buffer.byteLength(JSON.stringify(source.indexDir)) + 8192 > 240 * 1024) {
      // Preserve all old reference evidence. An oversized new selection cannot
      // convert an old qualified record into permission for different bytes.
      if (previous) await writeNativePublicationRecord(paths, { ...previous, state: 'unqualified',
        qualified: false, reason: 'native-publication-byte-budget', deletion: null });
      return null;
    }
    await writeNativePublicationRecord(paths, next);
    return next;
  });
  if (!record) return null;
  const token = Object.freeze({ backend, target: path.resolve(target) });
  pending.set(token, { record, source, context, selectionDigest: digest(selection), home });
  return token;
};

/** The orchestration calls this only after original native work/close and the
 * required index-state publication have fulfilled. Its private token binds the
 * pre-write record; late or replaced attempts cannot publish cleanup authority. */
export const commitConfiguredNativePublication = async token => {
  if (token === null) return null;
  const original = pending.get(token);
  if (!original) throw fail('Native publication requires its original producer token.');
  const { record, source, context, selectionDigest, home } = original;
  if (normalize(getApplicationHome()) !== normalize(home)
    || digest(resolveConfiguredNativeStorageSelection(record.target, context)) !== selectionDigest) throw fail('Native publication selection changed.');
  return withNativePublicationLock(record.target, { home }, async paths => {
    const current = await readNativePublicationRecord(record.target, { home });
    if (!current || digest(current.record) !== digest(record)) throw fail('Native publication attempt was replaced or changed.');
    const stateFile = path.join(source.indexDir, 'index_state.json');
    const stateRead = await readVerifiedContainedFile(source.repoCacheRoot, stateFile, { maxBytes: 4 * 1024 * 1024, hashAlgorithm: 'sha256' });
    const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateRead.buffer));
    const backendState = state[record.backend];
    if (!isGeneratedArtifactMetadata(state.extensions?.__poc_generated, 'index-state') || state.mode !== record.mode
      || !plain(backendState) || !absolute(backendState.path) || normalize(backendState.path) !== normalize(record.target)
      || !Number.isSafeInteger(backendState.schemaVersion) || backendState.schemaVersion < 1
      || (record.backend === 'sqlite' ? backendState.status !== 'ready' : backendState.ready !== true || backendState.pending !== false)) {
      throw fail('Native cleanup publication requires its actual ready index-state producer.');
    }
    const family = await inspectNativePublicationFiles(record.backend, record.target);
    const complete = family.complete && !family.missing && family.files.some(file => file.name === (record.backend === 'sqlite' ? '' : 'data.mdb'))
      && (record.backend !== 'sqlite' || family.files.length === 1);
    const next = { ...record, state: record.qualified && complete ? 'ready' : 'unqualified',
      qualified: record.qualified && complete, reason: record.reason || (complete ? null : 'unqualified-final-native-family'),
      family, sourceWitness: record.qualified && complete ? { indexDir: source.indexDir, sha256: stateRead.hash,
        identity: stateRead.fileIdentity, schemaVersion: backendState.schemaVersion } : null };
    await writeNativePublicationRecord(paths, next);
    pending.delete(token);
    return Object.freeze({ state: next.state, qualified: next.qualified, publicationId: next.publicationId });
  });
};

/** A standalone compactor preserves the original admitted source identity; it
 * cannot adopt a database or relabel it as a newly selected generation. Nested
 * build compaction sees a building record and leaves that producer in charge. */
export const prepareExistingConfiguredNativePublication = async input => {
  const publication = await readNativePublicationRecord(input.target);
  const record = publication?.record;
  if (!record?.qualified || record.state !== 'ready' || record.backend !== input.backend || record.mode !== input.mode
    || !record.sourceWitness || record.sources.some(source => normalize(source.repoRoot) !== normalize(input.repoRoot)
      || normalize(source.repoCacheRoot) !== normalize(resolveRepoCacheRootPath(input.repoRoot, input.userConfig)))) return null;
  try {
    assertNoSymlinkPath(path.parse(record.sourceWitness.indexDir).root, record.sourceWitness.indexDir);
    if (!(await fs.lstat(record.sourceWitness.indexDir)).isDirectory()) return null;
  } catch (error) {
    if (describeStorageFailure(error, { phase: 'native-compaction-source' }).code === 'ENOENT') return null;
    throw error;
  }
  return prepareConfiguredNativePublication({ ...input, indexDir: record.sourceWitness.indexDir });
};
