#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  runSearchCliWithSpawnSync,
  runSearchCliWithSubprocessSync
} from '../../tools/shared/search-cli-harness.js';

{
  const payload = runSearchCliWithSpawnSync({
    query: 'needle',
    searchPath: 'search.js',
    jsonFallback: '{"ok":true,"source":"fallback"}',
    spawnSyncImpl: () => ({
      status: 0,
      signal: null,
      stdout: ' \n\t',
      stderr: '',
      error: null
    })
  }).payload;
  assert.equal(payload?.ok, true, 'expected whitespace stdout to fall back to jsonFallback for spawnSync path');
  assert.equal(payload?.source, 'fallback', 'expected fallback payload for spawnSync path');
}

{
  const payload = runSearchCliWithSubprocessSync({
    query: 'needle',
    searchPath: 'search.js',
    jsonFallback: '{"ok":true,"source":"fallback-subprocess"}',
    spawnSubprocessSyncImpl: () => ({
      exitCode: 0,
      signal: null,
      stdout: '\n',
      stderr: ''
    })
  }).payload;
  assert.equal(payload?.ok, true, 'expected whitespace stdout to fall back to jsonFallback for subprocess path');
  assert.equal(payload?.source, 'fallback-subprocess', 'expected fallback payload for subprocess path');
}

console.log('search CLI harness whitespace json fallback test passed');
