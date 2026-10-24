import fsSync from 'node:fs';
import path from 'node:path';
import { resolveEnvPath } from '../../shared/env-path.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';

const WINDOWS_EXTENSIONS = new Set(['.exe', '.cmd', '.bat']);
const MAX_CANDIDATES = 4096, MAX_DIAGNOSTICS = 64;
const explicitPath = name => path.isAbsolute(name) || /[\\/]/.test(name);

export const candidateNames = name => {
  if (process.platform !== 'win32' || WINDOWS_EXTENSIONS.has(path.extname(name).toLowerCase())) return [name];
  return [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name];
};

export const splitPathEntries = (envPath = resolveEnvPath(process.env)) => (
  String(envPath || '').split(path.delimiter).map(entry => entry.trim()).filter(Boolean)
);

/** Advisory eligibility, scoped to one resolution attempt. No access observation
 * proves a later launch succeeds; policy and actual process ownership stay with
 * the existing launch owner. No long-lived eligibility cache is used.
 */
export const createBinaryDiscovery = ({ cwd = process.cwd() } = {}) => {
  const cache = new Map(), diagnostics = [];
  let selected = null, unknownCandidates = 0, knownMissingCandidates = 0, ineligibleCandidates = 0;
  let omittedObservations = 0, exhausted = false, pathSearchState = null;
  const inspect = filename => {
    let kind = 'unknown';
    try {
      const link = fsSync.lstatSync(filename, { bigint: true });
      kind = link.isSymbolicLink() ? 'symlink' : link.isFile() ? 'file' : link.isDirectory() ? 'directory' : 'other';
      const stat = kind === 'symlink' ? fsSync.statSync(filename, { bigint: true }) : link;
      if (!stat.isFile()) return { eligible: false, pathKind: kind, targetKind: stat.isDirectory() ? 'directory' : 'other', reason: 'not-file' };
      const extension = path.extname(filename).toLowerCase();
      const launchKind = process.platform === 'win32'
        ? extension === '.cmd' || extension === '.bat' ? 'windows-cmd' : extension === '.exe' ? 'windows-native' : null
        : 'posix-executable';
      if (!launchKind) return { eligible: false, unknown: true, pathKind: kind, targetKind: 'file', reason: 'unsupported-launch-kind' };
      if (process.platform !== 'win32') {
        try { fsSync.accessSync(filename, fsSync.constants.X_OK); }
        catch (error) {
          const diagnostic = describeStorageFailure(error, { phase: 'tooling-binary-execute-access' });
          if (!['EACCES', 'EPERM'].includes(diagnostic.code)) throw error;
          return { eligible: false, pathKind: kind, targetKind: 'file', launchKind, reason: 'not-executable' };
        }
      }
      return { eligible: true, pathKind: kind, targetKind: 'file', launchKind, reason: 'eligible',
        targetPath: fsSync.realpathSync(filename), identity: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino),
          size: String(stat.size), mtimeNs: String(stat.mtimeNs), mode: String(stat.mode) }) };
    } catch (error) {
      const diagnostic = describeStorageFailure(error, { phase: 'tooling-binary-discovery' });
      const missing = diagnostic.code === 'ENOENT' || diagnostic.code === 'ENOTDIR';
      return { eligible: false, unknown: !missing, pathKind: kind, targetKind: missing ? 'missing' : 'unknown',
        reason: missing ? kind === 'symlink' ? 'broken-link' : 'not-found' : 'inaccessible-or-unknown',
        errorCode: diagnostic.code.slice(0, 64) };
    }
  };
  const observe = (filename, origin = 'explicit', order = 0) => {
    const absolute = path.resolve(cwd, filename), key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    let observation = cache.get(key);
    if (!observation) {
      if (cache.size === MAX_CANDIDATES) {
        exhausted = true;
        return Object.freeze({ path: filename, origin, order, eligible: false, unknown: true, reason: 'candidate-budget' });
      }
      observation = Object.freeze({ ...inspect(absolute), path: filename, absolutePath: absolute, origin, order });
      cache.set(key, observation);
      if (observation.unknown) unknownCandidates++;
      else if (observation.reason === 'not-found') knownMissingCandidates++;
      else if (!observation.eligible) ineligibleCandidates++;
      if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(observation); else omittedObservations++;
    }
    return observation;
  };
  const findInDirs = (name, dirs = [], origin = 'scoped') => {
    selected = null;
    if (explicitPath(name)) {
      const observation = observe(name);
      if (observation.eligible) { selected = observation; return name; }
      return null;
    }
    let order = 0;
    for (const dir of dirs) {
      for (const candidate of candidateNames(name)) {
        const filename = path.join(dir, candidate), observation = observe(filename, origin, order++);
        if (observation.eligible) { selected = observation; return filename; }
        if (exhausted) return null;
      }
    }
    return null;
  };
  return Object.freeze({ observe, findInDirs,
    select(filename) { const observation = observe(filename, 'resolved'); selected = observation.eligible ? observation : null; return observation; },
    denySelected(filename) { selected = Object.freeze({ ...observe(filename), eligible: false, reason: 'policy-denied' }); },
    findOnPath(name, envPath = resolveEnvPath(process.env)) {
      const directories = splitPathEntries(envPath); pathSearchState = directories.length ? 'provided' : 'empty';
      return findInDirs(name, directories, 'PATH');
    },
    getReceipt: () => Object.freeze({ scope: 'requested-search', status: selected ? selected.reason === 'policy-denied' ? 'policy-denied' : 'eligible'
      : unknownCandidates || exhausted || pathSearchState === 'empty' || cache.size === 0 ? 'unknown' : 'no-eligible-candidate',
    selected, pathSearchState, examinedCandidates: cache.size, unknownCandidates, knownMissingCandidates, ineligibleCandidates, exhausted, omittedObservations,
    observations: Object.freeze([...diagnostics]) }) });
};

export const findBinaryInDirs = (name, dirs = []) => createBinaryDiscovery().findInDirs(name, dirs);
export const findBinaryOnPath = (name, envPath = resolveEnvPath(process.env)) => createBinaryDiscovery().findOnPath(name, envPath);

/** Selection classification uses full bounded counters, never a truncated
 * diagnostic prefix as proof that every candidate was absent.
 */
export const classifyBinaryDiscoverySelection = (observation, receipt) => {
  if (observation?.eligible) return null;
  if (observation?.reason === 'not-found' || !observation && receipt.status === 'no-eligible-candidate'
    && receipt.examinedCandidates > 0 && receipt.knownMissingCandidates === receipt.examinedCandidates) return 'not-found';
  if (observation?.unknown || !observation && receipt.status === 'unknown') return 'unknown';
  return 'ineligible';
};
