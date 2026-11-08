import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { isAbortError, throwIfAborted } from '../../shared/abort.js';
import { canonicalSemanticJson } from '../semantic/identity.js';
import { createCommandProbeEnvironmentIdentity } from './command-probe-persistent-cache.js';
import { findBinaryOnPath } from './binary-utils.js';
import { findWorkspaceMarkersNearPaths } from './workspace-model.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const names = ['pyrightconfig.json', 'pyproject.toml', 'setup.cfg', 'requirements.txt', '.python-version'];

/** Health/quarantine identity for observed request inputs, never a claim of
 * complete interpreter/import/dependency closure or semantic cache provenance.
 * Unreadable/oversized inputs disable persisted health reuse rather than make a
 * stable generic error token stand for a repaired workspace. */
export const resolvePyrightHealthIdentity = async ({ repoRoot, documents = [], command, args = [],
  configHash, runtimeConfig, observedVersion = null, signal = null }) => {
  throwIfAborted(signal);
  try {
    if (documents.length > 4096 || documents.some(doc => typeof doc.text !== 'string')) return null;
    let observedBytes = documents.reduce((total, doc) => total + Buffer.byteLength(doc.text), 0);
    if (observedBytes > 8 * 1024 * 1024) return null;
    const root = path.resolve(repoRoot);
    const markers = findWorkspaceMarkersNearPaths(root, documents.map(doc => doc.containerPath || doc.virtualPath).filter(Boolean), { exactNames: names });
    const roots = [...new Set([root, ...markers.map(marker => marker.markerDirAbs)])].sort();
    if (roots.length > 16) return null;
    const files = [];
    for (const workspace of roots) for (const name of names) {
      throwIfAborted(signal);
      const filename = path.join(workspace, name);
      try {
        const bytes = (await readVerifiedContainedFile(root, filename, { maxBytes: 2 * 1024 * 1024, signal })).buffer;
        observedBytes += bytes.length;
        if (observedBytes > 8 * 1024 * 1024) return null;
        files.push([path.relative(root, filename).replaceAll('\\', '/'), hash(bytes)]);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        files.push([path.relative(root, filename).replaceAll('\\', '/'), '<absent>']);
      }
    }
    const filename = findBinaryOnPath(command) || command;
    const stat = await fs.stat(filename, { bigint: true });
    if (!stat.isFile()) return null;
    const tool = `${await fs.realpath(filename)}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    const docs = documents.map(doc => ({ path: doc.virtualPath, container: doc.containerPath || null,
      segmentUid: doc.segmentUid || null, segmentStart: doc.segmentStart ?? null, segmentEnd: doc.segmentEnd ?? null,
      language: doc.languageId || null, sourceHash: hash(String(doc.text || '')) }))
      .sort((left, right) => canonicalSemanticJson(left).localeCompare(canonicalSemanticJson(right)));
    throwIfAborted(signal);
    return hash(canonicalSemanticJson({ schemaVersion: 1, docs, files, tool, args, configHash, runtimeConfig,
      observedVersion, environment: createCommandProbeEnvironmentIdentity(process.env) }));
  } catch (error) {
    if (isAbortError(error) || error?.cacheOwnershipPending === true) throw error;
    throwIfAborted(signal);
    return null;
  }
};
