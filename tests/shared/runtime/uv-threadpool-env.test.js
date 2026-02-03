#!/usr/bin/env node
import { resolveRuntimeEnv } from '../../../tools/shared/dict-utils.js';

const env = {
  ...process.env,
  UV_THREADPOOL_SIZE: undefined
};

const resolved = resolveRuntimeEnv({ uvThreadpoolSize: 8 }, env);
if (resolved.UV_THREADPOOL_SIZE !== '8') {
  throw new Error(
    `uv-threadpool-env test failed: expected UV_THREADPOOL_SIZE=8, got ${resolved.UV_THREADPOOL_SIZE}`
  );
}

console.log('uv-threadpool-env test passed');
