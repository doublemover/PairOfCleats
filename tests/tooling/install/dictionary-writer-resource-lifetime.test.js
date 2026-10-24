#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { runDictionaryWriteSession, streamDictionaryToFile } from '../../../tools/download/dictionary-write-session.js';
import { dictionaryStorageCoordinationRoot } from '../../../src/shared/storage/dictionary-access.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { getDictConfig } from '../../../tools/shared/dict-utils.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'dictionary-writer-resource-lifetime');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_CACHE_ROOT: path.join(root, 'legacy-cache') }, async () => {
    const dictDir = getDictConfig(root, {}).dir;
    const coordinationRoot = dictionaryStorageCoordinationRoot();
    assert.equal(dictDir, path.join(root, 'legacy-cache', 'dictionaries'), 'writer uses the actual default legacy root selected by canonical config');
    assert.equal(coordinationRoot, path.join(root, 'home', 'state', 'storage-access'));
    await runDictionaryWriteSession({ dictDir }, async ({ trackResource }) => {
      assert.equal((await inspectStorageAccess(dictDir, { coordinationRoot })).protected, true);
      const output = await streamDictionaryToFile(Readable.from([Buffer.from('alpha\nbeta\n')]), path.join(dictDir, 'fixture.txt'), {
        maxBytes: 100, trackResource
      });
      await fs.rename(output.tempPath, path.join(dictDir, 'fixture.txt'));
      await atomicWriteJson(path.join(dictDir, 'dictionaries.json'), { fixture: { file: 'fixture.txt' } });
      assert.equal((await inspectStorageAccess(dictDir, { coordinationRoot })).protected, true, 'lease spans manifest publication');
    });
    assert.equal((await inspectStorageAccess(dictDir, { coordinationRoot })).protected, false);
    assert.equal(await fs.readFile(path.join(dictDir, 'fixture.txt'), 'utf8'), 'alpha\nbeta\n');
    await assert.rejects(runDictionaryWriteSession({ dictDir }, async ({ trackResource }) => {
      await streamDictionaryToFile(Readable.from([Buffer.from('too large')]), path.join(dictDir, 'oversized.txt'), { maxBytes: 1, trackResource });
    }), /maximum size/);
    assert.equal((await fs.readdir(dictDir)).some(name => name.startsWith('oversized.txt.tmp-')), false, 'failed output is removed only after its actual stream closes');
    let closed = false;
    let settle;
    const closure = new Promise(resolve => { settle = resolve; });
    const primary = new Error('fixture request failed while output teardown is pending');
    let pending;
    await assert.rejects(runDictionaryWriteSession({ dictDir, settlementTimeoutMs: 5 }, async ({ trackResource }) => {
      trackResource({ closed: closure, isClosed: () => closed, close: () => {} });
      throw primary;
    }), error => { pending = error; return error === primary && error.cacheOwnershipPending === true; });
    assert.equal((await inspectStorageAccess(dictDir, { coordinationRoot })).protected, true);
    assert.equal((await fs.stat(path.join(dictDir, '.pairofcleats-download.lock'))).isFile(), true);
    closed = true;
    settle();
    const actualSession = pending.storageSession;
    let releaseAttempts = 0;
    Object.defineProperty(pending, 'storageSession', { configurable: true, value: { ...actualSession,
      releaseAfterSettlement: async receipt => {
        releaseAttempts++;
        if (releaseAttempts === 1) throw new Error('fixture storage settlement publication failed');
        return actualSession.releaseAfterSettlement(receipt);
      } } });
    await assert.rejects(pending.dictionaryWriteSession.releaseAfterClosure(), /fixture storage settlement publication failed/);
    assert.equal((await inspectStorageAccess(dictDir, { coordinationRoot })).protected, true,
      'a rejected async settlement is not remembered as a completed release');
    await pending.dictionaryWriteSession.releaseAfterClosure();
    assert.equal(releaseAttempts, 2, 'actual storage release remains retryable after its prior rejection');
    assert.equal((await inspectStorageAccess(dictDir, { coordinationRoot })).protected, false);
    await assert.rejects(fs.stat(path.join(dictDir, '.pairofcleats-download.lock')), { code: 'ENOENT' });
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }

console.log('Dictionary writer lifetime follows actual requests, streams, manifest and shared storage ownership.');
