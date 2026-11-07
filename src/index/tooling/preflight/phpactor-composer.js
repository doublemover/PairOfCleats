import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { isPathWithinRoot } from '../../../shared/file-paths.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { findWorkspaceMarkersNearPaths } from '../workspace-model.js';

const MAX_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textList = value => Array.isArray(value) && value.every(part => typeof part === 'string' && !part.includes('\0'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = message => Object.assign(new Error(message), { code: 'ERR_COMPOSER_MANIFEST_INVALID' });

/** Inspect only supported Composer schema fields. Unknown fields are retained
 * by Composer, not evaluated here; this is not dependency solving or a claim of
 * autoloader/build freshness. */
export const inspectComposerManifest = value => {
  if (!object(value)) throw invalid('Composer manifest must be a JSON object.');
  for (const name of ['require', 'require-dev']) {
    if (value[name] !== undefined && (!object(value[name])
      || Object.values(value[name]).some(version => typeof version !== 'string'))) throw invalid(`${name} must map packages to version constraints.`);
  }
  const autoloadPaths = [];
  for (const name of ['autoload', 'autoload-dev']) {
    const section = value[name];
    if (section === undefined) continue;
    if (!object(section)) throw invalid(`${name} must be an object.`);
    for (const kind of ['psr-0', 'psr-4']) {
      const mapping = section[kind];
      if (mapping === undefined) continue;
      if (!object(mapping)) throw invalid(`${name}.${kind} must map namespaces to paths.`);
      for (const [namespace, paths] of Object.entries(mapping)) {
        const values = typeof paths === 'string' ? [paths] : paths;
        if (!textList(values)) throw invalid(`${name}.${kind} has an invalid path list.`);
        for (const filename of values) autoloadPaths.push({ section: name, kind, namespace, path: filename });
      }
    }
    for (const kind of ['files', 'classmap', 'exclude-from-classmap']) {
      const values = section[kind];
      if (values === undefined) continue;
      if (!textList(values)) throw invalid(`${name}.${kind} must be a path array.`);
      for (const filename of values) autoloadPaths.push({ section: name, kind, path: filename });
    }
  }
  if (value.config !== undefined && !object(value.config)) throw invalid('Composer config must be an object.');
  const vendorDir = value.config && Object.hasOwn(value.config, 'vendor-dir') ? value.config['vendor-dir'] : 'vendor';
  if (typeof vendorDir !== 'string' || !vendorDir || vendorDir.includes('\0')) throw invalid('Composer vendor-dir must be a path string.');
  return { vendorDir, autoloadPathCount: autoloadPaths.length,
    autoloadPaths: autoloadPaths.slice(0, 256), autoloadPathsTruncated: autoloadPaths.length > 256 };
};

const readJson = async (repoRoot, filename, signal) => {
  const bytes = (await readVerifiedContainedFile(repoRoot, filename, { maxBytes: MAX_BYTES, signal })).buffer;
  return { value: JSON.parse(bytes.toString('utf8')), hash: sha256(bytes) };
};

export const resolvePhpactorComposerPreflight = async ({ ctx, inputs, abortSignal }) => {
  throwIfAborted(abortSignal);
  const repoRoot = path.resolve(ctx?.repoRoot || process.cwd());
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const matches = findWorkspaceMarkersNearPaths(repoRoot,
    documents.map(doc => doc.containerPath || doc.virtualPath || '').filter(Boolean), { exactNames: ['composer.json'] });
  const roots = [...new Set(matches.map(match => match.markerDirAbs))];
  if (!roots.length) {
    try { await fs.access(path.join(repoRoot, 'composer.json')); roots.push(repoRoot); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const checks = [], models = [];
  const warn = (reason, message, workspace) => checks.push({ name: reason, status: 'warn', message, details: { workspace } });
  if (roots.length > 32) return { state: 'blocked', blockProvider: true, reasonCode: 'phpactor_workspace_budget',
    checks: [{ name: 'phpactor_workspace_budget', status: 'warn', message: 'Composer workspace admission budget exceeded.' }] };
  for (const root of roots) {
    throwIfAborted(abortSignal);
    const workspace = path.relative(repoRoot, root).replaceAll('\\', '/') || '.';
    let manifest, inventory;
    try {
      manifest = await readJson(repoRoot, path.join(root, 'composer.json'), abortSignal);
      inventory = inspectComposerManifest(manifest.value);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const kind = error.code === 'ERR_FILE_TOO_LARGE' ? 'too_large'
        : error instanceof SyntaxError || error.code === 'ERR_COMPOSER_MANIFEST_INVALID' ? 'invalid' : 'unreadable';
      warn(`phpactor_workspace_composer_${kind}`, `Composer manifest ${kind} for ${workspace}: ${error.message}`, workspace);
      continue;
    }
    let lockHash = null, dependencyCount = null;
    try {
      const lock = await readJson(repoRoot, path.join(root, 'composer.lock'), abortSignal);
      if (!object(lock.value) || !Array.isArray(lock.value.packages)
        || (lock.value['packages-dev'] !== undefined && !Array.isArray(lock.value['packages-dev']))) throw invalid('Composer lock packages must be arrays.');
      const dependencies = [...lock.value.packages, ...(lock.value['packages-dev'] || [])];
      if (dependencies.some(entry => !object(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string')) throw invalid('Composer lock package identities are incomplete.');
      dependencyCount = dependencies.length;
      lockHash = lock.hash;
    } catch (error) {
      if (isAbortError(error)) throw error;
      const kind = error.code === 'ENOENT' ? 'missing' : error.code === 'ERR_FILE_TOO_LARGE' ? 'too_large'
        : error instanceof SyntaxError || error.code === 'ERR_COMPOSER_MANIFEST_INVALID' ? 'invalid' : 'unreadable';
      warn(`phpactor_workspace_composer_lock_${kind}`, `Composer lock ${kind} for ${workspace}; dependency state remains incomplete.`, workspace);
    }
    const vendorRoot = path.resolve(root, inventory.vendorDir);
    let autoloaderState = 'unobserved';
    if (!isPathWithinRoot(vendorRoot, repoRoot)) {
      warn('phpactor_workspace_external_vendor_unobserved', `Composer vendor directory for ${workspace} is outside the admitted repository; its contents were not inspected.`, workspace);
    } else {
      try {
        const filename = path.join(vendorRoot, 'autoload.php');
        assertNoSymlinkPath(repoRoot, filename);
        autoloaderState = (await fs.stat(filename)).isFile() ? 'present_unverified' : 'unavailable';
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) throw error;
        autoloaderState = 'unavailable';
      }
      if (autoloaderState === 'unavailable') warn('phpactor_workspace_composer_autoload_missing',
        `Composer autoloader is unavailable for ${workspace}; no Composer operation was run.`, workspace);
    }
    const model = { workspace, manifestHash: manifest.hash, lockHash, dependencyCount,
      ...inventory, autoloaderState, dependencyClosure: 'unknown' };
    models.push(model);
    checks.push({ name: 'phpactor_workspace_composer_model', status: 'ok',
      message: `Observed Composer configuration for ${workspace}; generated autoloader and dependency freshness remain unverified.`, details: model });
  }
  const warning = checks.find(check => check.status === 'warn');
  return { state: warning ? 'degraded' : 'ready', reasonCode: warning?.name || null, message: warning?.message || '',
    checks, composerModels: models };
};
