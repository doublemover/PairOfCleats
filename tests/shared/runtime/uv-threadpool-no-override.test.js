#!/usr/bin/env node
import { resolveRuntimeEnv } from '../../../tools/shared/dict-utils.js';

const baseEnv = {
  ...process.env,
  UV_THREADPOOL_SIZE: '4'
};

const resolved = resolveRuntimeEnv({ uvThreadpoolSize: 8 }, baseEnv);
if (resolved.UV_THREADPOOL_SIZE !== '4') {
  throw new Error(
    `uv-threadpool-no-override test failed: expected UV_THREADPOOL_SIZE=4, got ${resolved.UV_THREADPOOL_SIZE}`
  );
}

console.log('uv-threadpool-no-override test passed');
