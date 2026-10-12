import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { writeAccountedBundle } from '../../../src/index/build/incremental/accounted-bundle.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-transient-space-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  for (const format of ['json', 'msgpack']) {
    const directory = path.join(root, format);
    await fs.mkdir(directory);
    const bundlePath = path.join(directory, format === 'json' ? 'bundle.json' : 'bundle.mpk');
    const account = createSemanticDiskAccount(1024 * 1024);
    const options = { bundlePath, format, diskAccount: account, bundle: { file: 'a.js', chunks: [{ text: 'a();' }] } };
    await writeAccountedBundle(options);
    const retained = account.used;
    await Promise.all([writeAccountedBundle(options), writeAccountedBundle(options)]);
    assert.equal(account.used, retained, 'equivalent concurrent writes charge one retained snapshot');
    const inventory = await reopenSemanticDiskAccount({ roots: [directory], limit: Number.MAX_SAFE_INTEGER });
    assert.equal(account.used, inventory.retainedBytes);
    const bytes = await fs.readFile(bundlePath);
    const limited = createSemanticDiskAccount(retained + 1);
    limited.reserve(retained);
    await assert.rejects(writeAccountedBundle({ ...options, diskAccount: limited }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
    assert.equal(limited.used, retained);
    assert.deepEqual(await fs.readFile(bundlePath), bytes, 'temporary admission failure preserves the old snapshot');
    await writeAccountedBundle({ ...options, bundle: { ...options.bundle, chunks: [{ text: 'longer();' }] } });
    const changed = await reopenSemanticDiskAccount({ roots: [directory], limit: Number.MAX_SAFE_INTEGER });
    assert.equal(account.used, changed.retainedBytes, 'replacement releases the previous bytes only after writing');
    await fs.link(bundlePath, path.join(directory, 'retained-link'));
    await writeAccountedBundle({ ...options, bundle: { ...options.bundle, chunks: [{ text: 'replacement();' }] } });
    const linked = await reopenSemanticDiskAccount({ roots: [directory], limit: Number.MAX_SAFE_INTEGER });
    assert.equal(account.used, linked.retainedBytes, 'a replacement cannot credit bytes still retained by a hard link');
  }
  console.log('JSON/MessagePack transient and concurrent replacement accounting passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
