import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { isPathWithinRoot } from '../../../shared/file-paths.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { findWorkspaceMarkersNearPaths } from '../workspace-model.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGES = 4096;
const invalid = message => Object.assign(new Error(message), { code: 'ERR_DART_PACKAGE_CONFIG_INVALID' });
const directoryUrl = url => {
  const result = new URL(url);
  if (!result.pathname.endsWith('/')) result.pathname += '/';
  return result;
};
const packageName = /^[A-Za-z0-9_~!$&'()*+,;=@.-]+$/u;
const uriIdentity = value => {
  const uri = new URL(value);
  if (uri.protocol !== 'file:') return decodeURI(uri.href);
  const filename = path.resolve(fileURLToPath(uri));
  return `file:${process.platform === 'win32' ? filename.toLowerCase() : filename}${path.sep}`;
};

/** Validate the v2 URI model without fetching packages or reading external
 * package roots. Schema validity is distinct from dependency freshness. */
export const parseDartPackageConfig = (value, filename) => {
  if (value && Number.isSafeInteger(value.configVersion) && value.configVersion !== 2) {
    throw Object.assign(new Error(`Unsupported Dart package config version ${value.configVersion}.`), {
      code: 'ERR_DART_PACKAGE_CONFIG_UNSUPPORTED_VERSION'
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.configVersion !== 2
    || !Array.isArray(value.packages) || value.packages.length > MAX_PACKAGES) {
    throw invalid('Expected configVersion 2 and a bounded packages array.');
  }
  const names = new Set(), roots = new Set(), packages = [];
  for (const entry of value.packages) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string'
      || !packageName.test(entry.name) || /^\.+$/u.test(entry.name) || names.has(entry.name)
      || typeof entry.rootUri !== 'string' || entry.rootUri.includes('\\') || entry.rootUri.includes('\0')) {
      throw invalid('Package entries need unique valid names and rootUri strings.');
    }
    let root, packageRoot;
    try {
      root = directoryUrl(new URL(entry.rootUri, pathToFileURL(filename)));
      if (root.search || root.hash || root.username || root.password) throw invalid('Package roots cannot have queries, fragments or credentials.');
      const relative = entry.packageUri === undefined ? '' : entry.packageUri;
      if (typeof relative !== 'string' || /^[A-Za-z][\w+.-]*:/u.test(relative)
        || relative.startsWith('/') || relative.includes('\\') || relative.includes('\0')) throw invalid('packageUri must be a relative URI path.');
      packageRoot = directoryUrl(new URL(relative, root));
      if (packageRoot.search || packageRoot.hash || packageRoot.origin !== root.origin
        || packageRoot.protocol !== root.protocol || !decodeURI(packageRoot.pathname).startsWith(decodeURI(root.pathname))) {
        throw invalid('packageUri must remain inside its package root.');
      }
      if (root.protocol === 'file:') {
        // Validate percent escapes and encoded path separators at the native URI boundary.
        fileURLToPath(root); fileURLToPath(packageRoot);
      }
    } catch (error) { throw invalid(error.message || 'Invalid package URI.'); }
    const identity = uriIdentity(root);
    if (roots.has(identity)) throw invalid('Two packages cannot own the same root URI.');
    if (entry.languageVersion !== undefined && (typeof entry.languageVersion !== 'string'
      || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(entry.languageVersion))) throw invalid('Invalid package languageVersion.');
    names.add(entry.name); roots.add(identity);
    packages.push({ name: entry.name, rootUri: root.href, packageUri: packageRoot.href,
      languageVersion: entry.languageVersion ?? null });
  }
  // Sorted interval ownership avoids pairwise package comparisons. A nested
  // package may exist outside its parent's package: directory, never inside it.
  const sorted = packages.map(entry => ({ entry, root: uriIdentity(entry.rootUri) }))
    .sort((a, b) => a.root < b.root ? -1 : a.root > b.root ? 1 : 0);
  const ancestors = [];
  for (const item of sorted) {
    while (ancestors.length && !item.root.startsWith(ancestors.at(-1).root)) ancestors.pop();
    for (const parent of ancestors) {
      const uri = uriIdentity(parent.entry.packageUri);
      if (item.root.startsWith(uri) || uri.startsWith(item.root)) throw invalid('Package URI directories overlap a nested package.');
    }
    ancestors.push(item);
  }
  return packages;
};

const checkResult = (reason, message, workspace, details = {}) => ({
  state: 'degraded', reasonCode: reason, message,
  checks: [{ name: reason, status: 'warn', message, details: { workspace, ...details } }]
});

export const resolveDartPackageConfigPreflight = async ({ ctx, inputs, abortSignal }) => {
  throwIfAborted(abortSignal);
  const repoRoot = path.resolve(ctx?.repoRoot || process.cwd());
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const markers = findWorkspaceMarkersNearPaths(repoRoot,
    documents.map(doc => doc.containerPath || doc.virtualPath || '').filter(Boolean), { exactNames: ['pubspec.yaml'] });
  const roots = [...new Set(markers.map(marker => marker.markerDirAbs))];
  if (!roots.length) {
    try { await fs.access(path.join(repoRoot, 'pubspec.yaml')); roots.push(repoRoot); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (roots.length > 32) return checkResult('dart_workspace_package_config_budget', 'Dart package-model workspace budget exceeded.', '.');
  const results = [], models = [];
  for (const root of roots) {
    throwIfAborted(abortSignal);
    const workspace = path.relative(repoRoot, root).replaceAll('\\', '/') || '.';
    const filename = path.join(root, '.dart_tool', 'package_config.json');
    let bytes, packages;
    try {
      bytes = (await readVerifiedContainedFile(repoRoot, filename, { maxBytes: MAX_BYTES, signal: abortSignal })).buffer;
      packages = parseDartPackageConfig(JSON.parse(bytes.toString('utf8')), filename);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const reason = error.code === 'ERR_DART_PACKAGE_CONFIG_UNSUPPORTED_VERSION' ? 'unsupported_version'
        : error.code === 'ENOENT' ? 'missing'
          : error.code === 'ERR_FILE_TOO_LARGE' ? 'too_large'
            : error instanceof SyntaxError || error.code === 'ERR_DART_PACKAGE_CONFIG_INVALID' ? 'invalid' : 'unreadable';
      results.push(checkResult(`dart_workspace_package_config_${reason}`,
        `Dart package config ${reason} for ${workspace}: ${error.message}`, workspace));
      continue;
    }
    const missing = [], external = [], remote = [];
    for (const entry of packages) {
      throwIfAborted(abortSignal);
      const packageUri = new URL(entry.rootUri);
      if (packageUri.protocol !== 'file:' || !['', 'localhost'].includes(packageUri.hostname)) { remote.push(entry.name); continue; }
      const packageRoot = fileURLToPath(entry.rootUri);
      if (!isPathWithinRoot(packageRoot, repoRoot)) { external.push(entry.name); continue; }
      try {
        assertNoSymlinkPath(repoRoot, packageRoot);
        if (!(await fs.stat(packageRoot)).isDirectory()) missing.push(entry.name);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) throw error;
        missing.push(entry.name);
      }
    }
    const model = { workspace, packageConfigHash: createHash('sha256').update(bytes).digest('hex'),
      packageCount: packages.length, externalRootsUnobserved: external, remoteRootsUnresolved: remote,
      dependencyClosure: 'unknown' };
    models.push(model);
    if (missing.length || remote.length) results.push(checkResult('dart_workspace_package_config_unresolved',
      `Dart package roots are unavailable or nonlocal for ${workspace}; no dependency resolution was run.`, workspace,
      { missing, remote }));
  }
  const first = results[0];
  const blockProvider = models.some(model => model.remoteRootsUnresolved.length)
    || results.some(result => result.reasonCode === 'dart_workspace_package_config_unsupported_version');
  return { state: blockProvider ? 'blocked' : first?.state || 'ready', blockProvider,
    reasonCode: first?.reasonCode || null, message: first?.message || '',
    packageModels: models, checks: [...results.flatMap(result => result.checks),
      ...models.map(model => ({ name: 'dart_workspace_package_model', status: 'ok',
        message: `Observed ${model.packageCount} Dart package entries for ${model.workspace}; dependency closure remains unverified.`,
        details: model }))] };
};
