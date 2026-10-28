import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolvePath } from '../repo-paths.js';
import { getApplicationHome } from '../cache-roots.js';
import { acquireStorageSession } from './session.js';
import { readStorageLocator } from './locator-read.js';
import { stableStringify } from '../stable-json.js';

const modes = Object.freeze({ sqlite: { code: ['codeDbPath', 'index-code.db'], prose: ['proseDbPath', 'index-prose.db'],
  'extracted-prose': ['extractedProseDbPath', 'index-extracted-prose.db'], records: ['recordsDbPath', 'index-records.db'] },
lmdb: { code: ['codeDbPath', 'index-code'], prose: ['proseDbPath', 'index-prose'] } });
const identity = target => process.platform === 'win32' ? path.resolve(target).toLowerCase() : path.resolve(target);
const fingerprint = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const selectionFailure = () => Object.assign(new Error('Configured native reader selection changed or is not an eligible storage namespace.'), {
  code: 'ERR_INDEX_STORAGE_SELECTION'
});
const configuredPath = (repoRoot, value) => typeof value === 'string' && value.length > 0 ? resolvePath(repoRoot, value) : null;

/** Reading authority comes from the effective backend configuration, never the
 * target's filename, a marker or a filesystem parent. This grants no deletion,
 * publication or claim that the selected bytes have a qualified generation. */
export const resolveConfiguredNativeReaderSelection = (target, context) => {
  const backend = context.nativeBackend, definitions = typeof backend === 'string' && Object.hasOwn(modes, backend) ? modes[backend] : null;
  if (!definitions) return null;
  const config = context.userConfig[backend];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const directory = configuredPath(context.repoRoot, config.dbDir);
  const candidates = context.nativeMode === undefined ? Object.entries(definitions)
    : Object.hasOwn(definitions, context.nativeMode) ? [[context.nativeMode, definitions[context.nativeMode]]] : [];
  for (const [mode, [key, basename]] of candidates) {
    const direct = configuredPath(context.repoRoot, config[key]);
    const selected = direct || (directory ? path.join(directory, basename) : null);
    if (!selected || identity(selected) !== identity(target)) continue;
    const namespace = backend === 'sqlite' ? path.dirname(selected) : selected;
    if (identity(namespace) === identity(path.parse(namespace).root)) return null;
    const publication = context.nativePublicationIdentity;
    if (publication !== undefined && publication !== null && (typeof publication !== 'string' || publication.length > 65536)) throw selectionFailure();
    return Object.freeze({ schemaVersion: 1, backend, mode, target: path.resolve(selected), namespace: path.resolve(namespace),
      sourceSetting: `${backend}.${direct ? key : 'dbDir'}`, producer: `pairofcleats-${backend}-reader-v1`,
      publicationIdentitySha256: typeof publication === 'string' ? fingerprint(publication) : null,
      publicationStatus: typeof publication === 'string' ? 'caller-generation-identity' : 'unattested', deletionAuthority: false });
  }
  return null;
};

export const acquireConfiguredNativeReaderSession = (target, context) => {
  const selection = resolveConfiguredNativeReaderSelection(target, context);
  if (!selection) return null;
  const launchEnv = { ...(context.env || process.env) };
  const home = getApplicationHome({ env: launchEnv }), state = path.join(home, 'state');
  const locate = () => {
    const locator = readStorageLocator(home);
    if (locator.status === 'invalid') throw selectionFailure();
    return locator;
  };
  const before = locate(), selectedFingerprint = fingerprint(selection);
  const roots = selection.backend === 'sqlite' ? [selection.target, `${selection.target}-wal`, `${selection.target}-shm`, `${selection.target}-journal`]
    : [selection.target];
  const session = acquireStorageSession({ roots, authorizedRoots: [selection.namespace, state],
    coordinationRoot: path.join(state, 'storage-access'), scope: `configured-${selection.backend}-reader` });
  return { session, selection, revalidate: () => {
    const current = locate(), selected = resolveConfiguredNativeReaderSelection(target, context);
    if (!selected || fingerprint(selected) !== selectedFingerprint || current.status !== before.status || current.sha256 !== before.sha256) throw selectionFailure();
  } };
};
