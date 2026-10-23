import path from 'node:path';
import { sha1 } from '../../../shared/hash.js';

const URL_LIKE = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const SOURCE_NAME = /(?:^|\/)(?:BUILD|BUILD\.bazel|MODULE\.bazel|WORKSPACE(?:\.bazel)?)$|\.(?:bzl|star|bazel)$/;
export const isBazelSourceFile = value => SOURCE_NAME.test(value);
const SIMPLE_PATH = /^[A-Za-z0-9_.+~/-]*$/;
const MAX_PACKAGES = 4096, MAX_REFERENCES = 100000;
const normalSegments = (value, { root = false, packageName = false } = {}) => {
  if (!value) return root;
  return !value.split('/').some(part => !part || part === '.' || part === '..' || packageName && /^\.+$/.test(part));
};

/** Lexical admission precedes path normalization. Unsupported valid forms are
 * distinct from malformed segments and never become guessed file paths.
 */
export const admitBazelLabel = (rawLabel, { importerRel = '' } = {}) => {
  if (typeof rawLabel !== 'string') return { state: 'not-label' };
  const bazelSource = SOURCE_NAME.test(importerRel), recognized = rawLabel.trim();
  if (!/^(?:\/\/|:|@)/.test(recognized) || !bazelSource && URL_LIKE.test(recognized)
    || !bazelSource && recognized.startsWith('@') && !recognized.includes('//')) return { state: 'not-label' };
  const result = { rawLabel, label: rawLabel, repositoryMapping: 'local', repo: null, kind: 'workspace',
    package: '', target: '', targetOrigin: 'explicit', labelRole: 'configured-target' };
  const reject = (state, reason) => ({ ...result, state, reason });
  if (rawLabel !== rawLabel.trim() || /[\\\0\r\n]/.test(rawLabel) || rawLabel.length > 4096) return reject('malformed', 'label_shape');
  let body = rawLabel;
  if (body.startsWith('@@')) {
    result.repositoryMapping = 'canonical-unavailable'; result.kind = 'external';
    return reject('unsupported', 'canonical_repository_mapping_unavailable');
  }
  if (body.startsWith('@')) {
    result.kind = 'external'; result.repositoryMapping = 'apparent-unavailable';
    const separator = body.indexOf('//'), repository = separator < 0 ? body.slice(1) : body.slice(1, separator);
    if (!/^[A-Za-z0-9_.+~-]+$/.test(repository)) return reject('unsupported', 'repository_spelling_unsupported');
    result.repo = repository; body = separator < 0 ? '' : body.slice(separator);
  }
  if (body.startsWith(':')) {
    result.kind = 'local'; result.package = path.posix.dirname(importerRel) === '.' ? '' : path.posix.dirname(importerRel);
    result.target = body.slice(1);
  } else if (body.startsWith('//')) {
    const colon = body.indexOf(':', 2);
    result.package = colon < 0 ? body.slice(2) : body.slice(2, colon);
    result.targetOrigin = colon < 0 ? 'default' : 'explicit';
    result.target = colon < 0 ? result.package.split('/').at(-1) || '' : body.slice(colon + 1);
  } else if (result.repo) {
    result.targetOrigin = 'default'; result.target = result.repo;
  } else return reject('malformed', 'label_prefix');
  if (!normalSegments(result.package, { root: true, packageName: true }) || !normalSegments(result.target)) {
    return reject('malformed', 'non_normal_segments');
  }
  if (!SIMPLE_PATH.test(result.package) || !SIMPLE_PATH.test(result.target)) return reject('unsupported', 'label_punctuation_unsupported');
  result.labelRole = result.target.endsWith('.bzl') ? 'literal-file' : 'configured-target';
  return { ...result, state: 'accepted', reason: null };
};

/** One context owns immutable BUILD observations, exact target membership and
 * the package prefix cache. Classification performs no new I/O or entry scans.
 * A filtered entry set alone can prove a BUILD witness present, never absent.
 */
export const createBazelPackageIndex = ({ entries = [], references = null, rootAbs = '', fsMemo = null,
  caseSensitive = true, resolveTarget = null } = {}) => {
  const files = new Set(), relevant = [], directories = new Set(), packages = new Map();
  const key = value => caseSensitive ? value : value.toLowerCase();
  const stats = { entriesVisited: 0, referencesVisited: 0, metadataProbes: 0, classifications: 0 };
  let exhausted = false;
  const addParents = directory => {
    let current = directory;
    for (let depth = 0; depth < 128; depth++) {
      if (!directories.has(key(current)) && directories.size === MAX_PACKAGES) { exhausted = true; return; }
      directories.add(key(current));
      if (!current) return;
      current = path.posix.dirname(current); if (current === '.') current = '';
    }
    exhausted = true;
  };
  for (const entry of entries) {
    stats.entriesVisited++;
    const rel = typeof entry === 'string' ? entry : entry?.rel;
    if (typeof rel !== 'string' || !normalSegments(rel) || /[\\\0\r\n]/.test(rel) || /^[A-Za-z]:/.test(rel)) continue;
    if (/\.bzl$/i.test(rel)) files.add(rel);
    if (!SOURCE_NAME.test(rel)) continue;
    relevant.push(rel);
  }
  relevant.sort();
  for (const rel of relevant) { const directory = path.posix.dirname(rel); addParents(directory === '.' ? '' : directory); }
  const localReferences = [], referenceRows = [];
  const sourceReferences = references instanceof Map ? [...references] : Object.entries(references || {});
  const referenceCount = sourceReferences.reduce((sum, [, values]) => sum + (Array.isArray(values) ? values.length : values instanceof Set ? values.size : 0), 0);
  if (referenceCount > MAX_REFERENCES) exhausted = true;
  else for (const [importerRel, values] of sourceReferences) {
    for (const value of Array.isArray(values) || values instanceof Set ? values : []) {
      stats.referencesVisited++;
      const label = admitBazelLabel(typeof value === 'string' ? value : value?.specifier, { importerRel });
      if (label.state === 'accepted' && !label.repo) referenceRows.push({ label, importerRel });
    }
  }
  referenceRows.sort((a, b) => a.label.rawLabel < b.label.rawLabel ? -1 : a.label.rawLabel > b.label.rawLabel ? 1
    : a.importerRel < b.importerRel ? -1 : a.importerRel > b.importerRel ? 1 : 0);
  for (const { label, importerRel } of referenceRows) {
    if (label.kind === 'local') { addParents(label.package); localReferences.push({ label, importerRel }); }
    else {
      addParents(label.package);
      if (label.labelRole === 'literal-file') addParents(path.posix.dirname(path.posix.join(label.package, label.target)).replace(/^\.$/, ''));
    }
  }
  const indexedBuilds = new Set(relevant.filter(file => ['BUILD', 'BUILD.bazel'].includes(path.posix.basename(file))).map(key));
  const observePackages = () => {
    for (const directory of directories) {
      if (packages.has(directory)) continue;
      const witnesses = [];
      for (const basename of ['BUILD.bazel', 'BUILD']) {
        const rel = directory ? directory + '/' + basename : basename;
        if (!rootAbs || typeof fsMemo?.statProbeSync !== 'function') {
          witnesses.push({ path: rel, state: indexedBuilds.has(key(rel)) ? 'present' : 'unknown',
            source: indexedBuilds.has(key(rel)) ? 'indexed-build' : 'filtered-inventory' });
          continue;
        }
        stats.metadataProbes++;
        const probe = fsMemo.statProbeSync(path.join(rootAbs, rel));
        witnesses.push({ path: rel, source: 'owned-metadata', state: probe.state === 'missing' ? 'missing'
          : probe.state === 'present' && probe.stat?.isFile === true ? 'present'
            : probe.state === 'present' && probe.stat?.isFile === false ? 'not-file' : 'unknown',
        ...(probe.stat ? { size: probe.stat.size, mtimeMs: probe.stat.mtimeMs } : {}), errorCode: probe.errorCode || null });
      }
      const state = witnesses.some(row => row.state === 'present') ? 'present'
        : witnesses.every(row => row.state === 'missing' || row.state === 'not-file') ? 'missing' : 'unknown';
      packages.set(directory, Object.freeze({ state, witnesses: Object.freeze(witnesses.map(Object.freeze)) }));
    }
  };
  const packageAt = directory => packages.get(key(directory)) || { state: 'unknown', witnesses: [] };
  const importerPackage = importer => {
    let directory = path.posix.dirname(importer); if (directory === '.') directory = '';
    for (let depth = 0; depth < 128; depth++) {
      const observation = packageAt(directory);
      if (observation.state === 'present') return { state: 'present', directory };
      if (observation.state === 'unknown') return { state: 'unknown', directory };
      if (!directory) return { state: 'missing', directory };
      directory = path.posix.dirname(directory); if (directory === '.') directory = '';
    }
    return { state: 'unknown', directory };
  };
  observePackages();
  for (const { label, importerRel } of localReferences) {
    const owner = importerPackage(importerRel);
    if (owner.state === 'present' && label.labelRole === 'literal-file') {
      addParents(path.posix.dirname(path.posix.join(owner.directory, label.target)).replace(/^\.$/, ''));
    }
  }
  observePackages();
  const fingerprint = sha1(JSON.stringify({ version: 3, files: relevant, caseSensitive, exhausted,
    packages: [...packages].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) }));
  const classify = (rawLabel, { importerRel = '' } = {}) => {
    stats.classifications++;
    const label = admitBazelLabel(rawLabel, { importerRel });
    if (label.state !== 'accepted') return { ...label, packageExists: null, targetExists: null, candidates: [] };
    if (label.repo) return { ...label, state: 'repository-unavailable', packageExists: null, targetExists: null, candidates: [] };
    const owner = label.kind === 'local' ? importerPackage(importerRel) : { ...packageAt(label.package), directory: label.package };
    const packageRel = owner.directory, base = { ...label, packageRel, targetRel: label.target, candidates: [],
      packageExists: owner.state === 'present' ? true : owner.state === 'missing' ? false : null,
      packageWitnesses: packageAt(packageRel).witnesses, targetExists: null, targetScope: 'admitted-file-inventory' };
    if (owner.state !== 'present') return { ...base, state: owner.state === 'missing' ? 'package-missing' : 'package-unknown' };
    if (label.labelRole !== 'literal-file') return { ...base, state: 'configured-target-unsupported' };
    const candidate = packageRel ? packageRel + '/' + label.target : label.target;
    let directory = path.posix.dirname(candidate); if (directory === '.') directory = '';
    for (let depth = 0; key(directory) !== key(packageRel); depth++) {
      if (depth === 128 || !directory) return { ...base, state: 'package-unknown', candidates: [candidate] };
      const nested = packageAt(directory);
      if (nested.state === 'present') return { ...base, state: 'target-package-mismatch', targetExists: false, candidates: [candidate] };
      if (nested.state === 'unknown') return { ...base, state: 'package-unknown', candidates: [candidate] };
      directory = path.posix.dirname(directory); if (directory === '.') directory = '';
    }
    const selected = resolveTarget ? resolveTarget(candidate) : files.has(candidate) ? candidate : null;
    const target = selected && files.has(selected) ? selected : null;
    return { ...base, state: target ? 'resolved' : 'target-missing', candidates: [candidate], targetExists: Boolean(target), resolvedPath: target };
  };
  return Object.freeze({ classify, fingerprint, getStats: () => Object.freeze({ ...stats, preparedPackages: packages.size, exhausted }) });
};

const lookupIndexes = new WeakMap();
export const getBazelPackageIndexForLookup = lookup => {
  if (!lookupIndexes.has(lookup)) lookupIndexes.set(lookup, createBazelPackageIndex({ entries: lookup.fileSet || [],
    caseSensitive: lookup.caseSensitive !== false,
    resolveTarget: candidate => lookup.fileSet?.has(candidate) ? candidate
      : lookup.caseSensitive === false ? lookup.fileLower?.get(candidate.toLowerCase()) || null : null }));
  return lookupIndexes.get(lookup);
};
