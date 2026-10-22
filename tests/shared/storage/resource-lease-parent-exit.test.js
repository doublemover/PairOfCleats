#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { repoAccessPaths, inspectRepoCacheAccess, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isKnownRepoAccessOwner, isKnownRepoResourceOwner } from '../../../src/shared/cache/repo-access-owner.js';

const temporary = await makeTempDir('resource-lease-parent-');
const actor = `
const input = JSON.parse(process.argv[1]);
const {acquireStorageSession} = await import(input.sessionModule);
const {retainRepoCacheAccess} = await import(input.readerModule);
if (input.mode === 'reader') retainRepoCacheAccess(input.root, {coordinationRoot: input.coordinationRoot});
else {
  const session = acquireStorageSession({roots:[input.root],coordinationRoot:input.coordinationRoot,
    authorizedRoots:[input.temporary],resourceId:input.mode});
  if (input.mode === 'settled') session.releaseAfterSettlement({resourceId:'settled',settled:true,pending:false});
}
console.log(JSON.stringify({pid:process.pid}));
`;
try {
  const root = path.join(temporary, 'assets'), coordinationRoot = path.join(temporary, 'state');
  await fs.mkdir(root, { recursive: true });
  const invoke = async mode => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', actor,
      JSON.stringify({ root, coordinationRoot, temporary, mode,
        sessionModule: pathToFileURL(path.resolve('src/shared/storage/session.js')).href,
        readerModule: pathToFileURL(path.resolve('src/shared/cache/repo-access-reader.js')).href })],
    { timeout: 10000, maxBuffer: 65536 });
    return JSON.parse(stdout);
  };
  await invoke('reader');
  assert.deepEqual(inspectRepoCacheAccess(root, { coordinationRoot }), [], 'ordinary reader exit keeps its existing release behavior');
  await invoke('settled');
  assert.deepEqual(inspectRepoCacheAccess(root, { coordinationRoot }), [], 'explicitly settled resources leave no durable fence');
  const { pid } = await invoke('unconfirmed-child-resource');
  const first = inspectRepoCacheAccess(root, { coordinationRoot });
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { pid, resourceId: 'unconfirmed-child-resource', reason: 'resource-settlement-unconfirmed' },
    'a dead initiating process does not prove external resource settlement');
  const paths = repoAccessPaths(root, { coordinationRoot });
  const names = await fs.readdir(paths.leases);
  assert.equal(names.length, 1);
  const bytes = await fs.readFile(path.join(paths.leases, names[0]));
  const metadata = JSON.parse(bytes);
  assert.equal(isKnownRepoAccessOwner(metadata), false, 'ordinary PID recovery schema stays strict');
  assert.equal(isKnownRepoResourceOwner(metadata), true);
  assert.equal(isKnownRepoResourceOwner({ ...metadata, futureRetention: 'unknown' }), false);
  const diagnosed = await inspectStorageAccess(root, { coordinationRoot });
  assert.equal(diagnosed.protected, true);
  assert.ok(diagnosed.owners.some(owner => owner.status === 'resource-settlement-unconfirmed'));
  const cleanup = await withExclusiveRepoCacheCleanup(root, () => assert.fail('unconfirmed resource cannot be collected'), { coordinationRoot });
  assert.equal(cleanup.protected, true);
  assert.deepEqual(await fs.readFile(path.join(paths.leases, names[0])), bytes, 'diagnosis/cleanup preserve original pending evidence');
  const local = acquireStorageSession({ roots: [path.join(temporary, 'second')], coordinationRoot,
    authorizedRoots: [temporary], resourceId: 'exact-local' });
  assert.throws(() => local.releaseAfterSettlement({ resourceId: 'wrong', settled: true, pending: false }),
    { code: 'ERR_STORAGE_SESSION_PENDING' });
  assert.throws(() => local.releaseAfterSettlement({ resourceId: 'exact-local', settled: true, pending: true }),
    { code: 'ERR_STORAGE_SESSION_PENDING' });
  local.releaseAfterSettlement({ resourceId: 'exact-local', settled: true, pending: false });
  console.log('Resource settlement fences survive parent exit while ordinary reader leases remain compatible.');
} finally { await rmDirRecursive(temporary); }
