import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertDelegatedNativeDatabaseScope } from '../../../tools/shared/native-database-authority.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-native-scope-'));
try {
  const indexRoot = path.join(root, 'builds', 'generation-a');
  const targets = [path.join(indexRoot, 'index-sqlite', 'index-code.db')];
  await fs.mkdir(indexRoot, { recursive: true });
  // This pure scope validator grants no IPC/delegated capability. The actual
  // command owner supplies its authenticated record before native open.
  const owner = { root, settled: false };
  const scope = { commandId: 'sqlite.compact', repoCacheRoot: root, indexRoot,
    userConfig: {}, targets };
  assert.doesNotThrow(() => assertDelegatedNativeDatabaseScope(owner, scope));
  for (const patch of [
    { repoCacheRoot: path.join(root, 'other-repo') },
    { repoCacheRoot: path.dirname(root) },
    { indexRoot: null }, { indexRoot: root }, { indexRoot: path.dirname(root) },
    { targets: [] }, { targets: [path.join(root, 'other-generation.db')] },
    { targets: [indexRoot] }, { targets: [path.join(root, '..', 'escaped.db')] },
    { commandId: 'unreviewed' }
  ]) {
    assert.throws(() => assertDelegatedNativeDatabaseScope(owner, { ...scope, ...patch }),
      { code: 'ERR_NATIVE_DATABASE_DELEGATED_SCOPE' });
  }
  for (const key of ['dbDir', 'codeDbPath', 'proseDbPath', 'recordsDbPath', 'extractedProseDbPath']) {
    assert.throws(() => assertDelegatedNativeDatabaseScope(owner,
      { ...scope, userConfig: { sqlite: { [key]: path.join(root, 'retarget') } } }),
    { code: 'ERR_NATIVE_DATABASE_DELEGATED_SCOPE' });
  }
  assert.throws(() => assertDelegatedNativeDatabaseScope({ ...owner, settled: true }, scope),
    { code: 'ERR_NATIVE_DATABASE_DELEGATED_SCOPE' });
  const lmdb = { ...scope, commandId: 'lmdb.build',
    targets: [path.join(indexRoot, 'index-lmdb', 'index-code')] };
  assert.doesNotThrow(() => assertDelegatedNativeDatabaseScope(owner, lmdb));
  assert.throws(() => assertDelegatedNativeDatabaseScope(owner,
    { ...lmdb, userConfig: { lmdb: { codeDbPath: targets[0] } } }),
  { code: 'ERR_NATIVE_DATABASE_DELEGATED_SCOPE' });
  console.log('Delegated database scope rejects changed roots, overrides and generation escapes');
} finally { await fs.rm(root, { recursive: true, force: true }); }
