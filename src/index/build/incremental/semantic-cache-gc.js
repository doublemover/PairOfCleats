import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { resolveManifestBundleNames } from '../../../shared/bundle-io-paths.js';
import { syncParentDirectory } from '../../../shared/io/persistence-helpers.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { isCompletionBundle } from './file-completion.js';

const HASH = /^[a-f0-9]{64}$/;
const invalid = () => Object.assign(new Error('Incomplete semantic cache cleanup inventory.'), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
const list = async directory => {
  try { return await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

/** Called only after all Stage1 workers drain and the replacement manifest is
 * durable. The manifest pins current Stage2 entries; completion descriptors pin
 * independent Stage1 snapshots and embedded objects. Never run beside writers.
 * Validate the entire mark set and every deletion path before removing anything.
 */
export const pruneSemanticCache = async ({ bundleDir, manifest, diskAccount = null, signal = null }) => {
  throwIfAborted(signal);
  if (manifest?.semanticEnabled !== true) return { removedFiles: 0, removedBytes: 0 };
  const completions = new Set(), bundles = new Set(), objects = new Set();
  const mark = entry => {
    for (const name of resolveManifestBundleNames(entry)) {
      if (path.basename(name) !== name) throw invalid();
      bundles.add(name); bundles.add(name + '.checksum.json');
    }
    for (const locator of [entry.semanticCache, ...(entry.semanticSegmentCaches || []).map(row => row.locator)]) {
      if (!HASH.test(locator?.cacheKey)) throw invalid();
      objects.add(locator.cacheKey);
    }
  };
  // Unknown/missing pinned descriptors are not evidence that their objects are
  // garbage. Fail closed without preventing the successful build from finishing.
  try {
    for (const entry of Object.values(manifest.files || {})) {
      throwIfAborted(signal);
      if (!HASH.test(entry.completionKey)) throw invalid();
      mark(entry);
      const name = entry.completionKey + '.json';
      const filename = await resolveSemanticPartPath(bundleDir, 'completions/' + name);
      if ((await fs.stat(filename)).size > 16 * 1024 * 1024) throw invalid();
      const envelope = JSON.parse(await fs.readFile(filename, 'utf8'));
      const descriptor = envelope.descriptor;
      if (envelope.schemaVersion !== 1 || descriptor?.identity?.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
        || semanticHash('pairofcleats.stage1.completion.v1', descriptor.identity) !== entry.completionKey
        || createHash('sha256').update(canonicalSemanticJson(descriptor)).digest('hex') !== envelope.hash) throw invalid();
      mark(descriptor.manifestEntry);
      completions.add(name);
    }
  } catch (error) {
    if (['ENOENT', 'ERR_SEMANTIC_CACHE_INTEGRITY', 'ERR_SEMANTIC_INTEGRITY'].includes(error.code)
      || error instanceof SyntaxError || error instanceof TypeError) {
      return { removedFiles: 0, removedBytes: 0, deferred: 'incomplete_inventory' };
    }
    throw error;
  }
  const candidates = [];
  for (const entry of await list(path.join(bundleDir, 'completions'))) {
    if (/^[a-f0-9]{64}\.json$/.test(entry.name) && !completions.has(entry.name)) candidates.push('completions/' + entry.name);
  }
  for (const entry of await list(bundleDir)) {
    if (isCompletionBundle(entry.name) && !bundles.has(entry.name)) candidates.push(entry.name);
  }
  for (const entry of await list(path.join(bundleDir, 'semantic'))) {
    if ((HASH.test(entry.name) && !objects.has(entry.name))
      || /^\.(pending|corrupt|incomplete)-[a-zA-Z0-9-]+$/.test(entry.name)) candidates.push('semantic/' + entry.name);
  }
  const files = [], directories = [];
  const absoluteRoot = await fs.realpath(bundleDir);
  const scan = async relative => {
    throwIfAborted(signal);
    // The reader resolves safe in-root links, but a collector must never follow
    // even an in-root link into a different, possibly pinned object.
    let filename = absoluteRoot;
    for (const component of relative.split('/')) {
      filename = path.join(filename, component);
      if ((await fs.lstat(filename)).isSymbolicLink()) throw invalid();
    }
    await resolveSemanticPartPath(bundleDir, relative);
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) throw invalid();
    if (stat.isDirectory()) {
      for (const entry of await list(filename)) await scan(relative + '/' + entry.name);
      directories.push(filename);
    } else if (stat.isFile()) files.push(filename);
    else throw invalid();
  };
  for (const relative of candidates) await scan(relative);
  let removedBytes = 0, removedFiles = 0;
  // Descriptors are removed before their unreferenced objects, so interruption
  // leaves extra garbage, never a descriptor whose formerly pinned data vanished.
  for (const filename of files) {
    throwIfAborted(signal);
    const stat = await fs.lstat(filename);
    await fs.unlink(filename);
    await syncParentDirectory(filename);
    removedFiles += 1;
    if (stat.nlink === 1) {
      removedBytes += stat.size;
      diskAccount?.release(stat.size);
    }
  }
  for (const directory of directories) await fs.rmdir(directory);
  return { removedFiles, removedBytes };
};
