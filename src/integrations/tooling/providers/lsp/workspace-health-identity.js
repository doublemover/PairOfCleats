import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../../../../index/semantic/identity.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../../../shared/contained-file.js';
import { observeStorageResource, describeStorageFailure } from '../../../../shared/storage/failure-observation.js';
import { isAbortError, throwIfAborted } from '../../../../shared/abort.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const nativeKey = stat => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));
const rootKey = filename => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename);
const requireSettledFailure = (error, signal, phase) => {
  const original = observeStorageResource(error, { phase }); original.requireSettled();
  let aborted;
  try { aborted = isAbortError(error); }
  catch (inspection) { throw original.retain(inspection, { inspectionPresent: true }); }
  original.requireSettled();
  if (aborted) throw error;
  throwIfAborted(signal);
};

/** Advisory health identity, never semantic cache provenance or complete
 * dependency-closure proof. Unknown/read-refused identity disables durable reuse;
 * it must not become a stable generic error fingerprint for a repaired project. */
export const observeWorkspaceHealthIdentity = async ({ repoRoot, workspaceRoot, providerId, workspaceKey = null,
  command, args = [], environment, documents = [], initializationOptions = null, providerVersion = null,
  configFileNames = [], policy = {}, signal = null }) => {
  throwIfAborted(signal);
  if (!Array.isArray(documents) || documents.length > 4096 || !documents.length
    || documents.some(doc => typeof doc?.text !== 'string' || typeof doc.virtualPath !== 'string')
    || typeof command !== 'string' || !path.isAbsolute(command)
    || !Array.isArray(configFileNames) || configFileNames.length > 32
    || configFileNames.some(name => typeof name !== 'string' || !name || name === '.' || name === '..'
      || name.length > 256 || path.basename(name) !== name || /[\\/:\0]/u.test(name))
    || !environment || typeof environment !== 'object' || Array.isArray(environment)) {
    return Object.freeze({ fingerprint: null, reason: 'health-input-identity-unavailable' });
  }
  let bytes = 0;
  const sources = [];
  for (const doc of documents) {
    bytes += Buffer.byteLength(doc.text);
    if (bytes > 8 * 1024 * 1024) return Object.freeze({ fingerprint: null, reason: 'health-source-byte-budget' });
    sources.push({ path: doc.virtualPath, container: doc.containerPath || null, sha256: digest(doc.text),
      language: doc.languageId || null, effectiveExt: doc.effectiveExt || null,
      segmentUid: doc.segmentUid || null, segmentStart: doc.segmentStart ?? null, segmentEnd: doc.segmentEnd ?? null });
  }
  sources.sort((left, right) => canonicalSemanticJson(left).localeCompare(canonicalSemanticJson(right)));
  let context;
  try {
    context = JSON.parse(canonicalSemanticJson({ providerId, workspaceKey, args, environment,
      initializationOptions, providerVersion, configFileNames, policy }, { maxBytes: 4 * 1024 * 1024,
      check: () => throwIfAborted(signal) }));
  } catch (error) {
    requireSettledFailure(error, signal, 'workspace-health-declaration');
    return Object.freeze({ fingerprint: null, reason: 'health-declaration-unavailable' });
  }
  try {
    const root = path.resolve(repoRoot), workspace = path.resolve(workspaceRoot || root);
    assertNoSymlinkPath(root, workspace);
    const realRoot = await fs.realpath(root), realWorkspace = await fs.realpath(workspace);
    const resolvedCommand = await fs.realpath(command), tool = await fs.lstat(resolvedCommand, { bigint: true });
    if (!tool.isFile() || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => typeof tool[key] !== 'bigint')) {
      return Object.freeze({ fingerprint: null, reason: 'health-runtime-identity-unavailable' });
    }
    const files = [];
    for (const parent of [...new Set([root, workspace])].sort()) for (const name of [...new Set(context.configFileNames)].sort()) {
      throwIfAborted(signal);
      const filename = path.join(parent, name);
      try {
        const read = await readVerifiedContainedFile(root, filename, { maxBytes: Math.min(1024 * 1024, 8 * 1024 * 1024 - bytes), signal });
        bytes += read.buffer.length;
        files.push([rootKey(filename), read.hash]);
      } catch (error) {
        if (describeStorageFailure(error, { phase: 'workspace-health-config-observation' }).code !== 'ENOENT') throw error;
        files.push([rootKey(filename), null]);
      }
    }
    const after = await fs.lstat(resolvedCommand, { bigint: true });
    if (!after.isFile() || nativeKey(tool).join(':') !== nativeKey(after).join(':')) {
      return Object.freeze({ fingerprint: null, reason: 'health-runtime-changed' });
    }
    throwIfAborted(signal);
    const scope = { providerId: context.providerId, repoRoot: rootKey(realRoot), workspaceRoot: rootKey(realWorkspace) };
    const fingerprint = digest(canonicalSemanticJson({ schemaVersion: 1, scope, sources, files,
      runtime: { path: rootKey(resolvedCommand), stat: nativeKey(after), node: process.version, platform: process.platform, arch: process.arch },
      context }));
    return Object.freeze({ fingerprint, scopeKey: digest(canonicalSemanticJson(scope)), reason: null,
      identityScope: 'observed-runtime-source-config-policy-health-only' });
  } catch (error) {
    requireSettledFailure(error, signal, 'workspace-health-identity');
    return Object.freeze({ fingerprint: null, reason: 'health-file-identity-unavailable' });
  }
};
