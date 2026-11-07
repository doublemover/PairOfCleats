import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'ERR_NATIVE_DATABASE_DELEGATED_SCOPE' }); };

export const assertDelegatedNativeCommandIdentity = (owner, commandId) => {
  if (!owner || owner.settled) fail('Delegated native owner is missing or already settled.');
  const entry = fs.realpathSync(process.argv[1]);
  const source = readVerifiedContainedFileSync(path.dirname(entry), entry, { maxBytes: 1024 * 1024 });
  const expected = createHash('sha256').update(stableStringify({ commandId, entry,
    sha256: source.hash, args: process.argv.slice(2) })).digest('hex');
  if (owner.commandIdentity !== expected) fail('Canonical entry bytes or arguments differ from the reviewed delegated command.');
};

/** Admission observes current effective configuration in the admitted child,
 * after the pre-entry gate, before any database is opened. Ordinary CLI callers
 * retain their existing explicit-path behavior.
 */
export const assertDelegatedNativeDatabaseScope = (owner, { commandId, repoCacheRoot, indexRoot, userConfig, targets }) => {
  if (!owner || owner.settled || !['sqlite.compact', 'lmdb.build'].includes(commandId)) fail('A current canonical delegated owner is required.');
  if (typeof repoCacheRoot !== 'string' || !path.isAbsolute(repoCacheRoot)
    || !isPathWithinRoot(repoCacheRoot, owner.root) || !isPathWithinRoot(owner.root, repoCacheRoot)) {
    fail('Effective repository cache root differs from the admitted delegated root.');
  }
  const config = commandId === 'sqlite.compact' ? userConfig?.sqlite : userConfig?.lmdb;
  const fields = ['dbDir', 'codeDbPath', 'proseDbPath', 'extractedProseDbPath', 'recordsDbPath'];
  if (fields.some(key => config?.[key] != null && config[key] !== '')) {
    fail('Delegated native commands require canonical backend paths without configuration overrides.');
  }
  if (typeof indexRoot !== 'string' || !path.isAbsolute(indexRoot)
    || !isPathWithinRoot(indexRoot, owner.root) || isPathWithinRoot(owner.root, indexRoot)) {
    fail('Delegated native command needs an explicit contained generation root.');
  }
  if (!Array.isArray(targets) || !targets.length || targets.length > 2) fail('Exact selected backend targets are required.');
  assertNoSymlinkPath(path.parse(owner.root).root, owner.root);
  assertNoSymlinkPath(owner.root, indexRoot);
  for (const target of targets) {
    if (typeof target !== 'string' || !path.isAbsolute(target)
      || !isPathWithinRoot(target, indexRoot) || isPathWithinRoot(indexRoot, target)) {
      fail('Selected backend target is outside the reviewed generation.');
    }
    assertNoSymlinkPath(owner.root, target, { allowMissing: true });
  }
};
