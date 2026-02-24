import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createVfsManifestOffsetReader } from '../../../src/index/tooling/vfs.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

applyTestEnv({ testing: '1' });

const tempRoot = await makeTempDir('pairofcleats-vfs-offset-reader-close-timeout-');
const manifestPath = path.join(tempRoot, 'vfs_manifest.jsonl');
await fs.writeFile(
  manifestPath,
  `${JSON.stringify({ virtualPath: '.poc-vfs/src/a.ts#seg:a', chunks: [] })}\n`,
  'utf8'
);

const originalOpen = fs.open;
try {
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    return new Proxy(handle, {
      get(target, prop, receiver) {
        if (prop === 'close') {
          return async () => new Promise(() => {});
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  const logs = [];
  const reader = createVfsManifestOffsetReader({
    manifestPath,
    closeTimeoutMs: 25,
    log: (line) => logs.push(String(line))
  });
  await reader.readAtOffset({ offset: 0, bytes: 256 });
  const closeStartedAtMs = Date.now();
  await reader.close();
  const closeElapsedMs = Date.now() - closeStartedAtMs;
  assert.ok(
    closeElapsedMs < 1500,
    `expected reader close timeout to remain bounded (elapsed=${closeElapsedMs}ms)`
  );
  assert.ok(
    logs.some((line) => line.includes('vfs-offset-reader.close timed out')),
    'expected timeout close path to emit a warning log line'
  );
} finally {
  fs.open = originalOpen;
  await rmDirRecursive(tempRoot);
}

console.log('VFS offset-reader close timeout test passed');
